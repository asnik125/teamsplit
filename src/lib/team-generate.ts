/**
 * Explicit Admin Generate: single best skill-balanced composition.
 * Never called from attendance sync.
 */
import {
  assertValidTeamSplit,
  calculateOverall,
  toPublicMembers,
} from "./balancer";
import type {
  Player,
  PlayerEvaluation,
  PlayerRatings,
  RatedPlayer,
  TeamMemberPublic,
} from "./types";
import { RATING_KEYS } from "./types";
import { eligiblePoolFingerprint } from "./team-eligibility";

export class MissingEvaluationError extends Error {
  readonly playerIds: string[];
  readonly displayNames: string[];
  constructor(players: { id: string; displayName: string }[]) {
    const names = players.map((p) => p.displayName);
    super(
      `Cannot skill-balance teams until evaluations exist for: ${names.join(", ")}`
    );
    this.name = "MissingEvaluationError";
    this.playerIds = players.map((p) => p.id);
    this.displayNames = names;
  }
}

export interface BalancedSplitScore {
  overallGap: number;
  dimensionGapAvg: number;
  maxDimensionGap: number;
  /** Canonical partition key for deterministic tie-break */
  key: string;
}

export interface BalancedTeamSplit {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  score: BalancedSplitScore;
}

function ratingsFromEvalStrict(ev: PlayerEvaluation): PlayerRatings {
  return Object.fromEntries(RATING_KEYS.map((k) => [k, ev[k]])) as PlayerRatings;
}

export function buildRatedEligible(input: {
  eligibleIds: string[];
  players: Player[];
  evalMap: Record<string, PlayerEvaluation | undefined>;
  maybePlayerIds: Set<string>;
}): { rated: RatedPlayer[]; maybePlayerIds: Set<string> } {
  const missing: Player[] = [];
  const rated: RatedPlayer[] = [];
  for (const id of input.eligibleIds) {
    const pl = input.players.find((p) => p.id === id && p.active);
    if (!pl) continue;
    const ev = input.evalMap[id];
    if (!ev) {
      missing.push(pl);
      continue;
    }
    const ratings = ratingsFromEvalStrict(ev);
    rated.push({
      ...pl,
      ...ratings,
      overall: calculateOverall(ratings),
    });
  }
  if (missing.length > 0) {
    throw new MissingEvaluationError(missing);
  }
  // Deterministic order for enumeration
  rated.sort((a, b) => a.id.localeCompare(b.id));
  return { rated, maybePlayerIds: input.maybePlayerIds };
}

function markMaybe(
  members: TeamMemberPublic[],
  maybeIds: Set<string>
): TeamMemberPublic[] {
  return members.map((m) =>
    maybeIds.has(m.playerId) ? { ...m, maybe: true } : { ...m, maybe: false }
  );
}

/** Sorted id set key for one side. */
function sideKey(ids: string[]): string {
  return [...ids].sort((a, b) => a.localeCompare(b)).join(",");
}

/**
 * Canonical partition key: smaller side-key first so A↔B mirrors collide.
 */
