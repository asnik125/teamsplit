import {
  assertValidTeamSplit,
  calculateOverall,
  teamSizeDiff,
} from "../balancer";
import type {
  AttendanceRecord,
  AttendanceStatus,
  Game,
  GameTeams,
  Player,
  PlayerEvaluation,
  PlayerRatings,
  RatedPlayer,
  AppSettings,
  TeamMemberPublic,
} from "../types";
import { RATING_KEYS } from "../types";
import {
  decideTeamsSync,
  DEFAULT_MIN_PLAYING_FOR_TEAMS,
  isIncludedForTeams,
  type TeamsSyncDecision,
} from "../team-sync";
import {
  activeEligiblePlayerIds,
  nearestTeamsNeedRepair,
} from "../player-lifecycle";
import { nextUpcomingGame } from "../schedule";
import { getAdminDb } from "./admin";

function nowIso() {
  return new Date().toISOString();
}

function ratingsFromEval(ev: PlayerEvaluation | undefined): PlayerRatings {
  if (!ev) {
    return Object.fromEntries(RATING_KEYS.map((k) => [k, 6])) as PlayerRatings;
  }
  return Object.fromEntries(RATING_KEYS.map((k) => [k, ev[k]])) as PlayerRatings;
}

function toRated(player: Player, ev: PlayerEvaluation | undefined): RatedPlayer {
  const ratings = ratingsFromEval(ev);
  return {
    ...player,
    ...ratings,
    overall: calculateOverall(ratings),
  };
}

async function loadSettings(): Promise<{
  minPlaying: number;
  allowPlayersEditOthersAttendance: boolean;
}> {
  const snap = await getAdminDb().collection("settings").doc("app").get();
  if (!snap.exists) {
    return {
      minPlaying: DEFAULT_MIN_PLAYING_FOR_TEAMS,
      allowPlayersEditOthersAttendance: true,
    };
  }
  const data = snap.data() as Partial<AppSettings>;
  const min = Number(data.minPlayingForTeams);
  return {
    minPlaying:
      Number.isFinite(min) && min >= 2
        ? Math.floor(min)
        : DEFAULT_MIN_PLAYING_FOR_TEAMS,
    allowPlayersEditOthersAttendance:
      data.allowPlayersEditOthersAttendance !== false,
  };
}

export async function canUserEditPlayerAttendance(input: {
  role: string;
  ownPlayerId: string | null;
  targetPlayerId: string;
}): Promise<boolean> {
  if (input.role === "admin") return true;
  if (input.ownPlayerId && input.ownPlayerId === input.targetPlayerId) {
    return true;
  }
  const { allowPlayersEditOthersAttendance } = await loadSettings();
  return allowPlayersEditOthersAttendance;
}

function buildIncluded(
  attendance: AttendanceRecord[],
  players: Player[],
  evalMap: Record<string, PlayerEvaluation>,
  includeMaybe: boolean
): { includedRated: RatedPlayer[]; maybePlayerIds: Set<string> } {
  const maybePlayerIds = new Set<string>();
  const includedRated = attendance
    .filter((a) => isIncludedForTeams(a.status, includeMaybe))
    .map((a) => {
      const pl = players.find((p) => p.id === a.playerId && p.active);
      if (!pl) return null;
      if (a.status === "maybe") maybePlayerIds.add(pl.id);
      return toRated(pl, evalMap[pl.id]);
    })
    .filter(Boolean) as RatedPlayer[];
  return { includedRated, maybePlayerIds };
}

async function loadNearestUpcomingGameId(): Promise<string | null> {
  const snap = await getAdminDb()
    .collection("games")
    .where("status", "==", "scheduled")
    .get();
  const games = snap.docs.map((d) => d.data() as Game);
  return nextUpcomingGame(games)?.id ?? null;
}

/** Attendance save only — no team sync (used for future games). */
function attendanceOnlyDecision(
  includeMaybePlayers: boolean,
  minPlaying: number
): TeamsSyncDecision {
  return {
    action: "unchanged",
    message: "Attendance saved",
    playingCount: 0,
    includedCount: 0,
    minPlaying,
    includeMaybePlayers,
    writeTeams: false,
    clearTeams: false,
    teamA: [],
    teamB: [],
    markStale: false,
    manuallyAdjusted: false,
    keepPublished: false,
  };
}

