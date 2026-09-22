import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { ensureRegisteredPlayerOnboarding } from "@/lib/firebase/ensure-onboarding-admin";

export const runtime = "nodejs";

/**
 * Idempotent onboarding: users + linked Player + default evaluation (5s).
 * Safe to call on every sign-in / recovery. Never overwrites existing ratings.
 * Never creates admin.
 */
export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  let email: string;
  let tokenName: string | undefined;
  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]!);
    uid = decoded.uid;
    email = (decoded.email ?? "").trim().toLowerCase();
    tokenName =
      typeof decoded.name === "string" ? decoded.name : undefined;
    if (!email) {
      return NextResponse.json(
        { error: "Auth account must have an email" },
        { status: 400 }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid token";
    return NextResponse.json(
      { error: "Invalid token", detail: msg },
      { status: 401 }
    );
  }

  let body: { displayName?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.role != null && body.role !== "player") {
    return NextResponse.json(
      { error: "Registration can only create Player accounts" },
      { status: 403 }
    );
  }

  const displayName =
    (body.displayName ?? "").trim() ||
    tokenName?.trim() ||
    email.split("@")[0] ||
    "Player";

  try {
    const result = await ensureRegisteredPlayerOnboarding({
      uid,
      email,
      displayName,
    });
    return NextResponse.json({
      ok: true,
      playerId: result.playerId,
      role: result.profile.role,
      createdUser: result.createdUser,
      createdPlayer: result.createdPlayer,
      createdEvaluation: result.createdEvaluation,
      activatedPlayer: result.activatedPlayer,
      alreadyExists: !result.createdUser,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Provisioning failed";
    const status =
      e &&
      typeof e === "object" &&
      "status" in e &&
      typeof (e as { status: unknown }).status === "number"
        ? ((e as { status: number }).status as number)
        : 500;
    console.error("[auth/provision]", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
