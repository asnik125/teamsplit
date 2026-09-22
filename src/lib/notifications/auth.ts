import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { UserProfile } from "@/lib/types";

export async function requireBearerUser(req: NextRequest): Promise<
  | { uid: string; profile: UserProfile }
  | { error: NextResponse }
> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]!);
    const userSnap = await getAdminDb()
      .collection("users")
      .doc(decoded.uid)
      .get();
    if (!userSnap.exists) {
      return {
        error: NextResponse.json({ error: "User not found" }, { status: 403 }),
      };
    }
    const profile = userSnap.data() as UserProfile;
    if (!profile.active) {
      return {
        error: NextResponse.json({ error: "Inactive user" }, { status: 403 }),
      };
    }
    return { uid: decoded.uid, profile };
  } catch {
    return { error: NextResponse.json({ error: "Invalid token" }, { status: 401 }) };
  }
}

export async function requireAdmin(
  req: NextRequest
): Promise<{ uid: string; profile: UserProfile } | { error: NextResponse }> {
  const auth = await requireBearerUser(req);
  if ("error" in auth) return auth;
  if (auth.profile.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Admin only" }, { status: 403 }),
    };
  }
  return auth;
}

/** Vercel Cron / manual: Authorization Bearer CRON_SECRET or x-cron-secret header. */
export function requireCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  const headerSecret = req.headers.get("x-cron-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const provided = bearer || headerSecret || querySecret;
  if (!provided || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function simulationAllowed(): boolean {
  return (
    process.env.ALLOW_NOTIFICATION_SIMULATE === "true" ||
    process.env.NODE_ENV === "development"
  );
}
