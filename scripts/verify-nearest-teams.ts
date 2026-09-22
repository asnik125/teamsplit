/**
 * Verify nearest-game-only teams + size balance 11→5→11 + future no-op.
 * npx tsx scripts/verify-nearest-teams.ts
 */
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  applyAttendanceAndSyncTeams,
  regenerateTeamsFromAttendance,
} from "../src/lib/firebase/sync-teams-admin";
import { nextUpcomingGame } from "../src/lib/schedule";
import { teamSizeDiff } from "../src/lib/balancer";
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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function expectedSplit(n: number): [number, number] {
  const a = Math.ceil(n / 2);
  const b = Math.floor(n / 2);
  return [a, b].sort((x, y) => x - y) as [number, number];
}

async function main() {
  const gamesSnap = await db.collection("games").where("status", "==", "scheduled").get();
  const games = gamesSnap.docs.map((d) => d.data() as Game);
  const nearest = nextUpcomingGame(games);
  assert(nearest, "need a nearest upcoming game");
  console.log("Nearest upcoming:", nearest!.date, nearest!.id);

  const future = games
    .filter((g) => g.id !== nearest!.id && g.date > nearest!.date)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  assert(future, "need a future game after nearest");

  const players = (await db.collection("players").get()).docs
    .map((d) => d.data() as Player)
    .filter((p) => p.active);
  assert(players.length >= 11, "need 11+ active players");

  const ids = players.slice(0, 11).map((p) => p.id);
  const GAME = nearest!.id;
  const FUTURE = future!.id;

  async function loadTeams(gameId: string): Promise<GameTeams | null> {
    const snap = await db.collection("gameTeams").doc(gameId).get();
    return snap.exists ? (snap.data() as GameTeams) : null;
  }

  async function setPlayingCount(n: number) {
    for (let i = 0; i < ids.length; i++) {
      await applyAttendanceAndSyncTeams({
        gameId: GAME,
        playerId: ids[i]!,
        status: i < n ? "playing" : "not_playing",
        updatedBy: "verify-nearest",
      });
    }
  }

  function assertTeams(n: number, t: GameTeams | null) {
    if (n < 6) {
      assert(!t || t.teamA.length + t.teamB.length === 0, `${n}: no teams`);
      return;
    }
    assert(t, `${n}: teams exist`);
    const total = t!.teamA.length + t!.teamB.length;
    assert(total === n, `${n}: total ${total}`);
    assert(teamSizeDiff(t!.teamA, t!.teamB) <= 1, `${n}: size balance`);
    const got = [t!.teamA.length, t!.teamB.length].sort((a, b) => a - b);
    assert(
      got[0] === expectedSplit(n)[0] && got[1] === expectedSplit(n)[1],
      `${n}: expected ${expectedSplit(n)}, got ${got}`
    );
    const assigned = [...t!.teamA, ...t!.teamB].map((m) => m.playerId).sort();
    const eligible = ids.slice(0, n).slice().sort();
    assert(
      JSON.stringify(assigned) === JSON.stringify(eligible),
      `${n}: membership mismatch`
    );
  }

  // Snapshot future teams before touching Oct attendance
  const futureTeamsBefore = await loadTeams(FUTURE);
  const nearestBeforeTouch = await loadTeams(GAME);

  // Force 11 playing on nearest and regenerate
  await setPlayingCount(11);
  let t = await loadTeams(GAME);
  assertTeams(11, t);
  console.log("✓ 11 →", t!.teamA.length, "/", t!.teamB.length);

  const nearestSnapshot = JSON.stringify({
    a: t!.teamA.map((m) => m.playerId).sort(),
    b: t!.teamB.map((m) => m.playerId).sort(),
  });

  // Change FUTURE attendance — nearest teams must not change
  await applyAttendanceAndSyncTeams({
    gameId: FUTURE,
    playerId: ids[0]!,
    status: "not_playing",
    updatedBy: "verify-nearest",
  });
  await applyAttendanceAndSyncTeams({
    gameId: FUTURE,
    playerId: ids[1]!,
    status: "playing",
    updatedBy: "verify-nearest",
  });
  t = await loadTeams(GAME);
  const afterFuture = JSON.stringify({
    a: t!.teamA.map((m) => m.playerId).sort(),
    b: t!.teamB.map((m) => m.playerId).sort(),
  });
  assert(afterFuture === nearestSnapshot, "future attendance must not change nearest teams");
  console.log("✓ Future attendance does not change nearest teams");

  // 11 → 10 → … → 5
  for (const n of [10, 9, 8, 7, 6, 5]) {
    await setPlayingCount(n);
    t = await loadTeams(GAME);
    assertTeams(n, t);
    console.log(
      n < 6
        ? `✓ ${n} → no teams`
        : `✓ ${n} → ${t!.teamA.length}/${t!.teamB.length}`
    );
  }

  // 5 → 6 → … → 11
  for (const n of [6, 7, 8, 9, 10, 11]) {
    await setPlayingCount(n);
    t = await loadTeams(GAME);
    assertTeams(n, t);
    console.log(`✓ ${n} → ${t!.teamA.length}/${t!.teamB.length}`);
  }

  // Final regenerate to leave nearest in a good state matching current attendance
  await regenerateTeamsFromAttendance({
    gameId: GAME,
    updatedBy: "verify-nearest",
  });
  t = await loadTeams(GAME);
  assertTeams(11, t);
  console.log("✓ Final 11 teams ready for", nearest!.date);

  void nearestBeforeTouch;
  void futureTeamsBefore;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
