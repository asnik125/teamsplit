import type { PlayerRatings, RatedPlayer, TeamMemberPublic } from "./types";
import { RATING_KEYS } from "./types";

/**
 * Preserved from soccer_player_evaluation_team_balancer.html:
 * overall = arithmetic mean of the 11 rating dimensions.
 */
export function calculateOverall(ratings: PlayerRatings): number {
  const sum = RATING_KEYS.reduce((acc, key) => acc + Number(ratings[key] || 0), 0);
  return Number((sum / RATING_KEYS.length).toFixed(1));
}

export interface TeamSplit<T> {
  teamA: T[];
  teamB: T[];
}

/**
 * Preserved snake-draft distribution from the reference HTML:
 * sort by overall desc, then assign by cycle index % 4:
 * 0 → team1 (A), 1 → team2 (B), 2 → team2 (B), 3 → team1 (A)
 *
 * After assignment, enforce |A.length - B.length| <= 1 (safety).
 */
export function generateSnakeDraftTeams<T extends { overall: number }>(
  players: T[]
): TeamSplit<T> {
  if (players.length < 2) {
    throw new Error("At least 2 players are required to generate teams");
  }

  const sorted = [...players].sort((a, b) => b.overall - a.overall);
  const teamA: T[] = [];
  const teamB: T[] = [];

  sorted.forEach((player, index) => {
    const cycle = index % 4;
    if (cycle === 0 || cycle === 3) {
      teamA.push(player);
    } else {
      teamB.push(player);
    }
  });

  return enforceTeamSizeBalance(teamA, teamB);
}

/** Move players from the larger team to the smaller until sizes differ by at most 1. */
export function enforceTeamSizeBalance<T>(
  teamA: T[],
  teamB: T[]
): TeamSplit<T> {
  const a = [...teamA];
  const b = [...teamB];
  while (Math.abs(a.length - b.length) > 1) {
    if (a.length > b.length) {
      const moved = a.pop();
      if (!moved) break;
      b.push(moved);
    } else {
      const moved = b.pop();
      if (!moved) break;
      a.push(moved);
    }
  }
  return { teamA: a, teamB: b };
}

export function teamSizeDiff(teamA: { length: number }, teamB: { length: number }): number {
  return Math.abs(teamA.length - teamB.length);
}

/**
 * Validate generated / displayed teams against the eligible set.
 * Throws if any invariant fails.
 */
export function assertValidTeamSplit(
  eligibleIds: Iterable<string>,
  teamA: { id?: string; playerId?: string }[],
  teamB: { id?: string; playerId?: string }[]
): void {
  const eligible = [...new Set([...eligibleIds])].sort();
  const idOf = (m: { id?: string; playerId?: string }) => m.id ?? m.playerId ?? "";
  const assigned = [...teamA, ...teamB].map(idOf).filter(Boolean);
  const unique = new Set(assigned);

  if (unique.size !== assigned.length) {
    throw new Error("Duplicate players detected across teams");
  }
  if (assigned.length !== eligible.length) {
    throw new Error(
      `Team membership size mismatch: ${assigned.length} assigned vs ${eligible.length} eligible`
    );
  }
  const sortedAssigned = [...assigned].sort();
  for (let i = 0; i < eligible.length; i++) {
    if (sortedAssigned[i] !== eligible[i]) {
      throw new Error("Team membership does not match eligible player set");
    }
  }
  if (teamSizeDiff(teamA, teamB) > 1) {
    throw new Error(
      `Unbalanced team sizes: ${teamA.length} vs ${teamB.length}`
    );
  }
}

export function teamStrength(players: { overall: number }[]): number {
  return Number(players.reduce((sum, p) => sum + p.overall, 0).toFixed(1));
}

/**
 * Preserved auto-rebalance from the reference HTML:
 * After moving `movedPlayerId` into the target team, find a different player
 * on the target team whose swap back minimizes |sumA - sumB|.
 * Only swaps if that improves (strictly lowers) the current difference.
 */
