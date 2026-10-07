import type {
  AttendanceRecord,
  AttendanceStatus,
  NotificationType,
  Player,
  UserProfile,
} from "../types";
import {
  roleBlocksGameNotifications,
  wantsEmailNotifications,
} from "./email-opt-in";

export interface NotificationRecipient {
  userId: string;
  email: string;
  displayName: string;
  playerId: string | null;
  attendanceStatus: AttendanceStatus | null;
}

/** Live attendance audience for one notification type. */
export function isAudienceForNotification(
  type: NotificationType,
  status: AttendanceStatus | null
): boolean {
  if (type === "game_reminder") return status === "no_response";
  if (type === "maybe_reminder") return status === "maybe";
  if (type === "final_status") {
    return status === "playing" || status === "maybe";
  }
  return false;
}

function skipReasonForNotification(type: NotificationType): string {
  if (type === "game_reminder") return "not_no_response";
  if (type === "maybe_reminder") return "not_maybe";
  return "not_playing_or_maybe";
}

function isValidEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const t = email.trim();
  return t.includes("@") && t.length > 3;
}

/**
 * Resolve recipients for a notification.
 * Email source: users/{uid}.email (authoritative Auth-linked profile).
 * Requires: active, notifications opt-in (default ON), valid email, and the
 * live attendance audience for this type (No response, Maybe, or Playing/Maybe).
 * Admin role does not exclude — Admin+Player is treated like Player for eligibility.
 * Missing email → skip (caller logs); never fails the whole job.
 */
export function resolveRecipients(input: {
  type: NotificationType;
  users: UserProfile[];
  players: Player[];
  attendance: AttendanceRecord[];
}): {
  recipients: NotificationRecipient[];
  skipped: { userId: string; reason: string }[];
} {
  const { type, users, players, attendance } = input;
  const attendanceByPlayer = new Map(
    attendance.map((a) => [a.playerId, a.status] as const)
  );
  const playerById = new Map(players.map((p) => [p.id, p]));

  const skipped: { userId: string; reason: string }[] = [];
  const recipients: NotificationRecipient[] = [];

  for (const user of users) {
    if (!user.active) {
      skipped.push({ userId: user.uid, reason: "inactive" });
      continue;
    }
    if (roleBlocksGameNotifications(user.role)) {
      skipped.push({ userId: user.uid, reason: "role_blocked" });
      continue;
    }
    if (!wantsEmailNotifications(user)) {
      skipped.push({ userId: user.uid, reason: "emailNotifications_off" });
      continue;
    }
    if (!isValidEmail(user.email)) {
      skipped.push({ userId: user.uid, reason: "missing_email" });
      continue;
    }

    const playerId = user.playerId;
    const status = playerId
      ? (attendanceByPlayer.get(playerId) ?? "no_response")
      : null;

    if (!isAudienceForNotification(type, status)) {
      skipped.push({
        userId: user.uid,
        reason: skipReasonForNotification(type),
      });
      continue;
    }

    // Prefer linked player display name when available.
    const playerName =
      (playerId && playerById.get(playerId)?.displayName) || user.displayName;

    recipients.push({
      userId: user.uid,
      email: user.email.trim(),
      displayName: playerName,
      playerId,
      attendanceStatus: status,
    });
  }

  return { recipients, skipped };
}

export function countPlaying(attendance: AttendanceRecord[]): number {
  return attendance.filter((a) => a.status === "playing").length;
}
