/**
 * End-to-end verification of attendance → draft team sync on real Firebase.
 * Run: npx tsx scripts/verify-team-sync.ts
 */
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  decideTeamsSync,
  MSG_CREATED,
  MSG_INSUFFICIENT,
  MSG_NEEDS_UPDATE,
  MSG_UPDATED,
} from "../src/lib/team-sync";
import { calculateOverall } from "../src/lib/balancer";
import type {
  AttendanceRecord,
  Game,
  GameTeams,
  Player,
  PlayerEvaluation,
  PlayerRatings,
  RatedPlayer,
} from "../src/lib/types";
import { RATING_KEYS } from "../src/lib/types";

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
  initializeApp({
    credential: cert(sa),
    projectId: sa.project_id,
  });
}

const db = getFirestore();
const GAME_ID = `verify_sync_${Date.now()}`;

function nowIso() {
  return new Date().toISOString();
}

function toRated(player: Player, ev: PlayerEvaluation | undefined): RatedPlayer {
  const ratings = (
    ev
      ? Object.fromEntries(RATING_KEYS.map((k) => [k, ev[k]]))
      : Object.fromEntries(RATING_KEYS.map((k) => [k, 6]))
  ) as PlayerRatings;
  return { ...player, ...ratings, overall: calculateOverall(ratings) };
}

async function setStatus(playerId: string, status: AttendanceRecord["status"]) {
  await db
    .collection("attendance")
    .doc(`${GAME_ID}_${playerId}`)
    .set({
      gameId: GAME_ID,
      playerId,
      status,
      updatedAt: nowIso(),
      updatedBy: "verify-script",
    } satisfies AttendanceRecord);
}

