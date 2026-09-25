/**
 * Simple rating system (1–5) — independent of Classic.
 * Overall = unweighted mean of the 8 dimensions.
 */
import type { SimplePlayerRatings, SimpleRatingKey } from "./types";
import { SIMPLE_RATING_KEYS } from "./types";

export function calculateSimpleOverall(ratings: SimplePlayerRatings): number {
  const sum = SIMPLE_RATING_KEYS.reduce(
    (acc, key) => acc + Number(ratings[key] || 0),
    0
  );
  return Number((sum / SIMPLE_RATING_KEYS.length).toFixed(1));
}

export function isCompleteSimpleRatings(
  raw: Partial<Record<SimpleRatingKey, unknown>> | null | undefined
): raw is SimplePlayerRatings {
  if (!raw) return false;
  for (const key of SIMPLE_RATING_KEYS) {
    const v = Number(raw[key]);
    if (!Number.isFinite(v) || v < 1 || v > 5) return false;
  }
  return true;
}

/** Empty draft for Admin editor only — never written as a default evaluation. */
export function emptySimpleRatingsDraft(
  defaultValue = 3
): SimplePlayerRatings {
  return Object.fromEntries(
    SIMPLE_RATING_KEYS.map((k) => [k, defaultValue])
  ) as SimplePlayerRatings;
}
