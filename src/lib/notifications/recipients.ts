import type {
  AttendanceRecord,
  AttendanceStatus,
  NotificationType,
  Player,
  UserProfile,
} from "../types";

export interface NotificationRecipient {
  userId: string;
  email: string;
  displayName: string;
  playerId: string | null;
  attendanceStatus: AttendanceStatus | null;
}

function isValidEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const t = email.trim();
  return t.includes("@") && t.length > 3;
}

/**
 * Resolve recipients for a notification.
 * Email source: users/{uid}.email (authoritative Auth-linked profile).
 * Requires: active, emailNotifications === true, valid email.
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
    // Explicit true required — existing false stays opted out.
    if (user.emailNotifications !== true) {
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

    if (type === "maybe_reminder") {
      if (status !== "maybe") {
        skipped.push({ userId: user.uid, reason: "not_maybe" });
        continue;
      }
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
