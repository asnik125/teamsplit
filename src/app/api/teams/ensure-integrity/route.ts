import { NextRequest, NextResponse } from "next/server";
import { requireBearerUser } from "@/lib/notifications/auth";
import { ensureNearestTeamsIntegrity } from "@/lib/firebase/sync-teams-admin";

export const runtime = "nodejs";

/**
 * Any authenticated user loading the Game view can trigger a repair of
 * stale nearest gameTeams (ghost inactive/deleted members, etc.).
 */
export async function POST(req: NextRequest) {
  const auth = await requireBearerUser(req);
  if ("error" in auth) return auth.error;

  try {
    const result = await ensureNearestTeamsIntegrity(auth.uid);
    return NextResponse.json({
      ok: true,
      gameId: result.gameId,
      repaired: result.repaired,
      action: result.decision?.action ?? null,
      message: result.decision?.message ?? null,
      includedCount: result.decision?.includedCount ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ensure failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
