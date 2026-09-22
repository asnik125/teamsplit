import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/notifications/auth";
import {
  loadNotificationSettings,
  normalizeNotificationSettings,
  saveNotificationSettings,
} from "@/lib/notifications/store";
import type { NotificationSettings } from "@/lib/types";
import { getAdminDb } from "@/lib/firebase/admin";
import type { NotificationRunLog } from "@/lib/types";
import { sanitizeEmailError } from "@/lib/notifications/resend-client";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  try {
    const [settings, runsSnap] = await Promise.all([
      loadNotificationSettings(),
      getAdminDb()
        .collection("notificationRuns")
        .orderBy("at", "desc")
        .limit(40)
        .get(),
    ]);
    const history = runsSnap.docs.map((d) => d.data() as NotificationRunLog);
    return NextResponse.json({ settings, history });
  } catch (e) {
    return NextResponse.json(
      { error: sanitizeEmailError(e) },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  let body: Partial<NotificationSettings>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const settings = normalizeNotificationSettings(body, auth.uid);
    settings.updatedAt = new Date().toISOString();
    settings.updatedBy = auth.uid;
    await saveNotificationSettings(settings);
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    return NextResponse.json(
      { error: sanitizeEmailError(e) },
      { status: 500 }
    );
  }
}
