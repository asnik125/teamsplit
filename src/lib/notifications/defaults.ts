import type {
  NotificationRuleSettings,
  NotificationSettings,
  NotificationType,
} from "../types";

export const NOTIFICATION_TIMEZONE = "America/Vancouver" as const;

export const NOTIFICATION_SETTINGS_DOC = "notifications";

export const DEFAULT_MIN_PLAYING_FOR_FINAL = 6;

export function defaultNotificationRule(
  daysBefore: number,
  timeLocal: string
): NotificationRuleSettings {
  return {
    enabled: true,
    daysBefore,
    timeLocal,
  };
}

/** Defaults: day-before 19:00, game-day 16:00 (Maybe).
 * finalStatus clock fields are unused — timing is game start − 2h. */
export function defaultNotificationSettings(
  updatedBy: string | null = null
): NotificationSettings {
  return {
    timezone: NOTIFICATION_TIMEZONE,
    gameReminder: defaultNotificationRule(1, "19:00"),
    maybeReminder: defaultNotificationRule(0, "16:00"),
    finalStatus: defaultNotificationRule(0, "18:00"),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function ruleForType(
  settings: NotificationSettings,
  type: NotificationType
): NotificationRuleSettings {
  if (type === "game_reminder") return settings.gameReminder;
  if (type === "maybe_reminder") return settings.maybeReminder;
  return settings.finalStatus;
}

export const ALL_NOTIFICATION_TYPES: NotificationType[] = [
  "game_reminder",
  "maybe_reminder",
  "final_status",
];

export function notificationTypeLabel(type: NotificationType): string {
  if (type === "game_reminder") return "Game reminder";
  if (type === "maybe_reminder") return "Maybe reminder";
  return "Game OFF (2h before kickoff)";
}

export function sendRecordId(
  gameId: string,
  type: NotificationType,
  userId: string
): string {
  return `${gameId}_${type}_${userId}`;
}
