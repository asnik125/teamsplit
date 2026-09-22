import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  applyAttendanceAndSyncTeams,
  canUserEditPlayerAttendance,
} from "@/lib/firebase/sync-teams-admin";
import type { AttendanceStatus, UserProfile } from "@/lib/types";

const ALLOWED: AttendanceStatus[] = [
  "playing",
  "maybe",
  "not_playing",
  "no_response",
];

async function requireUser(req: NextRequest) {
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
    if (!profile.active) {
      return { error: NextResponse.json({ error: "Inactive user" }, { status: 403 }) };
    }
    return { uid: decoded.uid, profile };
  } catch {
    return { error: NextResponse.json({ error: "Invalid token" }, { status: 401 }) };
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth && auth.error) return auth.error;

  const { uid, profile } = auth as {
    uid: string;
    profile: UserProfile;
  };

  let body: {
    gameId?: string;
    playerId?: string;
    status?: AttendanceStatus;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const gameId = body.gameId?.trim();
  const playerId = body.playerId?.trim();
  const status = body.status;

  if (!gameId || !playerId || !status || !ALLOWED.includes(status)) {
    return NextResponse.json(
      { error: "gameId, playerId, and valid status are required" },
      { status: 400 }
    );
  }

  const allowed = await canUserEditPlayerAttendance({
    role: profile.role,
    ownPlayerId: profile.playerId,
    targetPlayerId: playerId,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Not allowed to change this player's attendance" },
      { status: 403 }
    );
  }

  try {
    const result = await applyAttendanceAndSyncTeams({
      gameId,
      playerId,
      status,
      updatedBy: uid,
    });
    return NextResponse.json({
      ok: true,
      message: result.decision.message,
      action: result.decision.action,
      playingCount: result.decision.includedCount,
      includedCount: result.decision.includedCount,
      markStale: result.decision.markStale,
      previousStatus: result.previousStatus,
      nextStatus: result.nextStatus,
      displayName: result.displayName,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    if (msg.includes("No Game")) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