export function partitionKey(idsA: string[], idsB: string[]): string {
  const a = sideKey(idsA);
  const b = sideKey(idsB);
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function scorePartition(
  idsA: string[],
  idsB: string[],
  byId: Map<string, RatedPlayer>
): BalancedSplitScore {
  const overallA = mean(idsA.map((id) => byId.get(id)!.overall));
  const overallB = mean(idsB.map((id) => byId.get(id)!.overall));
  const overallGap = Math.abs(overallA - overallB);

  const dimGaps: number[] = [];
  for (const dim of RATING_KEYS) {
    const meanA = mean(idsA.map((id) => Number(byId.get(id)![dim])));
    const meanB = mean(idsB.map((id) => Number(byId.get(id)![dim])));
    dimGaps.push(Math.abs(meanA - meanB));
  }
  const dimensionGapAvg = mean(dimGaps);
  const maxDimensionGap = Math.max(...dimGaps);

  return {
    overallGap: Number(overallGap.toFixed(6)),
    dimensionGapAvg: Number(dimensionGapAvg.toFixed(6)),
    maxDimensionGap: Number(maxDimensionGap.toFixed(6)),
    key: partitionKey(idsA, idsB),
  };
}

function compareScores(a: BalancedSplitScore, b: BalancedSplitScore): number {
  if (a.overallGap !== b.overallGap) return a.overallGap - b.overallGap;
  if (a.dimensionGapAvg !== b.dimensionGapAvg) {
    return a.dimensionGapAvg - b.dimensionGapAvg;
  }
  if (a.maxDimensionGap !== b.maxDimensionGap) {
    return a.maxDimensionGap - b.maxDimensionGap;
  }
  return a.key.localeCompare(b.key);
}

/**
 * Enumerate unique size-balanced partitions (A↔B mirrors counted once).
 * Team sizes differ by at most 1 (n even → n/2 each; n odd → floor/ceil).
 */
export function enumerateBalancedPartitions(playerIds: string[]): string[][] {
  const n = playerIds.length;
  if (n < 2) return [];
  const sizeA = Math.ceil(n / 2);
  const sorted = [...playerIds].sort((a, b) => a.localeCompare(b));
  const seen = new Set<string>();
  const out: string[][] = [];

  function choose(start: number, chosen: string[]) {
    if (chosen.length === sizeA) {
      const setA = new Set(chosen);
      const idsA = [...chosen];
      const idsB = sorted.filter((id) => !setA.has(id));
      const key = partitionKey(idsA, idsB);
      if (seen.has(key)) return;
      seen.add(key);
      // Canonical: store A as the side with smaller key (copy — chosen is reused)
      const aKey = sideKey(idsA);
      const bKey = sideKey(idsB);
      out.push(aKey <= bKey ? idsA : idsB);
      return;
    }
    const need = sizeA - chosen.length;
    for (let i = start; i <= sorted.length - need; i++) {
      chosen.push(sorted[i]!);
      choose(i + 1, chosen);
      chosen.pop();
    }
  }

  choose(0, []);
  return out;
}

/**
 * Single best skill-balanced split for the eligible rated pool.
 */
export function computeBestBalancedSplit(input: {
  rated: RatedPlayer[];
  maybePlayerIds: Set<string>;
}): BalancedTeamSplit {
  if (input.rated.length < 2) {
    throw new Error("At least 2 eligible players are required");
  }

  const byId = new Map(input.rated.map((r) => [r.id, r]));
  const ids = input.rated.map((r) => r.id);
  const sidesA = enumerateBalancedPartitions(ids);
  if (sidesA.length === 0) {
    throw new Error("No valid team partitions");
  }

  let bestIdsA: string[] | null = null;
  let bestScore: BalancedSplitScore | null = null;

  for (const idsA of sidesA) {
    const setA = new Set(idsA);
    const idsB = ids.filter((id) => !setA.has(id));
    const score = scorePartition(idsA, idsB, byId);
    if (!bestScore || compareScores(score, bestScore) < 0) {
      bestScore = score;
      bestIdsA = idsA;
    }
  }

  const setA = new Set(bestIdsA!);
  const teamARated = input.rated.filter((r) => setA.has(r.id));
  const teamBRated = input.rated.filter((r) => !setA.has(r.id));

  // Preserve display order by overall desc within each side (stable UX)
  const byOverall = (a: RatedPlayer, b: RatedPlayer) =>
    b.overall - a.overall || a.id.localeCompare(b.id);
  teamARated.sort(byOverall);
  teamBRated.sort(byOverall);

  const teamA = markMaybe(toPublicMembers(teamARated), input.maybePlayerIds);
  const teamB = markMaybe(toPublicMembers(teamBRated), input.maybePlayerIds);

  assertValidTeamSplit(
    input.rated.map((p) => p.id),
    teamA,
    teamB
  );

  return { teamA, teamB, score: bestScore! };
}

export function fingerprintForRated(rated: RatedPlayer[]): string {
  return eligiblePoolFingerprint(rated.map((r) => r.id));
}
