import { calculateOverall } from "./balancer";
import type { Player, PlayerEvaluation, PlayerRatings } from "./types";
import { RATING_KEYS } from "./types";

/** Max absolute Open Field adjustment vs active-player population. */
export const OPEN_FIELD_ADJUSTMENT_CLAMP = 0.3;

/** Scale applied to (player factor − population average). */
export const OPEN_FIELD_ADJUSTMENT_WEIGHT = 0.1;

export interface PlayerBalanceMetrics {
  /** Existing Overall — same rounded mean used everywhere today */
  overall: number;
  /** Full-precision Physical = (Speed + Strength + Stamina) / 3 */
  physical: number;
  /** Full-precision Football (excludes Attack & Defend) */
  football: number;
  attack: number;
  defense: number;
  /** Full-precision Role = (Attack + Defend) / 2 */
  role: number;
  /** Full-precision Balance Rating */
  balanceRating: number;
  /** Indoor = Balance Rating (no environment adjustment) */
  indoorRating: number;
  /** (Speed + Stamina) / 2 */
  openFieldFactor: number;
  /** Population average of OpenFieldFactor among active players with evals */
  averageOpenFieldFactor: number;
  /** Clamped adjustment in [-0.30, +0.30] */
  openFieldAdjustment: number;
  /** Balance Rating + OpenFieldAdjustment */
  openFieldRating: number;
}

export const BALANCE_METRIC_HELP = {
  overall: "Simple average of all 11 ratings.",
  balanceRating:
    "Weighted football/team-strength rating using Football skills, Attack/Defense, and Physical attributes.",
  indoor: "Balance Rating without environmental adjustment.",
  openField:
    "Balance Rating with a small Speed/Stamina adjustment relative to active players.",
  physical: "Average of Speed, Strength, and Stamina.",
  football:
    "Average of Control, Passing, Action, Transition, Decisions, and Workrate (Attack/Defense excluded).",
} as const;

