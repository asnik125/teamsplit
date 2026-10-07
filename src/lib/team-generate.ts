/**
 * Explicit Admin Generate: single best skill-balanced composition.
 * Never called from attendance sync.
 */
import {
  assertValidTeamGroups,
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

/** Create 3 teams is available only at this eligible-pool size and above. */
export const MIN_ELIGIBLE_FOR_THREE_TEAMS = 11;

/** Exact 3-way search above this many raw combinations falls back to local search. */
const EXACT_THREE_WAY_LIMIT = 2_000_000;

export function canCreateThreeTeams(eligibleCount: number): boolean {
  return eligibleCount >= MIN_ELIGIBLE_FOR_THREE_TEAMS;
}

/**
 * Checkbox state for Admin Generate.
 * At 10 or fewer eligible players the control is disabled and unchecked.
 */
export function createThreeTeamsControl(input: {
  eligibleCount: number;
  checked: boolean;
}): { enabled: boolean; checked: boolean } {
  const enabled = canCreateThreeTeams(input.eligibleCount);
  return { enabled, checked: enabled && input.checked };
}

/**
 * Team sizes that differ by at most one.
 * Remainder players go to the earlier teams: 11 → 4/4/3, 13 → 5/4/4.
 */
export function threeTeamSizes(playerCount: number): [number, number, number] {
  if (playerCount < 3) {
    throw new Error("At least 3 players are required for three teams");
  }
  const base = Math.floor(playerCount / 3);
  const extra = playerCount % 3;
  return [base + (extra > 0 ? 1 : 0), base + (extra > 1 ? 1 : 0), base];
}

export interface BalancedThreeWaySplit {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  teamC: TeamMemberPublic[];
  score: BalancedSplitScore;
}

function threeWayPartitionKey(
  idsA: string[],
  idsB: string[],
  idsC: string[]
): string {
  return [sideKey(idsA), sideKey(idsB), sideKey(idsC)]
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

type RatedLookup = Map<string, { overall: number } & Record<string, number>>;

/** Range of means across all three teams. No odd-size compensation. */
export function scoreThreeWayPartition(
  idsA: string[],
  idsB: string[],
  idsC: string[],
  byId: RatedLookup,
  dimensionKeys: readonly string[]
): BalancedSplitScore {
  const sides = [idsA, idsB, idsC];
  const overalls = sides.map((ids) =>
    mean(ids.map((id) => byId.get(id)!.overall))
  );
  const overallGap = Math.max(...overalls) - Math.min(...overalls);
  const dimGaps: number[] = [];
  for (const dim of dimensionKeys) {
    const dimMeans = sides.map((ids) =>
      mean(ids.map((id) => Number(byId.get(id)![dim])))
    );
    dimGaps.push(Math.max(...dimMeans) - Math.min(...dimMeans));
  }
  return {
    overallGap: Number(overallGap.toFixed(6)),
    dimensionGapAvg: Number(mean(dimGaps).toFixed(6)),
    maxDimensionGap: Number(Math.max(...dimGaps).toFixed(6)),
    key: threeWayPartitionKey(idsA, idsB, idsC),
  };
}

function combinationCount(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const take = Math.min(k, n - k);
  let count = 1;
  for (let i = 1; i <= take; i++) {
    count = (count * (n - take + i)) / i;
  }
  return count;
}

function chooseGroups(
  pool: string[],
  k: number,
  start: number,
  chosen: string[],
  emit: (picked: string[]) => void
) {
  if (chosen.length === k) {
    emit(chosen.slice());
    return;
  }
  const need = k - chosen.length;
  for (let i = start; i <= pool.length - need; i++) {
    chosen.push(pool[i]!);
    chooseGroups(pool, k, i + 1, chosen, emit);
    chosen.pop();
  }
}

function searchExactThreeWay(
  ids: string[],
  byId: RatedLookup,
  dimensionKeys: readonly string[]
): { sides: [string[], string[], string[]]; score: BalancedSplitScore } {
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  const [sizeA, sizeB, sizeC] = threeTeamSizes(sorted.length);
  const seen = new Set<string>();
  let bestSides: [string[], string[], string[]] | null = null;
  let bestScore: BalancedSplitScore | null = null;

  chooseGroups(sorted, sizeA, 0, [], (idsA) => {
    if (sizeA === sizeB && sizeB === sizeC && !idsA.includes(sorted[0]!)) {
      return;
    }
    const onA = new Set(idsA);
    const rest = sorted.filter((id) => !onA.has(id));
    chooseGroups(rest, sizeB, 0, [], (idsB) => {
      if (sizeA === sizeB && sideKey(idsA) > sideKey(idsB)) return;
      const onB = new Set(idsB);
      const idsC = rest.filter((id) => !onB.has(id));
      if (
        sizeA === sizeB &&
        sizeB === sizeC &&
        sideKey(idsB) > sideKey(idsC)
      ) {
        return;
      }
      if (idsC.length !== sizeC) return;
      const key = threeWayPartitionKey(idsA, idsB, idsC);
      if (seen.has(key)) return;
      seen.add(key);
      const score = scoreThreeWayPartition(
        idsA,
        idsB,
        idsC,
        byId,
        dimensionKeys
      );
      if (!bestScore || compareScores(score, bestScore) < 0) {
        bestScore = score;
        bestSides = [idsA.slice(), idsB.slice(), idsC.slice()];
      }
    });
  });

  if (!bestSides || !bestScore) {
    throw new Error("No valid three-team partitions");
  }
  return { sides: bestSides, score: bestScore };
}

function stepSnake(
  index: number,
  direction: number
): { index: number; direction: number } {
  const next = index + direction;
  if (next > 2 || next < 0) return { index, direction: -direction };
  return { index: next, direction };
}

function dealThreeWay(orderedIds: string[], sizes: [number, number, number]) {
  const buckets: [string[], string[], string[]] = [[], [], []];
  let index = 0;
  let direction = 1;
  for (const id of orderedIds) {
    let guard = 0;
    while (buckets[index].length >= sizes[index] && guard < 6) {
      const stepped = stepSnake(index, direction);
      index = stepped.index;
      direction = stepped.direction;
      guard += 1;
    }
    if (buckets[index].length >= sizes[index]) {
      const open = buckets.findIndex((bucket, i) => bucket.length < sizes[i]);
      if (open >= 0) index = open;
    }
    buckets[index].push(id);
    const stepped = stepSnake(index, direction);
    index = stepped.index;
    direction = stepped.direction;
  }
  return buckets;
}

function searchLocalThreeWay(
  ids: string[],
  byId: RatedLookup,
  dimensionKeys: readonly string[]
): { sides: [string[], string[], string[]]; score: BalancedSplitScore } {
  const sizes = threeTeamSizes(ids.length);
  const ordered = [...ids].sort((a, b) => {
    const overallDiff = byId.get(b)!.overall - byId.get(a)!.overall;
    return overallDiff || a.localeCompare(b);
  });
  let sides = dealThreeWay(ordered, sizes);
  let score = scoreThreeWayPartition(
    sides[0],
    sides[1],
    sides[2],
    byId,
    dimensionKeys
  );

  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        for (const left of sides[i]) {
          for (const right of sides[j]) {
            const next: [string[], string[], string[]] = [
              sides[0].slice(),
              sides[1].slice(),
              sides[2].slice(),
            ];
            next[i] = next[i].filter((id) => id !== left).concat(right);
            next[j] = next[j].filter((id) => id !== right).concat(left);
            const nextScore = scoreThreeWayPartition(
              next[0],
              next[1],
              next[2],
              byId,
              dimensionKeys
            );
            if (compareScores(nextScore, score) < 0) {
              sides = next;
              score = nextScore;
              improved = true;
            }
          }
        }
      }
    }
    if (!improved) break;
  }

  return { sides, score };
}

