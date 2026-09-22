import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/notifications/auth";
import { setPlayerActiveAdmin } from "@/lib/firebase/player-lifecycle-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  let body: { playerId?: string; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const playerId = body.playerId?.trim();
  if (!playerId) {
    return NextResponse.json({ error: "playerId is required" }, { status: 400 });
  }
  if (typeof body.active !== "boolean") {
    return NextResponse.json(
      { error: "active (boolean) is required" },
      { status: 400 }
    );
  }

  try {
    const result = await setPlayerActiveAdmin({
      playerId,
      active: body.active,
      updatedBy: auth.uid,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
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
