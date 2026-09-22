import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/notifications/auth";
import { setUserRoleAdmin } from "@/lib/firebase/set-user-role-admin";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";

const ALLOWED: UserRole[] = ["admin", "player"];

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  let body: {
    uid?: string;
    role?: UserRole;
    playerId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const uid = body.uid?.trim();
  const role = body.role;
  if (!uid || !role || !ALLOWED.includes(role)) {
    return NextResponse.json(
      { error: "uid and role (admin|player) are required" },
      { status: 400 }
    );
  }

  try {
    const result = await setUserRoleAdmin({
      actorUid: auth.uid,
      actorRole: auth.profile.role,
      targetUid: uid,
      nextRole: role,
      expectedPlayerId: body.playerId ?? null,
    });
    return NextResponse.json({
      ok: true,
      previousRole: result.previousRole,
      nextRole: result.nextRole,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Role update failed";
    const status =
      e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number"
        ? ((e as { status: number }).status as number)
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
