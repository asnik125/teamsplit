import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/notifications/auth";
import {
  canAdminResetNotificationDedupe,
  notificationDedupeResetTargets,
  resetNotificationDedupeState,
} from "@/lib/notifications/store";
import { sanitizeEmailError } from "@/lib/notifications/resend-client";
import { notificationTypeLabel } from "@/lib/notifications/defaults";
import type { NotificationType } from "@/lib/types";

export const runtime = "nodejs";

const TYPES: NotificationType[] = [
  "game_reminder",
  "maybe_reminder",
  "final_status",
];

/**
 * Admin testing only: clear operational dedupe for one game + notification type
 * so the next genuine due cron can claim and Resend again.
 * Does not delete notificationRuns. Does not change production claim logic.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  if (!canAdminResetNotificationDedupe(auth.profile.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let body: {
    gameId?: string;
    type?: NotificationType;
    confirm?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const gameId = body.gameId?.trim();
  const type = body.type;
  if (!gameId || !type || !TYPES.includes(type)) {
    return NextResponse.json(
      {
        error:
          "gameId and type (game_reminder|maybe_reminder|final_status) required",
      },
      { status: 400 }
    );
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      {
        error:
          "Explicit confirm: true is required for this testing reset action",
      },
      { status: 400 }
    );
  }

  try {
    const targets = notificationDedupeResetTargets(gameId, type);
    const result = await resetNotificationDedupeState({ gameId, type });
    return NextResponse.json({
      ok: true,
      testingReset: true,
      gameId,
      type,
      typeLabel: notificationTypeLabel(type),
      dispatchDocId: targets.dispatchDocId,
      deletedDispatch: result.deletedDispatch,
      deletedSendCount: result.deletedSendCount,
      preserved: targets.preserveCollections,
      message:
        "Operational dedupe cleared for this game/type. notificationRuns were not modified. The next due cron may send again.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: sanitizeEmailError(e) },
      { status: 500 }
    );
  }
}
