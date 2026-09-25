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
  SimplePlayerEvaluation,
  SimplePlayerRatings,
  SimpleRatedPlayer,
  TeamMemberPublic,
} from "./types";
import { RATING_KEYS, SIMPLE_RATING_KEYS } from "./types";
import { eligiblePoolFingerprint } from "./team-eligibility";
import {
  calculateSimpleOverall,
  isCompleteSimpleRatings,
} from "./simple-ratings";

export class MissingEvaluationError extends Error {
  readonly playerIds: string[];
  readonly displayNames: string[];
  constructor(
    players: { id: string; displayName: string }[],
    systemLabel: "Classic" | "Simple" = "Classic"
  ) {
    const names = players.map((p) => p.displayName);
    super(
      `Cannot skill-balance teams (${systemLabel}) until evaluations exist for: ${names.join(", ")}`
    );
    this.name = "MissingEvaluationError";
    this.playerIds = players.map((p) => p.id);
    this.displayNames = names;
  }
}

export interface BalancedSplitScore {
  /**
   * Primary Overall term used for lexicographic ranking.
   * Even pools: abs(meanA − meanB).
   * Odd Classic pools: abs(mean(smaller) − mean(larger) × (1 + CLASSIC_ODD_OVERALL_COMPENSATION)).
   */
  overallGap: number;
  dimensionGapAvg: number;
  maxDimensionGap: number;
  /** Canonical partition key for deterministic tie-break */
  key: string;
}

/**
 * Classic-only: when team sizes differ by 1, require the smaller side's mean Overall
 * to beat the larger side's mean by this relative premium (20%).
 * Even pools are unaffected. Simple generation must pass compensation 0.
 */
export const CLASSIC_ODD_OVERALL_COMPENSATION = 0.2;

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
    throw new MissingEvaluationError(missing, "Classic");
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
  byId: Map<string, { overall: number } & Record<string, number>>,
  dimensionKeys: readonly string[] = RATING_KEYS,
  oddOverallCompensation: number = 0
): BalancedSplitScore {
  const overallA = mean(idsA.map((id) => byId.get(id)!.overall));
  const overallB = mean(idsB.map((id) => byId.get(id)!.overall));

  let overallGap: number;
  if (
    oddOverallCompensation > 0 &&
    idsA.length !== idsB.length
  ) {
    const meanSmall = idsA.length < idsB.length ? overallA : overallB;
    const meanLarge = idsA.length < idsB.length ? overallB : overallA;
    overallGap = Math.abs(
      meanSmall - meanLarge * (1 + oddOverallCompensation)
    );
  } else {
    overallGap = Math.abs(overallA - overallB);
  }

  const dimGaps: number[] = [];
  for (const dim of dimensionKeys) {
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
 * Single best skill-balanced split for a rated pool (Classic or Simple dims).
 *
 * Classic (default dims): odd pools use CLASSIC_ODD_OVERALL_COMPENSATION (20%).
 * Simple: pass oddTeamOverallCompensation: 0 (or any non-Classic dimensionKeys
 * defaults compensation to 0 so Simple behavior is unchanged).
 */
export function computeBestBalancedSplit<
  T extends { id: string; displayName: string; overall: number },
>(input: {
  rated: T[];
  maybePlayerIds: Set<string>;
  dimensionKeys?: readonly string[];
  /** Relative premium on the larger team's mean Overall when sizes differ. Classic default 0.2; Simple should pass 0. */
  oddTeamOverallCompensation?: number;
}): BalancedTeamSplit {
  const dimensionKeys = input.dimensionKeys ?? RATING_KEYS;
  const oddTeamOverallCompensation =
    input.oddTeamOverallCompensation ??
    (dimensionKeys === RATING_KEYS ? CLASSIC_ODD_OVERALL_COMPENSATION : 0);
  if (input.rated.length < 2) {
    throw new Error("At least 2 eligible players are required");
  }

  const byId = new Map(
    input.rated.map((r) => [r.id, r as T & Record<string, unknown>])
  );
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
    const score = scorePartition(
      idsA,
      idsB,
      byId as Map<string, { overall: number } & Record<string, number>>,
      dimensionKeys,
      oddTeamOverallCompensation
    );
    if (!bestScore || compareScores(score, bestScore) < 0) {
      bestScore = score;
      bestIdsA = idsA;
    }
  }

  const setA = new Set(bestIdsA!);
  const teamARated = input.rated.filter((r) => setA.has(r.id));
  const teamBRated = input.rated.filter((r) => !setA.has(r.id));

  const byOverall = (a: T, b: T) =>
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

export function buildSimpleRatedEligible(input: {
  eligibleIds: string[];
  players: Player[];
  evalMap: Record<string, SimplePlayerEvaluation | undefined>;
  maybePlayerIds: Set<string>;
}): { rated: SimpleRatedPlayer[]; maybePlayerIds: Set<string> } {
  const missing: Player[] = [];
  const rated: SimpleRatedPlayer[] = [];
  for (const id of input.eligibleIds) {
    const pl = input.players.find((p) => p.id === id && p.active);
    if (!pl) continue;
    const ev = input.evalMap[id];
    if (!ev || !isCompleteSimpleRatings(ev)) {
      missing.push(pl);
      continue;
    }
    const ratings = Object.fromEntries(
      SIMPLE_RATING_KEYS.map((k) => [k, ev[k]])
    ) as SimplePlayerRatings;
    rated.push({
      ...pl,
      ...ratings,
      overall: calculateSimpleOverall(ratings),
    });
  }
  if (missing.length > 0) {
    throw new MissingEvaluationError(missing, "Simple");
  }
  rated.sort((a, b) => a.id.localeCompare(b.id));
  return { rated, maybePlayerIds: input.maybePlayerIds };
}

export function fingerprintForRated(rated: { id: string }[]): string {
  return eligiblePoolFingerprint(rated.map((r) => r.id));
}