async function applyTeamsDecision(input: {
  gameId: string;
  decision: TeamsSyncDecision;
  updatedBy: string | null;
  lastAttendanceChange?: Game["lastAttendanceChange"];
}): Promise<void> {
  const db = getAdminDb();
  const teamsRef = db.collection("gameTeams").doc(input.gameId);
  const gameRef = db.collection("games").doc(input.gameId);
  const now = nowIso();

  if (input.decision.clearTeams) {
    await teamsRef.set({
      gameId: input.gameId,
      teamA: [],
      teamB: [],
      published: false,
      publishedAt: null,
      updatedAt: now,
      updatedBy: input.updatedBy,
      manuallyAdjusted: false,
      includeMaybePlayers: input.decision.includeMaybePlayers,
    } satisfies GameTeams);
  } else if (input.decision.writeTeams) {
    const payload: GameTeams = {
      gameId: input.gameId,
      teamA: input.decision.teamA,
      teamB: input.decision.teamB,
      published: false,
      publishedAt: null,
      updatedAt: now,
      updatedBy: input.updatedBy,
      manuallyAdjusted: false,
      includeMaybePlayers: input.decision.includeMaybePlayers,
    };
    await teamsRef.set(payload);
  } else {
    // Keep includeMaybe flag even when unchanged / insufficient without clear
    const snap = await teamsRef.get();
    if (snap.exists) {
      await teamsRef.update({
        includeMaybePlayers: input.decision.includeMaybePlayers,
        updatedAt: now,
      });
    }
  }

  const gameUpdate: Partial<Game> = {
    updatedAt: now,
    teamsMayBeStale: false,
    teamsStatusMessage: input.decision.message,
  };
  if (input.lastAttendanceChange) {
    gameUpdate.lastAttendanceChange = input.lastAttendanceChange;
  }
  await gameRef.update(gameUpdate);
}

export interface AttendanceSyncResult {
  decision: TeamsSyncDecision;
  previousStatus: AttendanceStatus | null;
  nextStatus: AttendanceStatus;
  playerId: string;
  displayName: string;
}

