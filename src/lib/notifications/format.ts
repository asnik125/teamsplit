import type { NotificationType } from "../types";
import { notificationTypeLabel } from "./defaults";

export function formatRunSummary(run: {
  gameDate: string;
  type: NotificationType;
  successCount: number;
  recipientCount: number;
  detail: string | null;
}): string {
  const label = notificationTypeLabel(run.type);
  if (run.type === "final_status") {
    return `${run.gameDate} — Game OFF — Sent to ${run.successCount}`;
  }
  if (run.recipientCount === 0) {
    return `${run.gameDate} — ${label} — 0 recipients`;
  }
  return `${run.gameDate} — ${label} — Sent to ${run.successCount}`;
}
