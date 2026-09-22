import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/notifications/auth";
import {
  buildTestEmail,
} from "@/lib/notifications/templates";
import {
  getAppUrl,
  getEmailFrom,
  sanitizeEmailError,
  sendResendEmail,
} from "@/lib/notifications/resend-client";

export const runtime = "nodejs";

/** Send a test email ONLY to the logged-in Admin. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  const email = auth.profile.email?.trim();
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Admin account has no valid email" },
      { status: 400 }
    );
  }

  try {
    const content = buildTestEmail({
      from: getEmailFrom(),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "local",
      timestampIso: new Date().toISOString(),
      appUrl: getAppUrl(),
    });
    const sent = await sendResendEmail({ to: email, content });
    return NextResponse.json({
      ok: true,
      message: "Test email sent",
      to: email,
      id: sent.id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: sanitizeEmailError(e) },
      { status: 500 }
    );
  }
}