export async function applyAttendanceAndSyncTeams(input: {
  gameId: string;
  playerId: string;
  status: AttendanceStatus;
  updatedBy: string | null;
}): Promise<AttendanceSyncResult> {
  const db = getAdminDb();
  const gameRef = db.collection("games").doc(input.gameId);
  const attendanceRef = db
    .collection("attendance")
    .doc(`${input.gameId}_${input.playerId}`);
  const teamsRef = db.collection("gameTeams").doc(input.gameId);

  const [gameSnap, attendanceSnap, teamsSnap, playersSnap, evalsSnap, settings] =
    await Promise.all([
      gameRef.get(),
      attendanceRef.get(),
      teamsRef.get(),
      db.collection("players").get(),
      db.collection("playerEvaluations").get(),
      loadSettings(),
    ]);

  if (!gameSnap.exists) {
    throw new Error(`Game ${input.gameId} not found`);
  }

  const game = gameSnap.data() as Game;
  if (Boolean(game.noGame)) {
    throw new Error("Attendance is locked: this date is marked No Game");
  }

  const previousStatus = attendanceSnap.exists
    ? ((attendanceSnap.data() as AttendanceRecord).status ?? null)
    : null;

  const players = playersSnap.docs.map((d) => d.data() as Player);
  const player = players.find((p) => p.id === input.playerId);
  if (!player) {
    throw new Error("Player not found");
  }
  if (!player.active) {
    throw new Error("Inactive players cannot update attendance");
  }
  const displayName = player.displayName;
  const existingTeams = teamsSnap.exists
    ? (teamsSnap.data() as GameTeams)
    : null;

  await attendanceRef.set({
    gameId: input.gameId,
    playerId: input.playerId,
    status: input.status,
    updatedAt: nowIso(),
    updatedBy: input.updatedBy,
  } satisfies AttendanceRecord);

  const nearestId = await loadNearestUpcomingGameId();
  const isNearest = nearestId === input.gameId;

  // Future (or past) games: save attendance only — do not touch Teams panel game.
  if (!isNearest) {
    await gameRef.update({
      updatedAt: nowIso(),
      lastAttendanceChange: {
        playerId: input.playerId,
        displayName,
        previousStatus,
        nextStatus: input.status,
        at: nowIso(),
      },
    });
    return {
      decision: attendanceOnlyDecision(
        Boolean(existingTeams?.includeMaybePlayers),
        settings.minPlaying
      ),
      previousStatus,
      nextStatus: input.status,
      playerId: input.playerId,
      displayName,
    };
  }

  const allAttendanceSnap = await db
    .collection("attendance")
    .where("gameId", "==", input.gameId)
    .get();
  const attendance = allAttendanceSnap.docs.map(
    (d) => d.data() as AttendanceRecord
  );

  const evalMap = Object.fromEntries(
    evalsSnap.docs.map((d) => {
      const ev = d.data() as PlayerEvaluation;
      return [ev.playerId, ev];
    })
  );

  const includeMaybe = Boolean(existingTeams?.includeMaybePlayers);

  const { includedRated, maybePlayerIds } = buildIncluded(
    attendance,
    players,
    evalMap,
    includeMaybe
  );

  const decision = decideTeamsSync({
    includedRated,
    maybePlayerIds,
    minPlaying: settings.minPlaying,
    includeMaybePlayers: includeMaybe,
    existing: existingTeams
      ? {
          teamA: existingTeams.teamA,
          teamB: existingTeams.teamB,
          published: Boolean(existingTeams.published),
          manuallyAdjusted: Boolean(existingTeams.manuallyAdjusted),
          includeMaybePlayers: Boolean(existingTeams.includeMaybePlayers),
        }
      : null,
  });

  await applyTeamsDecision({
    gameId: input.gameId,
    decision,
    updatedBy: input.updatedBy,
    lastAttendanceChange: {
      playerId: input.playerId,
      displayName,
      previousStatus,
      nextStatus: input.status,
      at: nowIso(),
    },
  });

  return {
    decision,
    previousStatus,
    nextStatus: input.status,
    playerId: input.playerId,
    displayName,
  };
}

export async function setIncludeMaybeAndRecalculate(input: {
  gameId: string;
  includeMaybePlayers: boolean;
  updatedBy: string | null;
}): Promise<TeamsSyncDecision> {
  const db = getAdminDb();
  const gameRef = db.collection("games").doc(input.gameId);
  const teamsRef = db.collection("gameTeams").doc(input.gameId);

  const nearestId = await loadNearestUpcomingGameId();
  if (nearestId !== input.gameId) {
    throw new Error(
      "Include Maybe only applies to the nearest upcoming game"
    );
  }

  const [gameSnap, attendanceSnap, playersSnap, evalsSnap, teamsSnap, settings] =
    await Promise.all([
      gameRef.get(),
      db.collection("attendance").where("gameId", "==", input.gameId).get(),
      db.collection("players").get(),
      db.collection("playerEvaluations").get(),
      teamsRef.get(),
      loadSettings(),
    ]);

  if (!gameSnap.exists) throw new Error(`Game ${input.gameId} not found`);

  const game = gameSnap.data() as Game;
  if (Boolean(game.noGame)) {
    throw new Error("Cannot generate teams: this date is marked No Game");
  }

  const attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
  const players = playersSnap.docs.map((d) => d.data() as Player);
  const evalMap = Object.fromEntries(
    evalsSnap.docs.map((d) => {
      const ev = d.data() as PlayerEvaluation;
      return [ev.playerId, ev];
    })
  );

  const existingTeams = teamsSnap.exists
    ? (teamsSnap.data() as GameTeams)
    : null;

  // Persist preference even before teams exist
  if (existingTeams) {
    await teamsRef.update({
      includeMaybePlayers: input.includeMaybePlayers,
      updatedAt: nowIso(),
    });
  } else {
    await teamsRef.set({
      gameId: input.gameId,
      teamA: [] as TeamMemberPublic[],
      teamB: [] as TeamMemberPublic[],
      published: false,
      publishedAt: null,
      updatedAt: nowIso(),
      updatedBy: input.updatedBy,
      manuallyAdjusted: false,
      includeMaybePlayers: input.includeMaybePlayers,
    } satisfies GameTeams);
  }

  const { includedRated, maybePlayerIds } = buildIncluded(
    attendance,
    players,
    evalMap,
    input.includeMaybePlayers
  );

  const decision = decideTeamsSync({
    includedRated,
    maybePlayerIds,
    minPlaying: settings.minPlaying,
    includeMaybePlayers: input.includeMaybePlayers,
    existing: {
      teamA: existingTeams?.teamA ?? [],
      teamB: existingTeams?.teamB ?? [],
      published: Boolean(existingTeams?.published),
      manuallyAdjusted: Boolean(existingTeams?.manuallyAdjusted),
      includeMaybePlayers: input.includeMaybePlayers,
    },
  });

  await applyTeamsDecision({
    gameId: input.gameId,
    decision,
    updatedBy: input.updatedBy,
  });

  return decision;
}

