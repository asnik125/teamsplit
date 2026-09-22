import { NextRequest, NextResponse } from "next/server";
import {
  requireAdmin,
  simulationAllowed,
} from "@/lib/notifications/auth";
import { processDueNotifications } from "@/lib/notifications/process";
import { sanitizeEmailError } from "@/lib/notifications/resend-client";
import type { NotificationType } from "@/lib/types";

export const runtime = "nodejs";

const TYPES: NotificationType[] = [
  "game_reminder",
  "maybe_reminder",
  "final_status",
];

/**
 * Dev/local only: force-evaluate a notification type for a game without
 * waiting for the scheduled Vancouver time.
 * Requires ALLOW_NOTIFICATION_SIMULATE=true or NODE_ENV=development.
 */
export async function POST(req: NextRequest) {
  if (!simulationAllowed()) {
    return NextResponse.json(
      { error: "Notification simulation is disabled in this environment" },
      { status: 403 }
    );
  }

  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  let body: { gameId?: string; type?: NotificationType };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const gameId = body.gameId?.trim();
  const type = body.type;
  if (!gameId || !type || !TYPES.includes(type)) {
    return NextResponse.json(
      { error: "gameId and type (game_reminder|maybe_reminder|final_status) required" },
      { status: 400 }
    );
  }

  try {
    const result = await processDueNotifications({
      onlyGameId: gameId,
      onlyType: type,
      forceDue: true,
      forceRedispatch: true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: sanitizeEmailError(e) },
      { status: 500 }
    );
  }
}
