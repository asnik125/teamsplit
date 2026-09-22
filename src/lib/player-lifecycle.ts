import { gameHasNotStarted, isPlayableGame } from "./schedule";
import { isIncludedForTeams } from "./team-sync";
import type { AttendanceStatus, Game } from "./types";

/**
 * Reactivation attendance policy (MVP):
 *
 * When a player is reactivated, attendance documents for all playable upcoming
 * games (scheduled, not started, not No Game) are deleted so the UI shows "—"
 * and stale `playing` / `maybe` cannot silently restore team eligibility.
 *
 * Historical attendance for past / started / completed / No Game dates is kept.
 */

export function gamesRequiringAttendanceResetOnReactivate(
  games: Game[],
  now = new Date()
): Game[] {
  return games.filter(
    (g) => isPlayableGame(g) && gameHasNotStarted(g, now)
  );
}

/** Active players with eligible attendance for team generation. */
export function activeEligiblePlayerIds(input: {
  players: { id: string; active: boolean }[];
  attendance: { playerId: string; status: AttendanceStatus }[];
  includeMaybe: boolean;
}): string[] {
  const activeIds = new Set(
    input.players.filter((p) => p.active).map((p) => p.id)
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of input.attendance) {
    if (!activeIds.has(a.playerId)) continue;
    if (!isIncludedForTeams(a.status, input.includeMaybe)) continue;
    if (seen.has(a.playerId)) continue;
    seen.add(a.playerId);
    out.push(a.playerId);
  }
  return out;
}

export type TeamsIntegrityResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Core invariant for stored nearest-game teams:
 * Teams ⊆ active eligible players, and when teams are non-empty they must
 * match the eligible set exactly (no ghosts, no duplicates, no missing).
 * When eligible count is below minPlaying, teams must be empty.
 */
export function nearestTeamsIntegrity(input: {
  teamA: { playerId: string }[];
  teamB: { playerId: string }[];
  eligibleIds: string[];
  minPlaying: number;
}): TeamsIntegrityResult {
  const eligible = new Set(input.eligibleIds);
  const all = [...input.teamA, ...input.teamB].map((m) => m.playerId);
  const seen = new Set<string>();

  for (const id of all) {
    if (!eligible.has(id)) {
      return { ok: false, reason: `ineligible:${id}` };
    }
    if (seen.has(id)) {
      return { ok: false, reason: `duplicate:${id}` };
    }
    seen.add(id);
  }

  if (input.eligibleIds.length < input.minPlaying) {
    if (all.length > 0) {
      return { ok: false, reason: "should_be_cleared" };
    }
    return { ok: true };
  }

  if (all.length === 0) {
    return { ok: false, reason: "missing_teams" };
  }

  if (all.length !== eligible.size) {
    return { ok: false, reason: "size_mismatch" };
  }

  for (const id of eligible) {
    if (!seen.has(id)) {
      return { ok: false, reason: `missing:${id}` };
    }
  }

  return { ok: true };
}

export function nearestTeamsNeedRepair(input: {
  teamA: { playerId: string }[];
  teamB: { playerId: string }[];
  eligibleIds: string[];
  minPlaying: number;
}): boolean {
  return !nearestTeamsIntegrity(input).ok;
}