export async function regenerateTeamsFromAttendance(input: {
  gameId: string;
  updatedBy: string | null;
}): Promise<TeamsSyncDecision> {
  const db = getAdminDb();
  const teamsSnap = await db.collection("gameTeams").doc(input.gameId).get();
  const includeMaybe = teamsSnap.exists
    ? Boolean((teamsSnap.data() as GameTeams).includeMaybePlayers)
    : false;
  return setIncludeMaybeAndRecalculate({
    gameId: input.gameId,
    includeMaybePlayers: includeMaybe,
    updatedBy: input.updatedBy,
  });
}

/**
 * Always rebuild nearest upcoming gameTeams from active eligible attendance.
 * Used by player lifecycle (activate / deactivate / delete) and integrity repair.
 * Attendance eligibility wins over manuallyAdjusted arrangements.
 */
export async function recalculateNearestUpcomingTeams(
  updatedBy: string | null
): Promise<{ gameId: string | null; decision: TeamsSyncDecision | null }> {
  const nearestId = await loadNearestUpcomingGameId();
  if (!nearestId) {
    return { gameId: null, decision: null };
  }
  const decision = await regenerateTeamsFromAttendance({
    gameId: nearestId,
    updatedBy,
  });
  return { gameId: nearestId, decision };
}

/**
 * Inspect stored nearest gameTeams against the authoritative eligible set.
 * If stale (deleted / inactive / ineligible / duplicate / missing), recalculate.
 */
export async function ensureNearestTeamsIntegrity(
  updatedBy: string | null
): Promise<{
  gameId: string | null;
  repaired: boolean;
  decision: TeamsSyncDecision | null;
}> {
  const db = getAdminDb();
  const nearestId = await loadNearestUpcomingGameId();
  if (!nearestId) {
    return { gameId: null, repaired: false, decision: null };
  }

  const [teamsSnap, attendanceSnap, playersSnap, settings] = await Promise.all([
    db.collection("gameTeams").doc(nearestId).get(),
    db.collection("attendance").where("gameId", "==", nearestId).get(),
    db.collection("players").get(),
    loadSettings(),
  ]);

  const teams = teamsSnap.exists ? (teamsSnap.data() as GameTeams) : null;
  const includeMaybe = Boolean(teams?.includeMaybePlayers);
  const players = playersSnap.docs.map((d) => d.data() as Player);
  const attendance = attendanceSnap.docs.map(
    (d) => d.data() as AttendanceRecord
  );
  const eligibleIds = activeEligiblePlayerIds({
    players,
    attendance,
    includeMaybe,
  });

  const needsRepair = nearestTeamsNeedRepair({
    teamA: teams?.teamA ?? [],
    teamB: teams?.teamB ?? [],
    eligibleIds,
    minPlaying: settings.minPlaying,
  });

  if (!needsRepair) {
    return { gameId: nearestId, repaired: false, decision: null };
  }

  const decision = await regenerateTeamsFromAttendance({
    gameId: nearestId,
    updatedBy,
  });
  return { gameId: nearestId, repaired: true, decision };
}

