/** Viewport max width (px) for TeamSplit dedicated mobile UI. Matches Tailwind `md`. */
export const MOBILE_BREAKPOINT_PX = 768;

/** True when width is strictly below the desktop breakpoint. */
export function isMobileViewportWidth(widthPx: number): boolean {
  return Number.isFinite(widthPx) && widthPx < MOBILE_BREAKPOINT_PX;
}

export type PlayerMobileFrame = "attendance" | "teams" | "profile";
export type AdminMobileTab =
  | "team-builder"
  | "manage-games"
  | "players"
  | "settings";
export type TeamBuilderFrame = "participants" | "teams";

export const PLAYER_MOBILE_FRAMES: PlayerMobileFrame[] = [
  "attendance",
  "teams",
  "profile",
];

export function defaultPlayerMobileFrame(): PlayerMobileFrame {
  return "attendance";
}

export function defaultAdminMobileTab(): AdminMobileTab {
  return "team-builder";
}

export function adjacentPlayerFrame(
  current: PlayerMobileFrame,
  direction: -1 | 1
): PlayerMobileFrame {
  const i = PLAYER_MOBILE_FRAMES.indexOf(current);
  const next = Math.min(
    PLAYER_MOBILE_FRAMES.length - 1,
    Math.max(0, i + direction)
  );
  return PLAYER_MOBILE_FRAMES[next]!;
}

export function adjacentTeamBuilderFrame(
  current: TeamBuilderFrame,
  direction: -1 | 1
): TeamBuilderFrame {
  if (direction < 0) return "participants";
  if (direction > 0) return "teams";
  return current;
}

/**
 * Horizontal swipe should navigate only when movement is clearly horizontal
 * and exceeds the threshold (avoids fighting vertical scroll).
 */
export function shouldNavigateFromSwipe(input: {
  dx: number;
  dy: number;
  thresholdPx?: number;
  dragActive?: boolean;
}): "next" | "prev" | null {
  if (input.dragActive) return null;
  const threshold = input.thresholdPx ?? 56;
  const { dx, dy } = input;
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) <= Math.abs(dy) * 1.25) return null;
  return dx < 0 ? "next" : "prev";
}

/** Public team member shape allowed in Player mobile Teams client state. */
export function isPlayerSafeTeamMember(
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
    "control",
    "passing",
    "action",
    "defend",
    "attack",
    "transition",
    "decisions",
    "workrate",
  ];
  if (forbidden.some((k) => k in member && member[k] != null)) return false;
  return typeof member.playerId === "string" && typeof member.displayName === "string";
}