/** Extract the 11 ratings from an evaluation — never invent defaults. */
export function ratingsFromEvaluation(
  evaluation: PlayerEvaluation | null | undefined
): PlayerRatings | null {
  if (!evaluation) return null;
  for (const key of RATING_KEYS) {
    const v = evaluation[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
  }
  return Object.fromEntries(
    RATING_KEYS.map((k) => [k, Number(evaluation[k])])
  ) as PlayerRatings;
}

export function openFieldFactorFromRatings(ratings: PlayerRatings): number {
  return (Number(ratings.speed) + Number(ratings.stamina)) / 2;
}

/**
 * Average OpenFieldFactor across active players that have complete evaluations.
 * Inactive and missing-eval players are excluded.
 * Returns null when the reference population is empty.
 */
export function averageOpenFieldFactorForActivePlayers(
  players: Pick<Player, "id" | "active">[],
  evaluationsByPlayerId: Record<string, PlayerEvaluation | null | undefined>
): number | null {
  const factors: number[] = [];
  for (const p of players) {
    if (!p.active) continue;
    const ratings = ratingsFromEvaluation(evaluationsByPlayerId[p.id]);
    if (!ratings) continue;
    factors.push(openFieldFactorFromRatings(ratings));
  }
  if (factors.length === 0) return null;
  return factors.reduce((a, b) => a + b, 0) / factors.length;
}

export function clampOpenFieldAdjustment(raw: number): number {
  return Math.min(
    OPEN_FIELD_ADJUSTMENT_CLAMP,
    Math.max(-OPEN_FIELD_ADJUSTMENT_CLAMP, raw)
  );
}

export function computeOpenFieldAdjustment(
  playerOpenFieldFactor: number,
  averageOpenFieldFactor: number | null
): number {
  if (averageOpenFieldFactor == null || !Number.isFinite(averageOpenFieldFactor)) {
    return 0;
  }
  const raw =
    (playerOpenFieldFactor - averageOpenFieldFactor) *
    OPEN_FIELD_ADJUSTMENT_WEIGHT;
  return clampOpenFieldAdjustment(raw);
}

/**
 * Authoritative balance metrics from complete ratings + population average.
 * Uses full precision for all new metrics. Overall uses existing calculateOverall.
 */
export function computePlayerBalanceMetrics(
  ratings: PlayerRatings,
  averageOpenFieldFactor: number | null
): PlayerBalanceMetrics {
  const physical =
    (Number(ratings.speed) +
      Number(ratings.strength) +
      Number(ratings.stamina)) /
    3;
  const football =
    (Number(ratings.control) +
      Number(ratings.passing) +
      Number(ratings.action) +
      Number(ratings.transition) +
      Number(ratings.decisions) +
      Number(ratings.workrate)) /
    6;
  const attack = Number(ratings.attack);
  const defense = Number(ratings.defend);
  const role = (attack + defense) / 2;
  const balanceRating = football * 0.5 + role * 0.3 + physical * 0.2;
  const indoorRating = balanceRating;
  const openFieldFactor = openFieldFactorFromRatings(ratings);
  const openFieldAdjustment = computeOpenFieldAdjustment(
    openFieldFactor,
    averageOpenFieldFactor
  );
  const openFieldRating = balanceRating + openFieldAdjustment;

  return {
    overall: calculateOverall(ratings),
    physical,
    football,
    attack,
    defense,
    role,
    balanceRating,
    indoorRating,
    openFieldFactor,
    averageOpenFieldFactor:
      averageOpenFieldFactor == null ? Number.NaN : averageOpenFieldFactor,
    openFieldAdjustment,
    openFieldRating,
  };
}

/**
 * Compute metrics for a player when evaluation may be missing.
 * Returns null instead of fabricating ratings.
 */
export function computePlayerBalanceMetricsFromEvaluation(
  evaluation: PlayerEvaluation | null | undefined,
  averageOpenFieldFactor: number | null
): PlayerBalanceMetrics | null {
  const ratings = ratingsFromEvaluation(evaluation);
  if (!ratings) return null;
  return computePlayerBalanceMetrics(ratings, averageOpenFieldFactor);
}

/** Round for display only — 1 decimal place. */
export function formatOneDecimal(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** Signed adjustment display: +0.2, 0.0, -0.1 */
export function formatSignedOneDecimal(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (Object.is(rounded, -0) || rounded === 0) return "0.0";
  const body = Math.abs(rounded).toFixed(1);
  return rounded > 0 ? `+${body}` : `-${body}`;
}

/** Columns required on Admin Players table. */
export const ADMIN_PLAYERS_METRIC_COLUMNS = [
  "Player",
  "Overall",
  "Balance",
  "Indoor",
  "Open Field",
] as const;

export function buildAdminPlayersMetricRow(input: {
  displayName: string;
  active: boolean;
  metrics: PlayerBalanceMetrics | null;
}): {
  player: string;
  overall: string;
  balance: string;
  indoor: string;
  openField: string;
} {
  const label = input.active
    ? input.displayName
    : `${input.displayName} (inactive)`;
  if (!input.metrics) {
    return {
      player: label,
      overall: "—",
      balance: "—",
      indoor: "—",
      openField: "—",
    };
  }
  return {
    player: label,
    overall: formatOneDecimal(input.metrics.overall),
    balance: formatOneDecimal(input.metrics.balanceRating),
    indoor: formatOneDecimal(input.metrics.indoorRating),
    openField: formatOneDecimal(input.metrics.openFieldRating),
  };
}

/**
 * Privacy: calculated balance metrics are evaluation-derived and Admin-only.
 * Normal Player View must never surface them.
 */
export function playerViewMaySeeBalanceMetrics(showAdminUI: boolean): boolean {
  return showAdminUI === true;
}

/** Public team members must never carry rating / balance fields. */
export function publicTeamMemberExposesPrivateRatings(
  member: Record<string, unknown>
): boolean {
  const forbidden = [
    "overall",
    "ratings",
    "balanceRating",
    "physical",
    "football",
    "indoorRating",
    "openFieldRating",
    "openFieldAdjustment",
    "speed",
    "strength",
    "stamina",
  ];
  return forbidden.some((k) => k in member && member[k] != null);
}
