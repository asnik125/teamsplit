import type { PlayerEvaluation, PlayerRatings } from "../types";
import { RATING_KEYS } from "../types";
import { calculateOverall } from "../balancer";

/** Default skill value for self-registered players (Admin can edit later). */
export const DEFAULT_REGISTRATION_RATING = 5;

export function defaultRegistrationRatings(): PlayerRatings {
  return Object.fromEntries(
    RATING_KEYS.map((k) => [k, DEFAULT_REGISTRATION_RATING])
  ) as PlayerRatings;
}

export function buildDefaultEvaluation(
  playerId: string,
  nowIso: string,
  updatedBy: string | null
): PlayerEvaluation {
  return {
    playerId,
    ...defaultRegistrationRatings(),
    updatedAt: nowIso,
    updatedBy,
  };
}

/** Create defaults only when missing — never overwrite Admin ratings. */
export function shouldCreateDefaultEvaluation(
  existing: PlayerEvaluation | null | undefined
): boolean {
  return !existing;
}

export function defaultRegistrationOverall(): number {
  return calculateOverall(defaultRegistrationRatings());
}
