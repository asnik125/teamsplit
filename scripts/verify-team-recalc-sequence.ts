/**
 * Verify 5→6→7→8→7→6→5→6 auto team recalculation on real Firebase.
 * Does NOT start Next.js. Run: npx tsx scripts/verify-team-recalc-sequence.ts
 */
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { applyAttendanceAndSyncTeams } from "../src/lib/firebase/sync-teams-admin";
import type { Game, GameTeams, Player } from "../src/lib/types";

process.env.GOOGLE_APPLICATION_CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  resolve(process.cwd(), "firebase-service-account.json");

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!existsSync(saPath)) {
  console.error("Missing firebase-service-account.json");
  process.exit(1);
}

const sa = JSON.parse(readFileSync(saPath, "utf8"));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), projectId: sa.project_id });
}

const db = getFirestore();
const GAME_ID = `verify_seq_${Date.now()}`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function teams(): Promise<GameTeams | null> {
  const snap = await db.collection("gameTeams").doc(GAME_ID).get();
  return snap.exists ? (snap.data() as GameTeams) : null;
}

function ids(t: GameTeams | null): Set<string> {
  if (!t) return new Set();
  return new Set([
    ...t.teamA.map((m) => m.playerId),
    ...t.teamB.map((m) => m.playerId),
  ]);
}

async function main() {
  const players = (await db.collection("players").get()).docs
    .map((d) => d.data() as Player)
    .filter((p) => p.active)
    .slice(0, 8);
  assert(players.length >= 8, `Need ≥8 players, got ${players.length}`);

  const now = new Date().toISOString();
  await db.collection("settings").doc("app").set(
    {
      minPlayingForTeams: 6,
      updatedAt: now,
      updatedBy: "verify-seq",
    },
    { merge: true }
  );

  await db.collection("games").doc(GAME_ID).set({
    id: GAME_ID,
    date: "2099-07-01",
    startTime: "19:00",
    endTime: null,
    location: "Seq Verify",
    status: "scheduled",
    seasonId: "2099-2100",
    createdBy: "verify",
    createdAt: now,
    updatedAt: now,
    teamsMayBeStale: false,
    teamsStatusMessage: null,
    lastAttendanceChange: null,
  } satisfies Game);

  const p = players.map((x) => x.id);

  // Start with 5 Playing
  for (let i = 0; i < 5; i++) {
    await applyAttendanceAndSyncTeams({
      gameId: GAME_ID,
      playerId: p[i]!,
      status: "playing",
      updatedBy: "verify",
    });
  }
  let t = await teams();
  assert(!t, "5 Playing → no teams");
  console.log("✓ 5 → no teams");

  // 5 → 6
  let r = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: p[5]!,
    status: "playing",
    updatedBy: "verify",
  });
  t = await teams();
  assert(r.decision.playingCount === 6, "count 6");
  assert(t && ids(t).size === 6, "6 members");
  assert(!ids(t).has(p[6]!), "p6 not yet");
  console.log("✓ 5→6 teams created");

  // 6 → 7
  r = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: p[6]!,
    status: "playing",
    updatedBy: "verify",
  });
  t = await teams();
  assert(r.decision.playingCount === 7 && ids(t).size === 7, "7");
  assert(ids(t).has(p[6]!), "7th included");
  console.log("✓ 6→7 recalculated");

  // 7 → 8
  r = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: p[7]!,
    status: "playing",
    updatedBy: "verify",
  });
  t = await teams();
  assert(r.decision.playingCount === 8 && ids(t).size === 8, "8");
  console.log("✓ 7→8 recalculated");

  // 8 → 7 (drop last)
  r = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: p[7]!,
    status: "not_playing",
    updatedBy: "verify",
  });
  t = await teams();
  assert(r.decision.playingCount === 7 && ids(t).size === 7, "back to 7");
  assert(!ids(t).has(p[7]!), "dropped from teams");
  console.log("✓ 8→7 removed + recalculated");

  // 7 → 6
  r = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: p[6]!,
    status: "no_response",
    updatedBy: "verify",
  });
  t = await teams();
  assert(r.decision.playingCount === 6 && ids(t).size === 6, "6");
  assert(!ids(t).has(p[6]!), "p6 gone");
  console.log("✓ 7→6 recalculated");

  // 6 → 5
  r = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: p[5]!,
    status: "not_playing",
    updatedBy: "verify",
  });
  t = await teams();
  assert(r.decision.playingCount === 5, "5");
  assert(!t, "teams cleared");
  assert(r.decision.message === "Not enough players yet.", "insufficient msg");
  console.log("✓ 6→5 teams cleared");

  // 5 → 6 again
  r = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: p[5]!,
    status: "playing",
    updatedBy: "verify",
  });
  t = await teams();
  assert(r.decision.playingCount === 6 && t && ids(t).size === 6, "recreated");
  console.log("✓ 5→6 teams created again");

  // Cleanup
  const att = await db.collection("attendance").where("gameId", "==", GAME_ID).get();
  await Promise.all(att.docs.map((d) => d.ref.delete()));
  await db.collection("gameTeams").doc(GAME_ID).delete();
  await db.collection("games").doc(GAME_ID).delete();
  console.log("Cleaned up", GAME_ID);
  console.log("\nSequence 5→6→7→8→7→6→5→6 verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
