import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { setGameNoGame } from "@/lib/firebase/sync-teams-admin";
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

  let body: { gameId?: string; noGame?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const gameId = body.gameId?.trim();
  if (!gameId || typeof body.noGame !== "boolean") {
    return NextResponse.json(
      { error: "gameId and noGame (boolean) are required" },
      { status: 400 }
    );
  }

  try {
    const result = await setGameNoGame({
      gameId,
      noGame: body.noGame,
      updatedBy: uid,
    });
    return NextResponse.json({
      ok: true,
      noGame: result.noGame,
      clearedAttendance: result.clearedAttendance,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update No Game";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
