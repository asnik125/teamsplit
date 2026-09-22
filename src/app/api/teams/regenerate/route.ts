import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { regenerateTeamsFromAttendance } from "@/lib/firebase/sync-teams-admin";
import type { UserProfile } from "@/lib/types";

async function requireAdmin(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(match[1]!);
    const userSnap = await getAdminDb().collection("users").doc(decoded.uid).get();
    if (!userSnap.exists) {
      return { error: NextResponse.json({ error: "User not found" }, { status: 403 }) };
    }
    const profile = userSnap.data() as UserProfile;
    if (!profile.active || profile.role !== "admin") {
      return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
    }
    return { uid: decoded.uid, profile };
  } catch {
    return { error: NextResponse.json({ error: "Invalid token" }, { status: 401 }) };
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth && auth.error) return auth.error;

  const { uid } = auth as { uid: string };

  let body: { gameId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const gameId = body.gameId?.trim();
  if (!gameId) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }

  try {
    const decision = await regenerateTeamsFromAttendance({
      gameId,
      updatedBy: uid,
    });
    return NextResponse.json({
      ok: true,
      message: decision.message,
      action: decision.action,
      playingCount: decision.playingCount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Regenerate failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
