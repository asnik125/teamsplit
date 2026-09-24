import { assertValidTeamSplit } from "./balancer";
import { computeBestBalancedSplit } from "./team-generate";
import type {
  AttendanceStatus,
  RatedPlayer,
  TeamMemberPublic,
} from "./types";

export const DEFAULT_MIN_PLAYING_FOR_TEAMS = 6;

/** @deprecated */
export const MIN_PLAYING_FOR_TEAMS = DEFAULT_MIN_PLAYING_FOR_TEAMS;

export function insufficientMessage(_minPlaying: number): string {
  return "Not enough players yet.";
}

/**
 * Attendance summary for the Teams panel.
 * - Does NOT show "/ minPlaying" — that threshold is only for team generation.
 * - "confirmed" = Playing; optionally append Maybe count when present.
 */
export function confirmedAttendanceLabel(input: {
  playingCount: number;
  maybeCount: number;
}): string {
  const playing = Math.max(0, Math.floor(input.playingCount));
  const maybe = Math.max(0, Math.floor(input.maybeCount));
  if (maybe > 0) {
    return `${playing} confirmed + ${maybe} maybe`;
  }
  if (playing === 1) return "1 player confirmed";
  return `${playing} players confirmed`;
}

/** @deprecated Use confirmedAttendanceLabel — kept for call-site migration. */
export function confirmedProgressLabel(
  includedCount: number,
  _minPlaying: number
): string {
  return confirmedAttendanceLabel({
    playingCount: includedCount,
    maybeCount: 0,
  });
}

export function isIncludedForTeams(
  status: AttendanceStatus,
  includeMaybe: boolean
): boolean {
  if (status === "playing") return true;
  if (includeMaybe && status === "maybe") return true;
  return false;
}

export type TeamsSyncAction =
  | "insufficient"
  | "created"
  | "updated"
  | "unchanged";

export interface ExistingTeamsSnapshot {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  published: boolean;
  manuallyAdjusted: boolean;
  includeMaybePlayers: boolean;
}

export interface TeamsSyncDecision {
  action: TeamsSyncAction;
  message: string;
  playingCount: number;
  includedCount: number;
  minPlaying: number;
  includeMaybePlayers: boolean;
  writeTeams: boolean;
  clearTeams: boolean;
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  markStale: boolean;
  manuallyAdjusted: boolean;
  keepPublished: boolean;
}

/**
 * Pure helper: single best skill-balanced split for a rated pool.
 * Production attendance sync does NOT call this — it only marks stale.
 * Explicit Admin Generate uses generateTeamsExplicit → computeBestBalancedSplit.
 */
export function decideTeamsSync(input: {
  includedRated: RatedPlayer[];
  maybePlayerIds?: Set<string>;
  existing: ExistingTeamsSnapshot | null;
  minPlaying?: number;
  includeMaybePlayers?: boolean;
}): TeamsSyncDecision {
  const minPlaying = Math.max(
    2,
    Math.floor(input.minPlaying ?? DEFAULT_MIN_PLAYING_FOR_TEAMS)
  );
  const includeMaybePlayers = Boolean(input.includeMaybePlayers);
  const includedCount = input.includedRated.length;
  const existing = input.existing;
  const maybeIds = input.maybePlayerIds ?? new Set<string>();

  if (includedCount < minPlaying) {
    return {
      action: "insufficient",
      message: insufficientMessage(minPlaying),
      playingCount: includedCount,
      includedCount,
      minPlaying,
      includeMaybePlayers,
      writeTeams: false,
      clearTeams: Boolean(existing),
      teamA: [],
      teamB: [],
      markStale: false,
      manuallyAdjusted: false,
      keepPublished: false,
    };
  }

  const { teamA: publicA, teamB: publicB } = computeBestBalancedSplit({
    rated: input.includedRated,
    maybePlayerIds: maybeIds,
  });
  assertValidTeamSplit(
    input.includedRated.map((p) => p.id),
    publicA,
    publicB
  );

  const hadTeams =
    Boolean(existing) &&
    (existing!.teamA.length > 0 || existing!.teamB.length > 0);

  return {
    action: hadTeams ? "updated" : "created",
    message: "Teams ready",
    playingCount: includedCount,
    includedCount,
    minPlaying,
    includeMaybePlayers,
    writeTeams: true,
    clearTeams: false,
    teamA: publicA,
    teamB: publicB,
    markStale: false,
    manuallyAdjusted: false,
    keepPublished: false,
  };
}

export function playingIdsFromAttendance(
  records: { playerId: string; status: AttendanceStatus }[]
): string[] {
  return records
    .filter((r) => r.status === "playing")
    .map((r) => r.playerId);
}
