import type {
  NotificationSendRecord,
  NotificationSettings,
  NotificationType,
} from "../types";
import { getAdminDb } from "../firebase/admin";
import {
  defaultNotificationSettings,
  NOTIFICATION_SETTINGS_DOC,
  sendRecordId,
} from "./defaults";

function normalizeRule(
  raw: Partial<NotificationSettings["gameReminder"]> | undefined,
  fallbackDays: number,
  fallbackTime: string
) {
  const days = Number(raw?.daysBefore);
  const time =
    typeof raw?.timeLocal === "string" && /^\d{1,2}:\d{2}$/.test(raw.timeLocal)
      ? raw.timeLocal
      : fallbackTime;
  const normalizedTime =
    time.length === 4 && time.indexOf(":") === 1 ? `0${time}` : time;
  return {
    enabled: raw?.enabled !== false,
    daysBefore:
      Number.isFinite(days) && days >= 0 && days <= 14
        ? Math.floor(days)
        : fallbackDays,
    timeLocal: normalizedTime,
  };
}

export function normalizeNotificationSettings(
  data: Partial<NotificationSettings> | undefined,
  updatedBy: string | null = null
): NotificationSettings {
  const defaults = defaultNotificationSettings(updatedBy);
  if (!data) return defaults;
  return {
    timezone: "America/Vancouver",
    gameReminder: normalizeRule(data.gameReminder, 1, "19:00"),
    maybeReminder: normalizeRule(data.maybeReminder, 0, "16:00"),
    finalStatus: normalizeRule(data.finalStatus, 0, "18:00"),
    updatedAt: data.updatedAt ?? defaults.updatedAt,
    updatedBy: data.updatedBy ?? updatedBy,
  };
}

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  const snap = await getAdminDb()
    .collection("settings")
    .doc(NOTIFICATION_SETTINGS_DOC)
    .get();
  if (!snap.exists) {
    const defaults = defaultNotificationSettings(null);
    await getAdminDb()
      .collection("settings")
      .doc(NOTIFICATION_SETTINGS_DOC)
      .set(defaults);
    return defaults;
  }
  return normalizeNotificationSettings(
    snap.data() as Partial<NotificationSettings>
  );
}

export async function saveNotificationSettings(
  settings: NotificationSettings
): Promise<void> {
  const normalized = normalizeNotificationSettings(settings, settings.updatedBy);
  await getAdminDb()
    .collection("settings")
    .doc(NOTIFICATION_SETTINGS_DOC)
    .set(normalized);
}

export function dispatchDocId(gameId: string, type: NotificationType): string {
  return `${gameId}_${type}`;
}

/**
 * Claim a whole game+type dispatch so cron does not re-log zero-recipient
 * runs or re-enter after all recipients were handled.
 * Returns false if already completed (and no failed recipients remain).
 */
export async function claimDispatch(input: {
  gameId: string;
  type: NotificationType;
  nowIso: string;
  force?: boolean;
}): Promise<boolean> {
  if (input.force) return true;
  const db = getAdminDb();
  const ref = db
    .collection("notificationDispatches")
    .doc(dispatchDocId(input.gameId, input.type));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() as {
        status?: string;
        hasFailures?: boolean;
      };
      if (data.status === "completed" && !data.hasFailures) {
        return false;
      }
    }
    tx.set(
      ref,
      {
        id: dispatchDocId(input.gameId, input.type),
        gameId: input.gameId,
        notificationType: input.type,
        status: "in_progress",
        hasFailures: false,
        updatedAt: input.nowIso,
        claimedAt: input.nowIso,
      },
      { merge: true }
    );
    return true;
  });
}

export async function completeDispatch(input: {
  gameId: string;
  type: NotificationType;
  nowIso: string;
  hasFailures: boolean;
}): Promise<void> {
  await getAdminDb()
    .collection("notificationDispatches")
    .doc(dispatchDocId(input.gameId, input.type))
    .set(
      {
        status: "completed",
        hasFailures: input.hasFailures,
        completedAt: input.nowIso,
        updatedAt: input.nowIso,
      },
      { merge: true }
    );
}

