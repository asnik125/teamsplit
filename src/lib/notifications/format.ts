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
  if (run.type === "final_status" && run.detail?.includes("ON")) {
    return `${run.gameDate} — Game ON — Sent to ${run.successCount}`;
  }
  if (run.type === "final_status" && run.detail?.includes("OFF")) {
    return `${run.gameDate} — Game OFF — Sent to ${run.successCount}`;
  }
  if (run.recipientCount === 0) {
    return `${run.gameDate} — ${label} — 0 recipients`;
  }
  return `${run.gameDate} — ${label} — Sent to ${run.successCount}`;
}
