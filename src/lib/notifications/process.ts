import type {
  AttendanceRecord,
  Game,
  NotificationRunLog,
  NotificationType,
  Player,
  UserProfile,
} from "../types";
import { getAdminDb } from "../firebase/admin";
import { DEFAULT_MIN_PLAYING_FOR_TEAMS } from "../team-sync";
import { countPlaying, resolveRecipients } from "./recipients";
import {
  getAppUrl,
  sanitizeEmailError,
  sendResendEmail,
} from "./resend-client";
import {
  buildDueSlots,
  routineReminderSuppressed,
  shouldSendGameOffThreshold,
  type ScheduledNotificationSlot,
} from "./schedule";
import {
  claimDispatch,
  claimSendSlot,
  completeDispatch,
  loadNotificationSettings,
  markSendFailed,
  markSendSent,
  resetNotificationDedupeState,
} from "./store";
import { buildEmailForType } from "./templates";

export { formatRunSummary } from "./format";

export interface ProcessNotificationsOptions {
  now?: Date;
  lookbackMs?: number;
  onlyType?: NotificationType;
  onlyGameId?: string;
  /** Dev/simulate: treat matching slots as due regardless of clock. */
  forceDue?: boolean;
  /** Dev/simulate: allow re-dispatch even if previously completed. */
  forceRedispatch?: boolean;
}

export interface ProcessNotificationsResult {
  slotsProcessed: number;
  runs: Array<{
    gameId: string;
    type: NotificationType;
    subject: string;
    result: NotificationRunLog["result"];
    successCount: number;
    failureCount: number;
    recipientCount: number;
    detail: string | null;
  }>;
}

function gameFromDoc(docId: string, data: Partial<Game>): Game {
  return {
    ...(data as Game),
    id: docId,
    noGame: Boolean(data.noGame),
  };
}

async function loadMinPlaying(): Promise<number> {
  const snap = await getAdminDb().collection("settings").doc("app").get();
  if (!snap.exists) return DEFAULT_MIN_PLAYING_FOR_TEAMS;
  const min = Number(snap.data()?.minPlayingForTeams);
  return Number.isFinite(min) && min >= 2
    ? Math.floor(min)
    : DEFAULT_MIN_PLAYING_FOR_TEAMS;
}

export async function processDueNotifications(
  options: ProcessNotificationsOptions = {}
): Promise<ProcessNotificationsResult> {
  const now = options.now ?? new Date();
  const db = getAdminDb();
  const settings = await loadNotificationSettings();
  const minPlaying = await loadMinPlaying();

  const [gamesSnap, usersSnap, playersSnap] = await Promise.all([
    db.collection("games").where("status", "==", "scheduled").get(),
    db.collection("users").get(),
    db.collection("players").get(),
  ]);

  const games = gamesSnap.docs.map((d) =>
    gameFromDoc(d.id, d.data() as Partial<Game>)
  );
  const users = usersSnap.docs.map((d) => d.data() as UserProfile);
  const players = playersSnap.docs.map((d) => d.data() as Player);

  const slots = buildDueSlots({
    games,
    settings,
    now,
    lookbackMs: options.lookbackMs,
    onlyType: options.onlyType,
    onlyGameId: options.onlyGameId,
    forceDue: options.forceDue,
  });

  const runs: ProcessNotificationsResult["runs"] = [];

  for (const slot of slots) {
    const run = await dispatchNotificationSlot({
      slot,
      now,
      minPlaying,
      users,
      players,
      forceRedispatch: options.forceRedispatch,
    });
    if (run) runs.push(run);
  }

  return { slotsProcessed: slots.length, runs };
}

/**
 * Send the existing Game OFF notification (final_status) for a game an
 * admin just marked No Game. Uses the same template and dispatch dedupe
 * as the automatic low-attendance OFF rule.
 */
export async function dispatchGameOffNotification(
  game: Game,
  now: Date = new Date()
): Promise<ProcessNotificationsResult["runs"][number] | null> {
  if (game.status !== "scheduled") return null;
  const settings = await loadNotificationSettings();
  if (!settings.finalStatus.enabled) return null;

  const db = getAdminDb();
  const minPlaying = await loadMinPlaying();
  const [usersSnap, playersSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("players").get(),
  ]);
  const users = usersSnap.docs.map((d) => d.data() as UserProfile);
  const players = playersSnap.docs.map((d) => d.data() as Player);

  return dispatchNotificationSlot({
    slot: {
      gameId: game.id,
      game: { ...game, noGame: true },
      notificationType: "final_status",
      dueAt: now,
      rule: settings.finalStatus,
    },
    now,
    minPlaying,
    users,
    players,
  });
}

