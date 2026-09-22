import { NextRequest, NextResponse } from "next/server";
import { processDueNotifications } from "@/lib/notifications/process";
import { requireCronSecret } from "@/lib/notifications/auth";
import { sanitizeEmailError } from "@/lib/notifications/resend-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const result = await processDueNotifications();
    return NextResponse.json({
      ok: true,
      slotsProcessed: result.slotsProcessed,
      runs: result.runs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: sanitizeEmailError(e) },
      { status: 500 }
    );
  }
}

/** Vercel Cron typically uses GET. */
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
