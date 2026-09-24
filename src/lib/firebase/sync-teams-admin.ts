import {
  assertValidTeamSplit,
  teamSizeDiff,
} from "../balancer";
import type {
  AttendanceRecord,
  AttendanceStatus,
  Game,
  GameTeams,
  Player,
  PlayerEvaluation,
  AppSettings,
  TeamMemberPublic,
} from "../types";
import {
  DEFAULT_MIN_PLAYING_FOR_TEAMS,
  isIncludedForTeams,
  type TeamsSyncDecision,
} from "../team-sync";
import { activeEligiblePlayerIds } from "../player-lifecycle";
import { nextUpcomingGame } from "../schedule";
import {
  areTeamsStale,
  eligiblePlayerIdsFromAttendance,
  eligiblePoolFingerprint,
  teamsHaveComposition,
  teamsStatusMessageForState,
  TEAMS_STALE_MESSAGE,
  TEAMS_READY_MESSAGE,
} from "../team-eligibility";
import {
  buildRatedEligible,
  computeBestBalancedSplit,
  MissingEvaluationError,
} from "../team-generate";
import { getAdminDb } from "./admin";

function nowIso() {
  return new Date().toISOString();
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

async function loadNearestUpcomingGameId(): Promise<string | null> {
  const snap = await getAdminDb()
    .collection("games")
    .where("status", "==", "scheduled")
    .get();
  const games = snap.docs.map((d) => d.data() as Game);
  return nextUpcomingGame(games)?.id ?? null;
}

function emptyDecision(
  includeMaybePlayers: boolean,
  minPlaying: number,
  message: string
): TeamsSyncDecision {
  return {
    action: "unchanged",
    message,
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

/**
 * Mark existing composition outdated without changing membership.
 * Preserves manual adjustments and previous roster for Admin review.
 */
async function refreshGameTeamsBanner(input: {
  gameId: string;
  teams: GameTeams | null;
  eligibleIds: string[];
  minPlaying: number;
  lastAttendanceChange?: Game["lastAttendanceChange"];
}): Promise<{ stale: boolean; message: string }> {
  const db = getAdminDb();
  const now = nowIso();
  const hasComposition = teamsHaveComposition(input.teams);
  const stale = areTeamsStale({
    teams: input.teams,
    currentEligibleIds: input.eligibleIds,
  });
  const message = teamsStatusMessageForState({
    hasComposition,
    stale,
    includedCount: input.eligibleIds.length,
    minPlaying: input.minPlaying,
  });

  if (hasComposition && stale && input.teams && !input.teams.stale) {
    await db.collection("gameTeams").doc(input.gameId).update({
      stale: true,
      updatedAt: now,
    });
  }

  const gameUpdate: Partial<Game> = {
    updatedAt: now,
    teamsMayBeStale: stale,
    teamsStatusMessage: message,
  };
  if (input.lastAttendanceChange) {
    gameUpdate.lastAttendanceChange = input.lastAttendanceChange;
  }
  await db.collection("games").doc(input.gameId).update(gameUpdate);
  return { stale, message };
}

export interface AttendanceSyncResult {
  decision: TeamsSyncDecision;
  previousStatus: AttendanceStatus | null;
  nextStatus: AttendanceStatus;
  playerId: string;
  displayName: string;
}

/**
 * Save attendance only. Never regenerates or clears gameTeams.
 * If a composition exists and the eligible pool changed, marks it stale.
 */
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

  const [gameSnap, attendanceSnap, teamsSnap, playersSnap, settings] =
    await Promise.all([
      gameRef.get(),
      attendanceRef.get(),
      teamsRef.get(),
      db.collection("players").get(),
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

  const allAttendanceSnap = await db
    .collection("attendance")
    .where("gameId", "==", input.gameId)
    .get();
  const attendance = allAttendanceSnap.docs.map(
    (d) => d.data() as AttendanceRecord
  );
  const includeMaybe = Boolean(existingTeams?.includeMaybePlayers);
  const eligibleIds = eligiblePlayerIdsFromAttendance({
    players,
    attendance,
    includeMaybe,
  });

  const { stale, message } = await refreshGameTeamsBanner({
    gameId: input.gameId,
    teams: existingTeams,
    eligibleIds,
    minPlaying: settings.minPlaying,
    lastAttendanceChange: {
      playerId: input.playerId,
      displayName,
      previousStatus,
      nextStatus: input.status,
      at: nowIso(),
    },
  });

  return {
    decision: emptyDecision(
      includeMaybe,
      settings.minPlaying,
      stale ? TEAMS_STALE_MESSAGE : message
    ),
    previousStatus,
    nextStatus: input.status,
    playerId: input.playerId,
    displayName,
  };
}

/**
 * Toggle Include Maybe preference. Does not regenerate teams.
 * Marks existing composition stale when the eligible pool changes.
 */
export async function setIncludeMaybePreference(input: {
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

  const [gameSnap, attendanceSnap, playersSnap, teamsSnap, settings] =
    await Promise.all([
      gameRef.get(),
      db.collection("attendance").where("gameId", "==", input.gameId).get(),
      db.collection("players").get(),
      teamsRef.get(),
      loadSettings(),
    ]);

  if (!gameSnap.exists) throw new Error(`Game ${input.gameId} not found`);
  const game = gameSnap.data() as Game;
  if (Boolean(game.noGame)) {
    throw new Error("Cannot update Include Maybe: this date is marked No Game");
  }

  const attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
  const players = playersSnap.docs.map((d) => d.data() as Player);
  const existingTeams = teamsSnap.exists
    ? (teamsSnap.data() as GameTeams)
    : null;
  const now = nowIso();

  const nextTeams: GameTeams = existingTeams
    ? {
        ...existingTeams,
        includeMaybePlayers: input.includeMaybePlayers,
        updatedAt: now,
        updatedBy: input.updatedBy,
      }
    : {
        gameId: input.gameId,
        teamA: [],
        teamB: [],
        published: false,
        publishedAt: null,
        updatedAt: now,
        updatedBy: input.updatedBy,
        manuallyAdjusted: false,
        includeMaybePlayers: input.includeMaybePlayers,
        stale: false,
        eligibleFingerprint: null,
      };

  const eligibleIds = eligiblePlayerIdsFromAttendance({
    players,
    attendance,
    includeMaybe: input.includeMaybePlayers,
  });
  const stale = areTeamsStale({
    teams: {
      ...nextTeams,
      // Evaluate pool change against previous fingerprint / membership
      includeMaybePlayers: input.includeMaybePlayers,
    },
    currentEligibleIds: eligibleIds,
  });

  if (teamsHaveComposition(existingTeams) && stale) {
    nextTeams.stale = true;
  }

  await teamsRef.set(nextTeams);
  const message = teamsStatusMessageForState({
    hasComposition: teamsHaveComposition(nextTeams),
    stale: Boolean(nextTeams.stale),
    includedCount: eligibleIds.length,
    minPlaying: settings.minPlaying,
  });
  await gameRef.update({
    updatedAt: now,
    teamsMayBeStale: Boolean(nextTeams.stale),
    teamsStatusMessage: message,
  });

  return emptyDecision(
    input.includeMaybePlayers,
    settings.minPlaying,
    message
  );
}

/** @deprecated Use setIncludeMaybePreference — kept for import compatibility. */
export async function setIncludeMaybeAndRecalculate(input: {
  gameId: string;
  includeMaybePlayers: boolean;
  updatedBy: string | null;
}): Promise<TeamsSyncDecision> {
  return setIncludeMaybePreference(input);
}

export interface GenerateTeamsResult {
  decision: TeamsSyncDecision;
  stale: false;
}

/**
 * Explicit Admin Generate: single best skill-balanced split from current
 * attendance. Replaces any prior/manual composition.
 */
export async function generateTeamsExplicit(input: {
  gameId: string;
  updatedBy: string | null;
}): Promise<GenerateTeamsResult> {
  const db = getAdminDb();
  const gameRef = db.collection("games").doc(input.gameId);
  const teamsRef = db.collection("gameTeams").doc(input.gameId);

  const nearestId = await loadNearestUpcomingGameId();
  if (nearestId !== input.gameId) {
    throw new Error("Generate Teams only applies to the nearest upcoming game");
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

  const existingTeams = teamsSnap.exists
    ? (teamsSnap.data() as GameTeams)
    : null;
  const includeMaybe = Boolean(existingTeams?.includeMaybePlayers);
  const attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
  const players = playersSnap.docs.map((d) => d.data() as Player);
  const evalMap = Object.fromEntries(
    evalsSnap.docs.map((d) => {
      const ev = d.data() as PlayerEvaluation;
      return [ev.playerId, ev];
    })
  );

  const eligibleIds = eligiblePlayerIdsFromAttendance({
    players,
    attendance,
    includeMaybe,
  });

  if (eligibleIds.length < settings.minPlaying) {
    const message = "Not enough players yet.";
    await gameRef.update({
      updatedAt: nowIso(),
      teamsMayBeStale: false,
      teamsStatusMessage: message,
    });
    throw Object.assign(new Error(message), {
      code: "insufficient_players",
      includedCount: eligibleIds.length,
      minPlaying: settings.minPlaying,
    });
  }

  const maybePlayerIds = new Set(
    attendance
      .filter((a) => a.status === "maybe" && eligibleIds.includes(a.playerId))
      .map((a) => a.playerId)
  );

  let rated;
  try {
    ({ rated } = buildRatedEligible({
      eligibleIds,
      players,
      evalMap,
      maybePlayerIds,
    }));
  } catch (e) {
    if (e instanceof MissingEvaluationError) {
      throw Object.assign(e, { code: "missing_evaluation" });
    }
    throw e;
  }

  const best = computeBestBalancedSplit({
    rated,
    maybePlayerIds,
  });

  const fingerprint = eligiblePoolFingerprint(eligibleIds);
  const now = nowIso();
  const payload: GameTeams = {
    gameId: input.gameId,
    teamA: best.teamA,
    teamB: best.teamB,
    published: false,
    publishedAt: null,
    updatedAt: now,
    updatedBy: input.updatedBy,
    manuallyAdjusted: false,
    includeMaybePlayers: includeMaybe,
    eligibleFingerprint: fingerprint,
    stale: false,
  };
  await teamsRef.set(payload);
  await gameRef.update({
    updatedAt: now,
    teamsMayBeStale: false,
    teamsStatusMessage: TEAMS_READY_MESSAGE,
  });

  return {
    decision: {
      action: "created",
      message: TEAMS_READY_MESSAGE,
      playingCount: eligibleIds.length,
      includedCount: eligibleIds.length,
      minPlaying: settings.minPlaying,
      includeMaybePlayers: includeMaybe,
      writeTeams: true,
      clearTeams: false,
      teamA: best.teamA,
      teamB: best.teamB,
      markStale: false,
      manuallyAdjusted: false,
      keepPublished: false,
    },
    stale: false,
  };
}

/** @deprecated Prefer generateTeamsExplicit — Admin regenerate route. */
export async function regenerateTeamsFromAttendance(input: {
  gameId: string;
  updatedBy: string | null;
}): Promise<TeamsSyncDecision> {
  const result = await generateTeamsExplicit(input);
  return result.decision;
}

/**
 * Lifecycle helper: mark nearest teams stale when roster eligibility may have
 * changed (activate/deactivate/delete). Does not regenerate.
 */
export async function markNearestTeamsStaleAfterLifecycle(
  updatedBy: string | null
): Promise<{ gameId: string | null; marked: boolean }> {
  void updatedBy;
  const nearestId = await loadNearestUpcomingGameId();
  if (!nearestId) return { gameId: null, marked: false };

  const db = getAdminDb();
  const [teamsSnap, attendanceSnap, playersSnap, settings] = await Promise.all([
    db.collection("gameTeams").doc(nearestId).get(),
    db.collection("attendance").where("gameId", "==", nearestId).get(),
    db.collection("players").get(),
    loadSettings(),
  ]);
  const teams = teamsSnap.exists ? (teamsSnap.data() as GameTeams) : null;
  if (!teamsHaveComposition(teams)) {
    return { gameId: nearestId, marked: false };
  }
  const players = playersSnap.docs.map((d) => d.data() as Player);
  const attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
  const eligibleIds = eligiblePlayerIdsFromAttendance({
    players,
    attendance,
    includeMaybe: Boolean(teams!.includeMaybePlayers),
  });
  const { stale } = await refreshGameTeamsBanner({
    gameId: nearestId,
    teams,
    eligibleIds,
    minPlaying: settings.minPlaying,
  });
  return { gameId: nearestId, marked: stale };
}

/** @deprecated No longer recalculates — marks stale if pool drifted. */
export async function recalculateNearestUpcomingTeams(
  updatedBy: string | null
): Promise<{ gameId: string | null; decision: TeamsSyncDecision | null }> {
  const { gameId, marked } = await markNearestTeamsStaleAfterLifecycle(updatedBy);
  return {
    gameId,
    decision: gameId
      ? emptyDecision(false, DEFAULT_MIN_PLAYING_FOR_TEAMS, marked ? TEAMS_STALE_MESSAGE : "ok")
      : null,
  };
}

/**
 * Integrity endpoint: no longer auto-regenerates from attendance.
 * Returns whether the composition is stale for UI refresh.
 */
export async function ensureNearestTeamsIntegrity(
  updatedBy: string | null
): Promise<{
  gameId: string | null;
  repaired: boolean;
  decision: TeamsSyncDecision | null;
}> {
  void updatedBy;
  const nearestId = await loadNearestUpcomingGameId();
  if (!nearestId) {
    return { gameId: null, repaired: false, decision: null };
  }
  const db = getAdminDb();
  const [teamsSnap, attendanceSnap, playersSnap, settings] = await Promise.all([
    db.collection("gameTeams").doc(nearestId).get(),
    db.collection("attendance").where("gameId", "==", nearestId).get(),
    db.collection("players").get(),
    loadSettings(),
  ]);
  const teams = teamsSnap.exists ? (teamsSnap.data() as GameTeams) : null;
  const players = playersSnap.docs.map((d) => d.data() as Player);
  const attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
  const eligibleIds = eligiblePlayerIdsFromAttendance({
    players,
    attendance,
    includeMaybe: Boolean(teams?.includeMaybePlayers),
  });
  await refreshGameTeamsBanner({
    gameId: nearestId,
    teams,
    eligibleIds,
    minPlaying: settings.minPlaying,
  });
  return { gameId: nearestId, repaired: false, decision: null };
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

  const existing = teamsSnap.exists ? (teamsSnap.data() as GameTeams) : null;
  const includeMaybe = Boolean(existing?.includeMaybePlayers);
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

  const fingerprint = eligiblePoolFingerprint([...eligible]);
  const now = nowIso();
  await db.collection("gameTeams").doc(input.gameId).set({
    gameId: input.gameId,
    teamA: input.teamA,
    teamB: input.teamB,
    published: false,
    publishedAt: null,
    updatedAt: now,
    updatedBy: input.updatedBy,
    manuallyAdjusted: true,
    includeMaybePlayers: includeMaybe,
    eligibleFingerprint: fingerprint,
    stale: false,
  } satisfies GameTeams);
  await db.collection("games").doc(input.gameId).update({
    updatedAt: now,
    teamsMayBeStale: false,
    teamsStatusMessage: TEAMS_READY_MESSAGE,
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

    const docs = attendanceSnap.docs;
    for (let i = 0; i < docs.length; i += 450) {
      const batch = db.batch();
      for (const d of docs.slice(i, i + 450)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }

    await db.collection("gameTeams").doc(input.gameId).set({
      gameId: input.gameId,
      teamA: [],
      teamB: [],
      published: false,
      publishedAt: null,
      updatedAt: now,
      updatedBy: input.updatedBy,
      manuallyAdjusted: false,
      includeMaybePlayers: false,
      stale: false,
      eligibleFingerprint: null,
    } satisfies GameTeams);

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
    });
  }

  return { noGame: nextNoGame, clearedAttendance };
}

// Re-export for callers that checked inclusion
export { isIncludedForTeams };
