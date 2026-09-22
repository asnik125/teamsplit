/**
 * Verify Playing → Not playing → Playing removes/restores draft membership.
 * Run: npx tsx scripts/verify-player-rsvp-transition.ts
 */
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { applyAttendanceAndSyncTeams } from "../src/lib/firebase/sync-teams-admin";
import { buildPlayerGameView } from "../src/lib/player-game-view";
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
const GAME_ID = `verify_rsvp_${Date.now()}`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function memberIds(teams: GameTeams | null): Set<string> {
  if (!teams) return new Set();
  return new Set([
    ...teams.teamA.map((m) => m.playerId),
    ...teams.teamB.map((m) => m.playerId),
  ]);
}

async function loadTeams(): Promise<GameTeams | null> {
  const snap = await db.collection("gameTeams").doc(GAME_ID).get();
  return snap.exists ? (snap.data() as GameTeams) : null;
}

async function loadGame(): Promise<Game> {
  return (await db.collection("games").doc(GAME_ID).get()).data() as Game;
}

async function main() {
  const players = (await db.collection("players").get()).docs
    .map((d) => d.data() as Player)
    .filter((p) => p.active)
    .slice(0, 7);
  assert(players.length >= 7, `Need ≥7 players, got ${players.length}`);

  const now = new Date().toISOString();
  await db.collection("games").doc(GAME_ID).set({
    id: GAME_ID,
    date: "2099-06-01",
    startTime: "19:00",
    endTime: null,
    location: "RSVP Verify",
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
  const focusId = ids[0]!;
  const focusName = players[0]!.displayName;

  // Build to 6 Playing including focus
  for (let i = 0; i < 6; i++) {
    await applyAttendanceAndSyncTeams({
      gameId: GAME_ID,
      playerId: ids[i]!,
      status: "playing",
      updatedBy: "verify",
    });
  }

  let teams = await loadTeams();
  assert(teams && !teams.published, "auto draft created unpublished");
  assert(memberIds(teams).has(focusId), `${focusName} in draft while Playing`);
  console.log(`✓ ${focusName} Playing → included in auto draft`);

  // Playing → Not playing: must leave draft immediately
  const leave = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: focusId,
    status: "not_playing",
    updatedBy: "verify",
  });
  teams = await loadTeams();
  const game = await loadGame();
  assert(
    leave.decision.playingCount === 5,
    `playing count 5, got ${leave.decision.playingCount}`
  );
  assert(!teams || !memberIds(teams).has(focusId), `${focusName} must leave draft`);
  // With 5 playing, auto draft clears
  assert(!teams, "auto draft cleared under 6");
  console.log(`✓ ${focusName} Not playing → removed from draft; count updated`);

  // Player view must not claim Team A
  const viewNotPlaying = buildPlayerGameView({
    myStatus: "not_playing",
    myPlayerId: focusId,
    playingCount: 5,
    publishedTeams: null,
    teamsMayBeStale: Boolean(game.teamsMayBeStale),
  });
  assert(viewNotPlaying.statusLabel === "NOT PLAYING", "status NOT PLAYING");
  assert(viewNotPlaying.myTeamLabel === null, "no team assignment");
  assert(
    viewNotPlaying.teamsMessage.includes("Not enough players"),
    "insufficient message"
  );
  console.log("✓ Player view: NOT PLAYING, no team claim");

  // Bring back to 6 with focus Playing again
  for (let i = 1; i < 6; i++) {
    await applyAttendanceAndSyncTeams({
      gameId: GAME_ID,
      playerId: ids[i]!,
      status: "playing",
      updatedBy: "verify",
    });
  }
  const rejoined = await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: focusId,
    status: "playing",
    updatedBy: "verify",
  });
  teams = await loadTeams();
  assert(rejoined.decision.playingCount === 6, "back to 6");
  assert(teams && memberIds(teams).has(focusId), `${focusName} restored to draft`);
  console.log(`✓ ${focusName} Playing again → included in regenerated draft`);

  // Publish then Not playing: Admin snapshot kept, Player view "being updated"
  await db.collection("gameTeams").doc(GAME_ID).update({
    published: true,
    publishedAt: now,
  });
  await applyAttendanceAndSyncTeams({
    gameId: GAME_ID,
    playerId: focusId,
    status: "not_playing",
    updatedBy: "verify",
  });
  teams = await loadTeams();
  const game2 = await loadGame();
  assert(teams?.published === true, "published snapshot retained");
  assert(memberIds(teams).has(focusId), "Admin snapshot still has player");
  assert(game2.teamsMayBeStale === true, "marked stale");

  const viewStale = buildPlayerGameView({
    myStatus: "not_playing",
    myPlayerId: focusId,
    playingCount: 5,
    publishedTeams: teams,
    teamsMayBeStale: true,
  });
  // playingCount 5 → insufficient takes precedence
  assert(viewStale.myTeamLabel === null, "no You are on Team X");
  assert(viewStale.showTeamLists === false, "no misleading lists");

  // Also check stale with 6+ still playing (add 7th before leave... recreate)
  // Set 6 others playing (exclude focus), publish with focus still in snapshot
  for (let i = 1; i < 7; i++) {
    await applyAttendanceAndSyncTeams({
      gameId: GAME_ID,
      playerId: ids[i]!,
      status: "playing",
      updatedBy: "verify",
    });
  }
  // Force published stale snapshot that still lists focus
  const current = await loadTeams();
  assert(current, "teams exist");
  await db.collection("gameTeams").doc(GAME_ID).set({
    ...current!,
    teamA: [
      { playerId: focusId, displayName: focusName },
      ...current!.teamA.filter((m) => m.playerId !== focusId).slice(0, 2),
    ],
    teamB: current!.teamB,
    published: true,
    publishedAt: now,
    manuallyAdjusted: true,
  });
  await db.collection("games").doc(GAME_ID).update({ teamsMayBeStale: true });

  const viewUpdating = buildPlayerGameView({
    myStatus: "not_playing",
    myPlayerId: focusId,
    playingCount: 6,
    publishedTeams: (await loadTeams())!,
    teamsMayBeStale: true,
  });
  assert(viewUpdating.teamsPhase === "updating", "updating phase");
  assert(
    viewUpdating.teamsMessage === "Teams are being updated",
    "being updated copy"
  );
  assert(viewUpdating.myTeamLabel === null, "no Team A claim while Not playing + stale");
  assert(viewUpdating.showTeamLists === false, "hide outdated lists");
  console.log("✓ Published stale: Player sees Teams are being updated, not Team A");

  // Cleanup
  const att = await db.collection("attendance").where("gameId", "==", GAME_ID).get();
  await Promise.all(att.docs.map((d) => d.ref.delete()));
  await db.collection("gameTeams").doc(GAME_ID).delete();
  await db.collection("games").doc(GAME_ID).delete();
  console.log("Cleaned up", GAME_ID);
  console.log("\nAll Playing → Not playing → Playing checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
