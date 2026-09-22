/**
 * Verify Playing/Maybe inclusion + recalc. No Next server.
 * npx tsx scripts/verify-maybe-include.ts
 */
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  applyAttendanceAndSyncTeams,
  setIncludeMaybeAndRecalculate,
} from "../src/lib/firebase/sync-teams-admin";
import type { Game, GameTeams, Player } from "../src/lib/types";

process.env.GOOGLE_APPLICATION_CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  resolve(process.cwd(), "firebase-service-account.json");

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS!;
if (!existsSync(saPath)) {
  console.error("Missing firebase-service-account.json");
  process.exit(1);
}
const sa = JSON.parse(readFileSync(saPath, "utf8"));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), projectId: sa.project_id });
}

const db = getFirestore();
const GAME_ID = `verify_maybe_${Date.now()}`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function loadTeams(): Promise<GameTeams | null> {
  const snap = await db.collection("gameTeams").doc(GAME_ID).get();
  return snap.exists ? (snap.data() as GameTeams) : null;
}

async function main() {
  // ... existing body uses cleanup in finally
  try {
    await runVerify();
  } finally {
    await cleanupVerifyGame(GAME_ID);
  }
}

async function cleanupVerifyGame(gameId: string) {
  const att = await db.collection("attendance").where("gameId", "==", gameId).get();
  await Promise.all(att.docs.map((d) => d.ref.delete()));
  await db.collection("gameTeams").doc(gameId).delete().catch(() => undefined);
  await db.collection("games").doc(gameId).delete().catch(() => undefined);
  console.log("Cleaned up", gameId);
}

async function runVerify() {
  const players = (await db.collection("players").get()).docs
    .map((d) => d.data() as Player)
    .filter((p) => p.active)
    .slice(0, 7);
  assert(players.length >= 7, "need 7 players");

  const now = new Date().toISOString();
  await db.collection("settings").doc("app").set(
    {
      minPlayingForTeams: 6,
      allowPlayersEditOthersAttendance: true,
      updatedAt: now,
      updatedBy: "verify",
    },
    { merge: true }
  );

  await db.collection("games").doc(GAME_ID).set({
    id: GAME_ID,
    date: "2099-08-01",
    startTime: "19:00",
    endTime: null,
    location: "Maybe Verify",
    status: "scheduled",
    seasonId: "2099-2100",
    createdBy: "verify",
    createdAt: now,
    updatedAt: now,
    teamsMayBeStale: false,
    teamsStatusMessage: null,
    lastAttendanceChange: null,
  } satisfies Game);

  const ids = players.map((p) => p.id);

  // 5 Playing
  for (let i = 0; i < 5; i++) {
    await applyAttendanceAndSyncTeams({
      gameId: GAME_ID,
      playerId: ids[i]!,
      status: "playing",
      updatedBy: "verify",
    });
  }
  // 2 Maybe
  await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: ids[5]!,
    status: "maybe",
    updatedBy: "verify",
  });
  await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: ids[6]!,
    status: "maybe",
    updatedBy: "verify",
  });

  let t = await loadTeams();
  assert(!t || t.teamA.length + t.teamB.length === 0, "OFF: no teams with 5 playing");
  console.log("✓ 5 Playing + 2 Maybe, Include OFF → no teams");

  const d = await setIncludeMaybeAndRecalculate({
    gameId: GAME_ID,
    includeMaybePlayers: true,
    updatedBy: "verify",
  });
  t = await loadTeams();
  assert(d.includedCount === 7, "7 included");
  assert(t && t.teamA.length + t.teamB.length === 7, "7 on teams");
  assert(t!.includeMaybePlayers === true, "flag on");
  const maybeMarked = [...t!.teamA, ...t!.teamB].filter((m) => m.maybe);
  assert(maybeMarked.length === 2, "2 maybe markers");
  console.log("✓ Include ON → 7 teams with Maybe labels");

  // Playing → Maybe with Include ON → still included (4 Playing + 3 Maybe = 7)
  await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: ids[0]!,
    status: "maybe",
    updatedBy: "verify",
  });
  t = await loadTeams();
  assert(t && t.teamA.length + t.teamB.length === 7, "7 after Playing→Maybe with Include ON");
  assert(
    [...t!.teamA, ...t!.teamB].some((m) => m.playerId === ids[0] && m.maybe),
    "converted player marked Maybe"
  );
  console.log("✓ Playing→Maybe (Include ON) stays on teams");

  // Include OFF → only 4 Playing → insufficient
  await setIncludeMaybeAndRecalculate({
    gameId: GAME_ID,
    includeMaybePlayers: false,
    updatedBy: "verify",
  });
  t = await loadTeams();
  assert(!t || t.teamA.length + t.teamB.length === 0, "Include OFF with 4 Playing clears teams");
  console.log("✓ Include OFF → Not enough players");

  // Restore 6 Playing for manual overwrite test
  for (const id of ids.slice(0, 6)) {
    await applyAttendanceAndSyncTeams({
      gameId: GAME_ID,
      playerId: id!,
      status: "playing",
      updatedBy: "verify",
    });
  }
  t = await loadTeams();
  assert(t && t.teamA.length + t.teamB.length === 6, "6 Playing teams ready");

  const { saveManualTeams } = await import("../src/lib/firebase/sync-teams-admin");
  const swappedA = [...t!.teamB];
  const swappedB = [...t!.teamA];
  await saveManualTeams({
    gameId: GAME_ID,
    teamA: swappedA,
    teamB: swappedB,
    updatedBy: "verify-admin",
  });
  t = await loadTeams();
  assert(t?.manuallyAdjusted === true, "manual flag set");
  const manualFirst = t!.teamA[0]?.playerId;

  // Attendance change after manual → fresh auto recalc (manual arrangement replaced)
  await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: ids[5]!,
    status: "not_playing",
    updatedBy: "verify",
  });
  t = await loadTeams();
  assert(
    !t || t.teamA.length + t.teamB.length === 0,
    "5 Playing → teams cleared"
  );
  assert(!t || t.manuallyAdjusted === false, "manual cleared by attendance sync");
  console.log("✓ Attendance after manual drag triggers fresh recalc");
  void manualFirst;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
