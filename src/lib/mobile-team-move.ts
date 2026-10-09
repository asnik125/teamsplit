import type { GameTeams, TeamMemberPublic } from "./types";

export type MobileTeamSide = "A" | "B" | "C";

/**
 * Move one player onto another generated team.
 * Does not swap or rebalance anyone else.
 */
export function movePlayerToSide(input: {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  teamC?: TeamMemberPublic[];
  playerId: string;
  to: MobileTeamSide;
}): {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  teamC: TeamMemberPublic[];
} {
  const buckets: Record<MobileTeamSide, TeamMemberPublic[]> = {
    A: [...input.teamA],
    B: [...input.teamB],
    C: [...(input.teamC ?? [])],
  };
  let from: MobileTeamSide | null = null;
  let player: TeamMemberPublic | undefined;
  for (const side of ["A", "B", "C"] as const) {
    const found = buckets[side].find((m) => m.playerId === input.playerId);
    if (found) {
      from = side;
      player = found;
    }
  }
  if (!from || !player) {
    throw new Error(`Player ${input.playerId} not found on any team`);
  }
  if (from === input.to) {
    return { teamA: buckets.A, teamB: buckets.B, teamC: buckets.C };
  }
  buckets[from] = buckets[from].filter((m) => m.playerId !== input.playerId);
  buckets[input.to] = [...buckets[input.to], player];
  return { teamA: buckets.A, teamB: buckets.B, teamC: buckets.C };
}

/** Roster shown after the manual-save request succeeds. */
export function applySavedManualTeams(
  current: GameTeams,
  proposed: {
    teamA: TeamMemberPublic[];
    teamB: TeamMemberPublic[];
    teamC?: TeamMemberPublic[];
  }
): GameTeams {
  const next: GameTeams = {
    ...current,
    teamA: proposed.teamA,
    teamB: proposed.teamB,
    manuallyAdjusted: true,
  };
  if (proposed.teamC && proposed.teamC.length > 0) next.teamC = proposed.teamC;
  else delete next.teamC;
  return next;
}

/**
 * After a failed save, keep the previous roster unless a refresh
 * returns the document still stored on the server.
 */
export function rosterAfterFailedManualSave(
  current: GameTeams,
  refreshed: GameTeams | null
): GameTeams {
  return refreshed ?? current;
}

/** Ignores a second move until the in-flight save finishes. */
export function createMoveGate() {
  let active = false;
  return {
    tryEnter(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    leave() {
      active = false;
    },
  };
}