function assignThreeWaySides(
  sides: [string[], string[], string[]]
): [string[], string[], string[]] {
  return [...sides].sort(
    (a, b) => b.length - a.length || sideKey(a).localeCompare(sideKey(b))
  ) as [string[], string[], string[]];
}

/**
 * Best skill-balanced split into three teams.
 * Scores the range of means across all three sides together.
 * Does not apply Classic odd-team compensation.
 */
export function computeBestBalancedThreeWay<
  T extends { id: string; displayName: string; overall: number },
>(input: {
  rated: T[];
  maybePlayerIds: Set<string>;
  dimensionKeys?: readonly string[];
}): BalancedThreeWaySplit {
  const dimensionKeys = input.dimensionKeys ?? RATING_KEYS;
  if (input.rated.length < 3) {
    throw new Error("At least 3 eligible players are required");
  }

  const byId = new Map(
    input.rated.map((player) => [
      player.id,
      player as T & Record<string, unknown>,
    ])
  ) as RatedLookup;
  const ids = input.rated.map((player) => player.id);
  const [sizeA, sizeB] = threeTeamSizes(ids.length);
  const combinations =
    combinationCount(ids.length, sizeA) *
    combinationCount(ids.length - sizeA, sizeB);
  const found =
    combinations <= EXACT_THREE_WAY_LIMIT
      ? searchExactThreeWay(ids, byId, dimensionKeys)
      : searchLocalThreeWay(ids, byId, dimensionKeys);

  const [idsA, idsB, idsC] = assignThreeWaySides(found.sides);
  const onA = new Set(idsA);
  const onB = new Set(idsB);
  const byOverall = (a: T, b: T) =>
    b.overall - a.overall || a.id.localeCompare(b.id);
  const teamARated = input.rated.filter((player) => onA.has(player.id)).sort(byOverall);
  const teamBRated = input.rated.filter((player) => onB.has(player.id)).sort(byOverall);
  const teamCRated = input.rated
    .filter((player) => !onA.has(player.id) && !onB.has(player.id))
    .sort(byOverall);

  const teamA = markMaybe(toPublicMembers(teamARated), input.maybePlayerIds);
  const teamB = markMaybe(toPublicMembers(teamBRated), input.maybePlayerIds);
  const teamC = markMaybe(toPublicMembers(teamCRated), input.maybePlayerIds);

  assertValidTeamGroups(
    input.rated.map((player) => player.id),
    [teamA, teamB, teamC]
  );

  const score = scoreThreeWayPartition(idsA, idsB, idsC, byId, dimensionKeys);
  return { teamA, teamB, teamC, score };
}