async function syncLikeApi(playerId: string, status: AttendanceRecord["status"]) {
  await setStatus(playerId, status);

  const [attendanceSnap, teamsSnap, playersSnap, evalsSnap, gameSnap] =
    await Promise.all([
      db.collection("attendance").where("gameId", "==", GAME_ID).get(),
      db.collection("gameTeams").doc(GAME_ID).get(),
      db.collection("players").get(),
      db.collection("playerEvaluations").get(),
      db.collection("games").doc(GAME_ID).get(),
    ]);

  const attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
  const players = playersSnap.docs.map((d) => d.data() as Player);
  const evalMap = Object.fromEntries(
    evalsSnap.docs.map((d) => {
      const ev = d.data() as PlayerEvaluation;
      return [ev.playerId, ev];
    })
  );

  const playingRated = attendance
    .filter((a) => a.status === "playing")
    .map((a) => {
      const pl = players.find((p) => p.id === a.playerId && p.active);
      return pl ? toRated(pl, evalMap[pl.id]) : null;
    })
    .filter(Boolean) as RatedPlayer[];

  const existingTeams = teamsSnap.exists
    ? (teamsSnap.data() as GameTeams)
    : null;

  const decision = decideTeamsSync({
    playingRated,
    existing: existingTeams
      ? {
          teamA: existingTeams.teamA,
          teamB: existingTeams.teamB,
          published: Boolean(existingTeams.published),
          manuallyAdjusted: Boolean(existingTeams.manuallyAdjusted),
        }
      : null,
  });

  const now = nowIso();
  if (decision.clearTeams) {
    await db.collection("gameTeams").doc(GAME_ID).delete();
  } else if (decision.writeTeams) {
    await db
      .collection("gameTeams")
      .doc(GAME_ID)
      .set({
        gameId: GAME_ID,
        teamA: decision.teamA,
        teamB: decision.teamB,
        published: false,
        publishedAt: null,
        updatedAt: now,
        updatedBy: "verify-script",
        manuallyAdjusted: false,
      } satisfies GameTeams);
  }

  const player = players.find((p) => p.id === playerId);
  await db
    .collection("games")
    .doc(GAME_ID)
    .update({
      updatedAt: now,
      teamsMayBeStale: decision.markStale,
      teamsStatusMessage: decision.message,
      lastAttendanceChange: {
        playerId,
        displayName: player?.displayName ?? playerId,
        previousStatus: null,
        nextStatus: status,
        at: now,
      },
    });

  return {
    decision,
    game: (await db.collection("games").doc(GAME_ID).get()).data() as Game,
    teams: (await db.collection("gameTeams").doc(GAME_ID).get()).exists
      ? ((await db.collection("gameTeams").doc(GAME_ID).get()).data() as GameTeams)
      : null,
  };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  const playersSnap = await db.collection("players").get();
  const active = playersSnap.docs
    .map((d) => d.data() as Player)
    .filter((p) => p.active)
    .slice(0, 8);

  assert(active.length >= 7, `Need ≥7 active players, found ${active.length}`);

  const now = nowIso();
  const game: Game = {
    id: GAME_ID,
    date: "2099-01-01",
    startTime: "19:00",
    endTime: null,
    location: "Verify Sync Gym",
    status: "scheduled",
    seasonId: "2099-2100",
    createdBy: "verify-script",
    createdAt: now,
    updatedAt: now,
    teamsMayBeStale: false,
    teamsStatusMessage: null,
    lastAttendanceChange: null,
  };
  await db.collection("games").doc(GAME_ID).set(game);
  console.log("Created game", GAME_ID);

  const ids = active.map((p) => p.id);

  // 5 Playing
  for (let i = 0; i < 5; i++) {
    await syncLikeApi(ids[i]!, "playing");
  }
  let r = await syncLikeApi(ids[0]!, "playing"); // noop refresh path
  // ensure exactly 5 via fresh read
  r = await (async () => {
    // Re-run decision after 5 sets
    return syncLikeApi(ids[4]!, "playing");
  })();
  assert(r.decision.playingCount === 5, `expected 5 playing, got ${r.decision.playingCount}`);
  assert(r.decision.message === MSG_INSUFFICIENT, "5 playing → insufficient message");
  assert(!r.teams, "5 playing → no teams doc");
  console.log("✓ 5 Playing → no teams + minimum message");

  // 5 → 6
  r = await syncLikeApi(ids[5]!, "playing");
  assert(r.decision.playingCount === 6, "expected 6");
  assert(r.decision.message === MSG_CREATED, "6 → created message");
  assert(r.teams && r.teams.teamA.length + r.teams.teamB.length === 6, "6 members");
  assert(r.teams!.published === false, "draft not published");
  console.log("✓ 5→6 Playing → draft created");

  // 6 → 7
  r = await syncLikeApi(ids[6]!, "playing");
  assert(r.decision.playingCount === 7, "expected 7");
  assert(r.decision.message === MSG_UPDATED, "7 → updated message");
  assert(r.teams!.teamA.length + r.teams!.teamB.length === 7, "7 members");
  const ids7 = new Set([
    ...r.teams!.teamA.map((m) => m.playerId),
    ...r.teams!.teamB.map((m) => m.playerId),
  ]);
  assert(ids7.has(ids[6]!), "7th player included");
  console.log("✓ 6→7 Playing → draft regenerated");

  // 7 → 6 (one Not playing)
  const dropId = ids[6]!;
  r = await syncLikeApi(dropId, "not_playing");
  assert(r.decision.playingCount === 6, "back to 6");
  assert(r.teams!.teamA.length + r.teams!.teamB.length === 6, "6 members after drop");
  const ids6 = new Set([
    ...r.teams!.teamA.map((m) => m.playerId),
    ...r.teams!.teamB.map((m) => m.playerId),
  ]);
  assert(!ids6.has(dropId), "dropped player removed from teams");
  console.log("✓ 7→6 Not playing → player removed + regen");

  // Manual adjust protection
  await db
    .collection("gameTeams")
    .doc(GAME_ID)
    .update({ manuallyAdjusted: true });
  const before = (await db.collection("gameTeams").doc(GAME_ID).get()).data() as GameTeams;
  r = await syncLikeApi(dropId, "playing");
  assert(r.decision.action === "needs_update", "manual → needs_update");
  assert(r.decision.message === MSG_NEEDS_UPDATE, "needs update message");
  assert(r.game.teamsMayBeStale === true, "stale flag");
  const after = r.teams!;
  assert(
    JSON.stringify(after.teamA) === JSON.stringify(before.teamA) &&
      JSON.stringify(after.teamB) === JSON.stringify(before.teamB),
    "manual teams preserved"
  );
  console.log("✓ Manual teams preserved + needs update");

  // Explicit regenerate (force existing null path)
  const playingRated = (
    await db.collection("attendance").where("gameId", "==", GAME_ID).get()
  ).docs
    .map((d) => d.data() as AttendanceRecord)
    .filter((a) => a.status === "playing");
  const players = (
    await db.collection("players").get()
  ).docs.map((d) => d.data() as Player);
  const evals = (
    await db.collection("playerEvaluations").get()
  ).docs.map((d) => d.data() as PlayerEvaluation);
  const evalMap = Object.fromEntries(evals.map((e) => [e.playerId, e]));
  const rated = playingRated
    .map((a) => {
      const pl = players.find((p) => p.id === a.playerId && p.active);
      return pl ? toRated(pl, evalMap[pl.id]) : null;
    })
    .filter(Boolean) as RatedPlayer[];
  const regen = decideTeamsSync({ playingRated: rated, existing: null });
  await db.collection("gameTeams").doc(GAME_ID).set({
    gameId: GAME_ID,
    teamA: regen.teamA,
    teamB: regen.teamB,
    published: false,
    publishedAt: null,
    updatedAt: nowIso(),
    updatedBy: "verify-script",
    manuallyAdjusted: false,
  } satisfies GameTeams);
  await db.collection("games").doc(GAME_ID).update({
    teamsMayBeStale: false,
    teamsStatusMessage: regen.message,
  });
  assert(regen.teamA.length + regen.teamB.length === 7, "regen has 7");
  console.log("✓ Explicit regenerate → new draft");

  // Publish — public members only (no ratings keys)
  const pubNow = nowIso();
  const draft = (
    await db.collection("gameTeams").doc(GAME_ID).get()
  ).data() as GameTeams;
  await db
    .collection("gameTeams")
    .doc(GAME_ID)
    .set({
      ...draft,
      published: true,
      publishedAt: pubNow,
      manuallyAdjusted: true,
    });
  const published = (
    await db.collection("gameTeams").doc(GAME_ID).get()
  ).data() as GameTeams;
  for (const m of [...published.teamA, ...published.teamB]) {
    assert(
      Object.keys(m).sort().join(",") === "displayName,playerId",
      `public member keys only, got ${Object.keys(m)}`
    );
  }
  console.log("✓ Publish → names/team assignment only");

  // Cleanup
  const att = await db.collection("attendance").where("gameId", "==", GAME_ID).get();
  await Promise.all(att.docs.map((d) => d.ref.delete()));
  await db.collection("gameTeams").doc(GAME_ID).delete();
  await db.collection("games").doc(GAME_ID).delete();
  console.log("Cleaned up", GAME_ID);
  console.log("\nAll Firebase verification checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
