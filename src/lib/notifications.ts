/**
 * Notification / email service boundary.
 * No emails are sent in MVP. Wire a provider later without changing UI flows.
 */

export type NotificationEvent =
  | "gameCreated"
  | "gameReminder"
  | "teamsPublished"
  | "gameChanged"
  | "gameCancelled";

export interface NotificationPayload {
  event: NotificationEvent;
  to: { email: string; displayName: string }[];
  gameId?: string;
  subject?: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationService {
  send(payload: NotificationPayload): Promise<{ queued: boolean; reason?: string }>;
}

/** MVP stub — never sends mail. */
export class NoopNotificationService implements NotificationService {
  async send(payload: NotificationPayload) {
    if (process.env.NODE_ENV === "development") {
      console.info("[notifications:noop]", payload.event, {
        recipients: payload.to.length,
        gameId: payload.gameId,
      });
    }
    return { queued: false, reason: "noop-mvp" };
  }
}

let service: NotificationService = new NoopNotificationService();

export function getNotificationService(): NotificationService {
  return service;
}

/** Call later when wiring SendGrid / SES / etc. */
export function setNotificationService(next: NotificationService): void {
  service = next;
}
