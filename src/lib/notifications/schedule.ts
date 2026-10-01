import type {
  Game,
  NotificationRuleSettings,
  NotificationSettings,
  NotificationType,
} from "../types";
import { NOTIFICATION_TIMEZONE, ruleForType } from "./defaults";
import {
  addCalendarDays,
  parseTimeLocal,
  vancouverLocalToUtc,
  zonedCalendarDate,
} from "./timezone";

/** Hours before kickoff for the automatic Game OFF threshold check. */
export const GAME_OFF_HOURS_BEFORE_START = 2;

export interface ScheduledNotificationSlot {
  gameId: string;
  game: Game;
  notificationType: NotificationType;
  /** Instant when this notification becomes due */
  dueAt: Date;
  rule: NotificationRuleSettings;
}

/**
 * Compute the Vancouver-local send instant for a game + rule.
 * daysBefore=1 → calendar day before game.date; daysBefore=0 → game.date.
 * Not used for final_status (see computeGameOffThresholdDueAt).
 */
export function computeNotificationDueAt(
  game: Game,
  rule: NotificationRuleSettings,
  timeZone: string = NOTIFICATION_TIMEZONE
): Date {
  parseTimeLocal(rule.timeLocal);
  const sendDate = addCalendarDays(game.date, -Math.max(0, Math.floor(rule.daysBefore)));
  return vancouverLocalToUtc(sendDate, rule.timeLocal, timeZone);
}

/**
 * Automatic Game OFF check: exactly GAME_OFF_HOURS_BEFORE_START before
 * scheduled kickoff in America/Vancouver (DST-safe via vancouverLocalToUtc).
 */
export function computeGameOffThresholdDueAt(
  game: Game,
  timeZone: string = NOTIFICATION_TIMEZONE
): Date {
  const start = vancouverLocalToUtc(
    game.date,
    game.startTime || "00:00",
    timeZone
  );
  return new Date(
    start.getTime() - GAME_OFF_HOURS_BEFORE_START * 60 * 60 * 1000
  );
}

export function dueAtForNotificationType(
  game: Game,
  notificationType: NotificationType,
  rule: NotificationRuleSettings,
  timeZone: string = NOTIFICATION_TIMEZONE
): Date {
  if (notificationType === "final_status") {
    return computeGameOffThresholdDueAt(game, timeZone);
  }
  return computeNotificationDueAt(game, rule, timeZone);
}

/**
 * A slot is due when now >= dueAt, the game is still scheduled,
 * and we are not past the game's start (no notifications for past games).
 * lookbackMs limits how late a cron can still pick up a missed window.
 */
export function isNotificationDue(input: {
  dueAt: Date;
  now: Date;
  game: Game;
  lookbackMs?: number;
}): boolean {
  const lookbackMs = input.lookbackMs ?? 2 * 60 * 60 * 1000; // 2 hours
  const { dueAt, now, game } = input;
  if (game.status !== "scheduled") return false;
  if (Boolean(game.noGame)) return false;
  if (now.getTime() < dueAt.getTime()) return false;
  if (now.getTime() - dueAt.getTime() > lookbackMs) return false;

  // Do not notify after the game has started (Vancouver wall via date+startTime).
  const gameStart = vancouverLocalToUtc(
    game.date,
    game.startTime || "00:00",
    NOTIFICATION_TIMEZONE
  );
  if (now.getTime() >= gameStart.getTime()) return false;
  return true;
}

/**
 * Whether the automatic Game OFF rule should send (Playing < minimum).
 * Maybe / no_response do not count — caller must pass Playing-only count.
 */
export function shouldSendGameOffThreshold(input: {
  playingCount: number;
  minPlaying: number;
}): boolean {
  const min = Math.max(2, Math.floor(input.minPlaying));
  return input.playingCount < min;
}

/**
 * Day-before, same-day, and attendance/Maybe reminders never send for No Game.
 * Game OFF stays on the existing final_status type.
 */
export function routineReminderSuppressed(
  game: Pick<Game, "noGame">,
  notificationType: NotificationType
): boolean {
  return Boolean(game.noGame) && notificationType !== "final_status";
}

export function buildDueSlots(input: {
  games: Game[];
  settings: NotificationSettings;
  now: Date;
  lookbackMs?: number;
  /** When set, only this type (for simulate). */
  onlyType?: NotificationType;
  /** When set, only this game. */
  onlyGameId?: string;
  /** Force due regardless of clock (dev simulate). */
  forceDue?: boolean;
}): ScheduledNotificationSlot[] {
  const { games, settings, now, lookbackMs, onlyType, onlyGameId, forceDue } =
    input;
  const types: NotificationType[] = onlyType
    ? [onlyType]
    : ["game_reminder", "maybe_reminder", "final_status"];

  const slots: ScheduledNotificationSlot[] = [];

  for (const game of games) {
    if (onlyGameId && game.id !== onlyGameId) continue;
    if (game.status !== "scheduled") continue;

    // No Game: never schedule routine reminders. The existing Game OFF
    // type stays due through the end of that Vancouver calendar day so a
    // later cron can deliver it once. Dedupe is the final_status dispatch.
    if (Boolean(game.noGame)) {
      if (onlyType && onlyType !== "final_status") continue;
      const rule = ruleForType(settings, "final_status");
      if (!rule.enabled) continue;
      const due =
        forceDue ||
        zonedCalendarDate(now, settings.timezone) <= game.date;
      if (!due) continue;
      slots.push({
        gameId: game.id,
        game,
        notificationType: "final_status",
        dueAt: now,
        rule,
      });
      continue;
    }

    for (const notificationType of types) {
      const rule = ruleForType(settings, notificationType);
      if (!rule.enabled) continue;
      const dueAt = dueAtForNotificationType(
        game,
        notificationType,
        rule,
        settings.timezone
      );
      const due =
        forceDue ||
        isNotificationDue({ dueAt, now, game, lookbackMs });
      if (!due) continue;
      slots.push({ gameId: game.id, game, notificationType, dueAt, rule });
    }
  }

  return slots.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