export function autoRebalanceAfterMove(
  teamA: RatedPlayer[],
  teamB: RatedPlayer[],
  movedPlayerId: string,
  movedTo: "A" | "B"
): TeamSplit<RatedPlayer> {
  const target = movedTo === "A" ? [...teamA] : [...teamB];
  const source = movedTo === "A" ? [...teamB] : [...teamA];

  const sum = (list: RatedPlayer[]) =>
    list.reduce((acc, p) => acc + p.overall, 0);

  const currentTargetSum = sum(target);
  const currentSourceSum = sum(source);
  let minDiff = Math.abs(currentTargetSum - currentSourceSum);

  const candidates = target.filter((p) => p.id !== movedPlayerId);
  if (candidates.length === 0) {
    return movedTo === "A"
      ? { teamA: target, teamB: source }
      : { teamA: source, teamB: target };
  }

  let bestCandidateId: string | null = null;

  for (const cand of candidates) {
    const hypTargetSum = currentTargetSum - cand.overall;
    const hypSourceSum = currentSourceSum + cand.overall;
    const hypDiff = Math.abs(hypTargetSum - hypSourceSum);
    if (hypDiff < minDiff) {
      minDiff = hypDiff;
      bestCandidateId = cand.id;
    }
  }

  if (bestCandidateId) {
    const idx = target.findIndex((p) => p.id === bestCandidateId);
    const [swapped] = target.splice(idx, 1);
    source.push(swapped);
  }

  return movedTo === "A"
    ? { teamA: target, teamB: source }
    : { teamA: source, teamB: target };
}

/** Move a player to the other team without auto-rebalance (explicit Admin move). */
export function movePlayerBetweenTeams(
  teamA: RatedPlayer[],
  teamB: RatedPlayer[],
  playerId: string,
  to: "A" | "B"
): TeamSplit<RatedPlayer> {
  const fromA = teamA.find((p) => p.id === playerId);
  const fromB = teamB.find((p) => p.id === playerId);
  if (!fromA && !fromB) {
    throw new Error(`Player ${playerId} not found on either team`);
  }

  let nextA = teamA.filter((p) => p.id !== playerId);
  let nextB = teamB.filter((p) => p.id !== playerId);
  const player = (fromA || fromB)!;

  if (to === "A") nextA = [...nextA, player];
  else nextB = [...nextB, player];

  return { teamA: nextA, teamB: nextB };
}

/**
 * Admin drag/drop: move player to the other team while keeping
 * abs(lenA - lenB) <= 1. When a pure move would unbalance sizes, swap
 * with a player already on the destination team.
 */
export function moveMemberKeepingSizeBalance(
  teamA: TeamMemberPublic[],
  teamB: TeamMemberPublic[],
  playerId: string,
  to: "A" | "B"
): TeamSplit<TeamMemberPublic> {
  const fromA = teamA.find((m) => m.playerId === playerId);
  const fromB = teamB.find((m) => m.playerId === playerId);
  if (!fromA && !fromB) {
    throw new Error(`Player ${playerId} not found on either team`);
  }
  if ((to === "A" && fromA) || (to === "B" && fromB)) {
    return { teamA, teamB };
  }

  const player = (fromA || fromB)!;
  let nextA = teamA.filter((m) => m.playerId !== playerId);
  let nextB = teamB.filter((m) => m.playerId !== playerId);

  if (to === "A") {
    nextA = [...nextA, player];
  } else {
    nextB = [...nextB, player];
  }

  if (teamSizeDiff(nextA, nextB) <= 1) {
    return { teamA: nextA, teamB: nextB };
  }

  // Pure move unbalanced sizes — swap with someone already on the destination.
  if (to === "A") {
    const swap = nextA.find((m) => m.playerId !== playerId);
    if (!swap) return enforceTeamSizeBalance(nextA, nextB);
    nextA = nextA.filter((m) => m.playerId !== swap.playerId);
    nextB = [...nextB, swap];
  } else {
    const swap = nextB.find((m) => m.playerId !== playerId);
    if (!swap) return enforceTeamSizeBalance(nextA, nextB);
    nextB = nextB.filter((m) => m.playerId !== swap.playerId);
    nextA = [...nextA, swap];
  }

  return { teamA: nextA, teamB: nextB };
}

export function toPublicMembers(
  players: { id: string; displayName: string }[]
): TeamMemberPublic[] {
  return players.map((p) => ({
    playerId: p.id,
    displayName: p.displayName,
  }));
}

export function assertNoDuplicatePlayers(
  teamA: { id: string }[],
  teamB: { id: string }[]
): void {
  const ids = [...teamA, ...teamB].map((p) => p.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new Error("Duplicate players detected across teams");
  }
}
