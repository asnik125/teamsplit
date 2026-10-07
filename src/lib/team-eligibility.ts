import type { AttendanceStatus, GameTeams } from "./types";
import { isIncludedForTeams } from "./team-sync";

export const TEAMS_STALE_MESSAGE = "Attendance changed — generate teams again";
export const TEAMS_READY_MESSAGE = "Teams ready";
export const TEAMS_AWAITING_GENERATE_MESSAGE = "Generate teams when ready";

/**
 * Confirmed Playing among active players. Maybe never counts, even when
 * Include Maybe is on for generation.
 */
export function countConfirmedPlaying(input: {
  players: { id: string; active: boolean }[];
  attendance: { playerId: string; status: AttendanceStatus }[];
}): number {
  const active = new Set(
    input.players.filter((p) => p.active).map((p) => p.id)
  );
  const seen = new Set<string>();
  let count = 0;
  for (const row of input.attendance) {
    if (!active.has(row.playerId) || row.status !== "playing") continue;
    if (seen.has(row.playerId)) continue;
    seen.add(row.playerId);
    count += 1;
  }
  return count;
}

/** Saved teams may exist only while confirmed Playing meets the minimum. */
export function shouldClearGeneratedTeams(input: {
  playingCount: number;
  minPlaying: number;
  hasComposition: boolean;
}): boolean {
  const minPlaying = Math.max(2, Math.floor(input.minPlaying));
  return input.hasComposition && input.playingCount < minPlaying;
}

/** Drop saved rosters in memory while an attendance save is in flight. */
export function withoutGeneratedRosters(teams: GameTeams): GameTeams {
  const next: GameTeams = {
    ...teams,
    teamA: [],
    teamB: [],
    stale: false,
    eligibleFingerprint: null,
  };
  delete next.teamC;
  return next;
}

/** Empty roster written over a saved game. Omits teamC so a replace drops it. */
export function clearedGeneratedTeams(input: {
  gameId: string;
  includeMaybePlayers: boolean;
  updatedAt: string;
  updatedBy: string | null;
}): GameTeams {
  return {
    gameId: input.gameId,
    teamA: [],
    teamB: [],
    published: false,
    publishedAt: null,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
    manuallyAdjusted: false,
    includeMaybePlayers: input.includeMaybePlayers,
    stale: false,
    eligibleFingerprint: null,
  };
}

/** Sorted eligible player ids for a given includeMaybe preference. */
export function eligiblePlayerIdsFromAttendance(input: {
  players: { id: string; active: boolean }[];
  attendance: { playerId: string; status: AttendanceStatus }[];
  includeMaybe: boolean;
}): string[] {
  const active = new Set(
    input.players.filter((p) => p.active).map((p) => p.id)
  );
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const a of input.attendance) {
    if (!active.has(a.playerId)) continue;
    if (!isIncludedForTeams(a.status, input.includeMaybe)) continue;
    if (seen.has(a.playerId)) continue;
    seen.add(a.playerId);
    ids.push(a.playerId);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/** Stable fingerprint of the eligible pool (sorted ids joined). */
export function eligiblePoolFingerprint(eligibleIds: string[]): string {
  return [...eligibleIds].sort((a, b) => a.localeCompare(b)).join(",");
}

export function teamsHaveComposition(teams: GameTeams | null | undefined): boolean {
  if (!teams) return false;
  return (
    teams.teamA.length + teams.teamB.length + (teams.teamC?.length ?? 0) > 0
  );
}

/**
 * Whether stored teams are outdated vs current eligible pool.
 * Empty compositions are not "stale" — Admin simply has not generated yet.
 */
export function areTeamsStale(input: {
  teams: GameTeams | null | undefined;
  currentEligibleIds: string[];
}): boolean {
  const { teams } = input;
  if (!teamsHaveComposition(teams)) return false;
  if (teams!.stale === true) return true;
  const stored = teams!.eligibleFingerprint;
  if (typeof stored !== "string" || stored.length === 0) {
    // Legacy docs without fingerprint: compare membership to current pool.
    const memberIds = [
      ...teams!.teamA,
      ...teams!.teamB,
      ...(teams!.teamC ?? []),
    ]
      .map((m) => m.playerId)
      .sort((a, b) => a.localeCompare(b));
    const current = [...input.currentEligibleIds].sort((a, b) =>
      a.localeCompare(b)
    );
    if (memberIds.length !== current.length) return true;
    return memberIds.some((id, i) => id !== current[i]);
  }
  return stored !== eligiblePoolFingerprint(input.currentEligibleIds);
}

export function teamsStatusMessageForState(input: {
  hasComposition: boolean;
  stale: boolean;
  includedCount: number;
  /** Confirmed Playing. When omitted, includedCount is used. */
  playingCount?: number;
  minPlaying: number;
}): string {
  const playing = input.playingCount ?? input.includedCount;
  if (playing < input.minPlaying && input.includedCount < input.minPlaying) {
    return "Not enough players yet.";
  }
  if (!input.hasComposition) {
    return TEAMS_AWAITING_GENERATE_MESSAGE;
  }
  if (input.stale) {
    return TEAMS_STALE_MESSAGE;
  }
  return TEAMS_READY_MESSAGE;
}
