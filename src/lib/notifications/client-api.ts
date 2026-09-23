import type {
  NotificationSettings,
  NotificationType,
  NotificationRunLog,
} from "../types";
import type { User } from "firebase/auth";

async function authHeaders(user: User): Promise<HeadersInit> {
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchNotificationAdmin(user: User): Promise<{
  settings: NotificationSettings;
  history: NotificationRunLog[];
}> {
  const res = await fetch("/api/admin/notifications", {
    headers: await authHeaders(user),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load notifications");
  return data;
}

export async function saveNotificationAdmin(
  user: User,
  settings: NotificationSettings
): Promise<NotificationSettings> {
  const res = await fetch("/api/admin/notifications", {
    method: "PUT",
    headers: await authHeaders(user),
    body: JSON.stringify(settings),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save settings");
  return data.settings as NotificationSettings;
}

export async function sendTestNotificationEmail(
  user: User
): Promise<{ message: string; to: string }> {
  const res = await fetch("/api/admin/notifications/test", {
    method: "POST",
    headers: await authHeaders(user),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Test email failed");
  return { message: data.message, to: data.to };
}

export async function simulateNotification(
  user: User,
  gameId: string,
  type: NotificationType
): Promise<unknown> {
  const res = await fetch("/api/admin/notifications/simulate", {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({ gameId, type }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Simulate failed");
  return data;
}

/** Admin testing: clear operational dedupe for one game + type (keeps notificationRuns). */
export async function resetNotificationDispatch(
  user: User,
  gameId: string,
  type: NotificationType
): Promise<{
  deletedDispatch: boolean;
  deletedSendCount: number;
  message: string;
}> {
  const res = await fetch("/api/admin/notifications/reset-dispatch", {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({ gameId, type, confirm: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Reset dispatch failed");
  return {
    deletedDispatch: Boolean(data.deletedDispatch),
    deletedSendCount: Number(data.deletedSendCount) || 0,
    message: String(data.message || "Reset complete"),
  };
}