async function dispatchNotificationSlot(input: {
  slot: ScheduledNotificationSlot;
  now: Date;
  minPlaying: number;
  users: UserProfile[];
  players: Player[];
  forceRedispatch?: boolean;
}): Promise<ProcessNotificationsResult["runs"][number] | null> {
  const { slot, now, minPlaying, users, players } = input;
  const db = getAdminDb();
  const nowIso = now.toISOString();

  // Server-side gate: No Game must not send routine reminders even if a
  // slot was built (simulate, stale schedule, or a missed flag).
  if (routineReminderSuppressed(slot.game, slot.notificationType)) {
    return null;
  }

  if (input.forceRedispatch) {
    await resetNotificationDedupeState({
      gameId: slot.gameId,
      type: slot.notificationType,
    });
  }

  const noGame = Boolean(slot.game.noGame);

  // Automatic Game OFF: evaluate Playing count before claiming so a
  // sufficient roster does not lock the dispatch (and never sends ON).
  // Admin No Game always uses this same OFF type, regardless of count.
  let attendance: AttendanceRecord[] = [];
  let playingCount = 0;
  if (slot.notificationType === "final_status") {
    const attendanceSnap = await db
      .collection("attendance")
      .where("gameId", "==", slot.gameId)
      .get();
    attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
    playingCount = countPlaying(attendance);
    if (
      !noGame &&
      !shouldSendGameOffThreshold({
        playingCount,
        minPlaying,
      })
    ) {
      return null;
    }
  }

  const claimed = await claimDispatch({
    gameId: slot.gameId,
    type: slot.notificationType,
    nowIso,
    force: false,
  });
  if (!claimed) return null;

  if (slot.notificationType !== "final_status") {
    const attendanceSnap = await db
      .collection("attendance")
      .where("gameId", "==", slot.gameId)
      .get();
    attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
    playingCount = countPlaying(attendance);
  }

  const { recipients, skipped } = resolveRecipients({
    type: slot.notificationType,
    users,
    players,
    attendance,
  });

  let successCount = 0;
  let failureCount = 0;
  let skippedCount = skipped.length;

  let subject = "";
  let detail: string | null = null;

  if (slot.notificationType === "final_status") {
    detail = `Game is OFF (${playingCount} Playing, need ${minPlaying})`;
  }

  const forceOff = noGame || playingCount < minPlaying;
  const baseContent = buildEmailForType({
    type: slot.notificationType,
    game: slot.game,
    attendanceStatus: null,
    playingCount,
    minPlaying,
    appUrl: getAppUrl(),
    forceOff: slot.notificationType === "final_status" ? forceOff : false,
  });
  subject = baseContent.subject;

  for (const recipient of recipients) {
    const claim = await claimSendSlot({
      gameId: slot.gameId,
      type: slot.notificationType,
      userId: recipient.userId,
      email: recipient.email,
      nowIso,
    });
    if (claim === "already_sent" || claim === "in_flight") {
      skippedCount += 1;
      continue;
    }

    const content = buildEmailForType({
      type: slot.notificationType,
      game: slot.game,
      attendanceStatus: recipient.attendanceStatus,
      playingCount,
      minPlaying,
      appUrl: getAppUrl(),
      forceOff: slot.notificationType === "final_status" ? forceOff : false,
    });
    subject = content.subject;

    try {
      const sent = await sendResendEmail({
        to: recipient.email,
        content,
      });
      await markSendSent({
        gameId: slot.gameId,
        type: slot.notificationType,
        userId: recipient.userId,
        resendId: sent.id,
        nowIso,
      });
      successCount += 1;
    } catch (err) {
      await markSendFailed({
        gameId: slot.gameId,
        type: slot.notificationType,
        userId: recipient.userId,
        error: sanitizeEmailError(err),
        nowIso,
      });
      failureCount += 1;
    }
  }

  const result =
    recipients.length === 0
      ? "zero_recipients"
      : failureCount === 0 && successCount > 0
        ? "sent"
        : failureCount > 0 && successCount > 0
          ? "partial"
          : failureCount > 0 && successCount === 0
            ? "failed"
            : // all already sent / in flight
              "sent";

  await completeDispatch({
    gameId: slot.gameId,
    type: slot.notificationType,
    nowIso,
    hasFailures: failureCount > 0,
  });

  const run = await writeRunLog({
    at: nowIso,
    game: slot.game,
    type: slot.notificationType,
    subject,
    result,
    recipientCount: recipients.length,
    successCount,
    failureCount,
    skippedCount,
    detail,
  });

  return {
    gameId: slot.gameId,
    type: slot.notificationType,
    subject,
    result: run.result,
    successCount,
    failureCount,
    recipientCount: recipients.length,
    detail,
  };
}

async function writeRunLog(input: {
  at: string;
  game: Game;
  type: NotificationType;
  subject: string;
  result: NotificationRunLog["result"];
  recipientCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  detail: string | null;
}): Promise<NotificationRunLog> {
  const ref = getAdminDb().collection("notificationRuns").doc();
  const log: NotificationRunLog = {
    id: ref.id,
    at: input.at,
    gameId: input.game.id,
    gameDate: input.game.date,
    gameLocation: input.game.location,
    notificationType: input.type,
    subject: input.subject,
    result: input.result,
    recipientCount: input.recipientCount,
    successCount: input.successCount,
    failureCount: input.failureCount,
    skippedCount: input.skippedCount,
    detail: input.detail,
  };
  await ref.set(log);
  return log;
}