export async function claimSendSlot(input: {
  gameId: string;
  type: NotificationType;
  userId: string;
  email: string;
  nowIso: string;
  staleClaimMs?: number;
}): Promise<"proceed" | "already_sent" | "in_flight"> {
  const db = getAdminDb();
  const id = sendRecordId(input.gameId, input.type, input.userId);
  const ref = db.collection("notificationSends").doc(id);
  const staleClaimMs = input.staleClaimMs ?? 10 * 60 * 1000;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() as NotificationSendRecord;
      if (data.status === "sent") return "already_sent";
      if (data.status === "claimed") {
        const claimedAt = Date.parse(data.claimedAt || "");
        if (
          Number.isFinite(claimedAt) &&
          Date.now() - claimedAt < staleClaimMs
        ) {
          return "in_flight";
        }
      }
    }

    const record: NotificationSendRecord = {
      id,
      gameId: input.gameId,
      notificationType: input.type,
      userId: input.userId,
      email: input.email,
      status: "claimed",
      error: null,
      resendId: null,
      claimedAt: input.nowIso,
      sentAt: null,
      updatedAt: input.nowIso,
    };
    tx.set(ref, record);
    return "proceed";
  });
}

export async function markSendSent(input: {
  gameId: string;
  type: NotificationType;
  userId: string;
  resendId: string;
  nowIso: string;
}): Promise<void> {
  const id = sendRecordId(input.gameId, input.type, input.userId);
  await getAdminDb()
    .collection("notificationSends")
    .doc(id)
    .set(
      {
        status: "sent",
        resendId: input.resendId,
        sentAt: input.nowIso,
        updatedAt: input.nowIso,
        error: null,
      },
      { merge: true }
    );
}

export async function markSendFailed(input: {
  gameId: string;
  type: NotificationType;
  userId: string;
  error: string;
  nowIso: string;
}): Promise<void> {
  const id = sendRecordId(input.gameId, input.type, input.userId);
  await getAdminDb()
    .collection("notificationSends")
    .doc(id)
    .set(
      {
        status: "failed",
        error: input.error,
        updatedAt: input.nowIso,
      },
      { merge: true }
    );
}

/**
 * Admin testing reset / Simulate forceRedispatch:
 * Clears operational dedupe for exactly one game + notification type.
 * - Deletes notificationDispatches/{gameId}_{type}
 * - Deletes notificationSends matching that gameId + type
 * Does NOT touch notificationRuns (audit trail) or other games/types.
 */
export async function resetNotificationDedupeState(input: {
  gameId: string;
  type: NotificationType;
}): Promise<{ deletedDispatch: boolean; deletedSendCount: number }> {
  const db = getAdminDb();
  const dispatchRef = db
    .collection("notificationDispatches")
    .doc(dispatchDocId(input.gameId, input.type));
  const [sendsSnap, dispatchSnap] = await Promise.all([
    db
      .collection("notificationSends")
      .where("gameId", "==", input.gameId)
      .where("notificationType", "==", input.type)
      .get(),
    dispatchRef.get(),
  ]);

  if (sendsSnap.empty && !dispatchSnap.exists) {
    return { deletedDispatch: false, deletedSendCount: 0 };
  }

  const batch = db.batch();
  for (const doc of sendsSnap.docs) {
    batch.delete(doc.ref);
  }
  if (dispatchSnap.exists) {
    batch.delete(dispatchRef);
  }
  await batch.commit();
  return {
    deletedDispatch: dispatchSnap.exists,
    deletedSendCount: sendsSnap.size,
  };
}

/** Pure description of what a targeted reset affects (for tests / UI copy). */
export function notificationDedupeResetTargets(
  gameId: string,
  type: NotificationType
): {
  dispatchDocId: string;
  sendsFilter: { gameId: string; notificationType: NotificationType };
  preserveCollections: readonly string[];
} {
  return {
    dispatchDocId: dispatchDocId(gameId, type),
    sendsFilter: { gameId, notificationType: type },
    preserveCollections: ["notificationRuns"] as const,
  };
}

export function canAdminResetNotificationDedupe(role: string | null | undefined): boolean {
  return role === "admin";
}

/**
 * Mirror of claimDispatch gate — used in tests to prove reset unlocks re-entry.
 * Production claimDispatch is unchanged.
 */
export function dispatchAllowsClaim(doc: {
  status?: string;
  hasFailures?: boolean;
} | null): boolean {
  if (!doc) return true;
  if (doc.status === "completed" && !doc.hasFailures) return false;
  return true;
}

/**
 * Mirror of claimSendSlot "already_sent" gate for tests.
 */
export function sendRecordBlocksResend(doc: {
  status?: string;
} | null): boolean {
  if (!doc) return false;
  return doc.status === "sent";
}