export async function saveManualTeams(input: {
  gameId: string;
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  updatedBy: string | null;
}): Promise<void> {
  const nearestId = await loadNearestUpcomingGameId();
  if (nearestId !== input.gameId) {
    throw new Error("Manual team edits only apply to the nearest upcoming game");
  }
  if (teamSizeDiff(input.teamA, input.teamB) > 1) {
    throw new Error(
      `Unbalanced team sizes: ${input.teamA.length} vs ${input.teamB.length}`
    );
  }
  const ids = [...input.teamA, ...input.teamB].map((m) => m.playerId);
  assertValidTeamSplit(ids, input.teamA, input.teamB);

  const db = getAdminDb();
  const [gameSnap, playersSnap, attendanceSnap, teamsSnap] = await Promise.all([
    db.collection("games").doc(input.gameId).get(),
    db.collection("players").get(),
    db.collection("attendance").where("gameId", "==", input.gameId).get(),
    db.collection("gameTeams").doc(input.gameId).get(),
  ]);
  if (!gameSnap.exists) throw new Error(`Game ${input.gameId} not found`);
  if (Boolean((gameSnap.data() as Game).noGame)) {
    throw new Error("Cannot edit teams: this date is marked No Game");
  }

  const includeMaybe = teamsSnap.exists
    ? Boolean((teamsSnap.data() as GameTeams).includeMaybePlayers)
    : false;
  const players = playersSnap.docs.map((d) => d.data() as Player);
  const attendance = attendanceSnap.docs.map(
    (d) => d.data() as AttendanceRecord
  );
  const eligible = new Set(
    activeEligiblePlayerIds({
      players,
      attendance,
      includeMaybe,
    })
  );
  for (const id of ids) {
    if (!eligible.has(id)) {
      throw new Error(
        "Manual teams may only include active players with eligible attendance"
      );
    }
  }

  const teamsRef = db.collection("gameTeams").doc(input.gameId);
  const now = nowIso();
  await teamsRef.set({
    gameId: input.gameId,
    teamA: input.teamA,
    teamB: input.teamB,
    published: false,
    publishedAt: null,
    updatedAt: now,
    updatedBy: input.updatedBy,
    manuallyAdjusted: true,
    includeMaybePlayers: includeMaybe,
  } satisfies GameTeams);
  await db.collection("games").doc(input.gameId).update({
    updatedAt: now,
    teamsMayBeStale: false,
    teamsStatusMessage: "Teams ready",
  });
}

/**
 * Admin: mark/unmark a weekly date as No Game.
 * When enabling: clears all attendance and removes active teams for that game.
 * When disabling: attendance stays empty (—); players re-select.
 */
export async function setGameNoGame(input: {
  gameId: string;
  noGame: boolean;
  updatedBy: string | null;
}): Promise<{ noGame: boolean; clearedAttendance: number }> {
  const db = getAdminDb();
  const gameRef = db.collection("games").doc(input.gameId);
  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) {
    throw new Error(`Game ${input.gameId} not found`);
  }

  const existing = gameSnap.data() as Game;
  const currentlyNoGame = Boolean(existing.noGame);
  const nextNoGame = Boolean(input.noGame);

  if (currentlyNoGame === nextNoGame) {
    return { noGame: nextNoGame, clearedAttendance: 0 };
  }

  const now = nowIso();
  let clearedAttendance = 0;

  if (nextNoGame) {
    const attendanceSnap = await db
      .collection("attendance")
      .where("gameId", "==", input.gameId)
      .get();
    clearedAttendance = attendanceSnap.size;

    // Firestore batches max 500 ops
    const docs = attendanceSnap.docs;
    for (let i = 0; i < docs.length; i += 450) {
      const batch = db.batch();
      for (const d of docs.slice(i, i + 450)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }

    const teamsRef = db.collection("gameTeams").doc(input.gameId);
    const teamsSnap = await teamsRef.get();
    if (teamsSnap.exists) {
      await teamsRef.delete();
    }

    await gameRef.update({
      noGame: true,
      updatedAt: now,
      teamsMayBeStale: false,
      teamsStatusMessage: "No game this week",
      lastAttendanceChange: null,
    });
  } else {
    await gameRef.update({
      noGame: false,
      updatedAt: now,
      teamsMayBeStale: false,
      teamsStatusMessage: null,
      lastAttendanceChange: null,
    });
  }

  return { noGame: nextNoGame, clearedAttendance };
}
