export type UserRole = "admin" | "player";

export type AttendanceStatus =
  | "playing"
  | "maybe"
  | "not_playing"
  | "no_response";

export type GameStatus = "scheduled" | "cancelled";

export const RATING_KEYS = [
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
] as const;

export type RatingKey = (typeof RATING_KEYS)[number];

export type PlayerRatings = Record<RatingKey, number>;

export interface UserProfile {
  uid: string;
  playerId: string | null;
  displayName: string;
  email: string;
  role: UserRole;
  emailNotifications: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Player {
  id: string;
  displayName: string;
  email: string | null;
  active: boolean;
  linkedUid: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerEvaluation extends PlayerRatings {
  playerId: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface Game {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string | null;
  location: string;
  status: GameStatus;
  /**
   * Admin: weekly date stays visible in Attendance but there is no game.
   * Missing/undefined treated as false.
   */
  noGame: boolean;
  /** e.g. "2026-2027" — prepared for season history later */
  seasonId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Set when attendance changes after teams exist / need Admin attention */
  teamsMayBeStale: boolean;
  /** Latest human-readable teams/attendance sync status for UI banners */
  teamsStatusMessage: string | null;
  /** Last RSVP/attendance change detail (for Admin “needs update” context) */
  lastAttendanceChange: {
    playerId: string;
    displayName: string;
    previousStatus: AttendanceStatus | null;
    nextStatus: AttendanceStatus;
    at: string;
  } | null;
}

/** Placeholder season document for future season management UI */
export interface Season {
  id: string; // e.g. "2026-2027"
  label: string;
  active: boolean;
}

/** Global app settings (Admin-configurable). Doc: settings/app */
export interface AppSettings {
  minPlayingForTeams: number;
  /** Default ON — players may edit anyone's attendance */
  allowPlayersEditOthersAttendance: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface AttendanceRecord {
  gameId: string;
  playerId: string;
  status: AttendanceStatus;
  updatedAt: string;
  updatedBy: string | null;
}

/** Public-safe published/draft team member — never includes ratings */
export interface TeamMemberPublic {
  playerId: string;
  displayName: string;
  /** True when included via Maybe (Include Maybe ON) */
  maybe?: boolean;
}

/** Strip any non-public fields that may exist on stored team docs. */
export function toTeamMemberPublic(raw: unknown): TeamMemberPublic | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.playerId !== "string" || typeof o.displayName !== "string") {
    return null;
  }
  const out: TeamMemberPublic = {
    playerId: o.playerId,
    displayName: o.displayName,
  };
  if (o.maybe === true) out.maybe = true;
  return out;
}

export function sanitizeTeamMembers(list: unknown): TeamMemberPublic[] {
  if (!Array.isArray(list)) return [];
  const out: TeamMemberPublic[] = [];
  for (const item of list) {
    const m = toTeamMemberPublic(item);
    if (m) out.push(m);
  }
  return out;
}

export interface GameTeams {
  gameId: string;
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  published: boolean;
  publishedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
  manuallyAdjusted: boolean;
  /** When true, Playing + Maybe are included when generating teams */
  includeMaybePlayers: boolean;
  /**
   * Fingerprint of eligible player ids at last Generate (sorted id join).
   * When current attendance pool differs, composition is stale.
   */
  eligibleFingerprint?: string | null;
  /** Explicit stale flag (also derived from fingerprint mismatch). */
  stale?: boolean;
}

/** @deprecated Legacy multi-alternative shape — no longer written. */
export interface TeamCompositionAlternative {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  imbalance: number;
}

export interface RatedPlayer extends Player, PlayerRatings {
  overall: number;
}

/** Scheduled email notification kinds (MVP). */
export type NotificationType =
  | "game_reminder"
  | "maybe_reminder"
  | "final_status";

/** Per-rule Admin schedule (stored; not hardcoded at send time). */
export interface NotificationRuleSettings {
  enabled: boolean;
  /**
   * Days before the game date (Vancouver calendar day).
   * 1 = day before, 0 = game day.
   */
  daysBefore: number;
  /** Local wall-clock time in America/Vancouver, HH:mm (24h). */
  timeLocal: string;
}

/** Doc: settings/notifications */
export interface NotificationSettings {
  timezone: "America/Vancouver";
  gameReminder: NotificationRuleSettings;
  maybeReminder: NotificationRuleSettings;
  finalStatus: NotificationRuleSettings;
  updatedAt: string;
  updatedBy: string | null;
}

export type NotificationSendStatus = "claimed" | "sent" | "failed" | "skipped";

/** Doc: notificationSends/{gameId}_{type}_{userId} — idempotency per recipient */
export interface NotificationSendRecord {
  id: string;
  gameId: string;
  notificationType: NotificationType;
  userId: string;
  email: string;
  status: NotificationSendStatus;
  error: string | null;
  resendId: string | null;
  claimedAt: string;
  sentAt: string | null;
  updatedAt: string;
}

export type NotificationRunResult =
  | "sent"
  | "zero_recipients"
  | "partial"
  | "failed"
  | "skipped_not_due";

/** Doc: notificationRuns/{autoId} — Admin history */
export interface NotificationRunLog {
  id: string;
  at: string;
  gameId: string;
  gameDate: string;
  gameLocation: string;
  notificationType: NotificationType;
  subject: string;
  result: NotificationRunResult;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  /** e.g. Game is OFF (5 Playing, need 6) */
  detail: string | null;
}
