import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/notifications/auth";
import { deletePlayerAdmin } from "@/lib/firebase/delete-player-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  let body: { playerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const playerId = body.playerId?.trim();
  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }

  try {
    const result = await deletePlayerAdmin({
      actorUid: auth.uid,
      actorRole: auth.profile.role,
      playerId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete failed";
    const status =
      e &&
      typeof e === "object" &&
      "status" in e &&
      typeof (e as { status: unknown }).status === "number"
        ? ((e as { status: number }).status as number)
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
