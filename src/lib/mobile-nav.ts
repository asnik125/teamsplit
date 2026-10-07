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
  | "notifications"
  | "profile";
export type TeamBuilderFrame = "teams" | "participants";

export const PLAYER_MOBILE_FRAMES: PlayerMobileFrame[] = [
  "attendance",
  "teams",
  "profile",
];

/** Admin Team Builder frames in display order: Teams first (default). */
export const TEAM_BUILDER_FRAMES: TeamBuilderFrame[] = [
  "teams",
  "participants",
];

export function defaultPlayerMobileFrame(): PlayerMobileFrame {
  return "attendance";
}

export function defaultAdminMobileTab(): AdminMobileTab {
  return "team-builder";
}

export function defaultTeamBuilderFrame(): TeamBuilderFrame {
  return "teams";
}

/** In-app reset when Home is tapped while already on `/`. */
export const MOBILE_HOME_EVENT = "teamsplit:mobile-home";

export interface MobileHomeTarget {
  href: "/";
  /** Echo of the active view. Home must not flip Admin ↔ Player. */
  viewMode: "admin" | "player";
  adminTab: AdminMobileTab;
  teamBuilderFrame: TeamBuilderFrame;
  playerFrame: PlayerMobileFrame;
}

/**
 * Where the mobile TeamSplit brand goes.
 * Admin → Game screen, Teams tab. Player → Game/home (Attendance).
 */
export function mobileHomeTarget(
  viewMode: "admin" | "player"
): MobileHomeTarget {
  return {
    href: "/",
    viewMode,
    adminTab: defaultAdminMobileTab(),
    teamBuilderFrame: defaultTeamBuilderFrame(),
    playerFrame: defaultPlayerMobileFrame(),
  };
}

/** Same-route Home only resets shell state; other pages navigate to `/`. */
export function shouldNavigateForMobileHome(pathname: string): boolean {
  return pathname !== "/";
}

/** Brand control: page label stays beside the link, never inside it. */
export function mobileBrandHomeControl(input: {
  viewMode: "admin" | "player";
  pageLabel?: string | null;
}): {
  brandText: "TeamSplit";
  accessibleName: "Home";
  href: "/";
  pageLabel: string | null;
  pageLabelInsideLink: false;
  destination: MobileHomeTarget;
} {
  return {
    brandText: "TeamSplit",
    accessibleName: "Home",
    href: "/",
    pageLabel: input.pageLabel ?? null,
    pageLabelInsideLink: false,
    destination: mobileHomeTarget(input.viewMode),
  };
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
  const i = TEAM_BUILDER_FRAMES.indexOf(current);
  if (i < 0) return defaultTeamBuilderFrame();
  const next = Math.min(
    TEAM_BUILDER_FRAMES.length - 1,
    Math.max(0, i + direction)
  );
  return TEAM_BUILDER_FRAMES[next]!;
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
  return (
    typeof member.playerId === "string" && typeof member.displayName === "string"
  );
}
