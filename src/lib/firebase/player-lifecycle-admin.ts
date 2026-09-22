import type { Game, Player } from "../types";
import { gamesRequiringAttendanceResetOnReactivate } from "../player-lifecycle";
import { getAdminDb } from "./admin";
import { recalculateNearestUpcomingTeams } from "./sync-teams-admin";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Delete attendance docs for playable upcoming games so reactivation shows "—"
 * and does not silently restore stale Playing into team eligibility.
 */
export async function clearUpcomingAttendanceForPlayer(
  playerId: string
): Promise<number> {
  const db = getAdminDb();
  const [gamesSnap, attendanceSnap] = await Promise.all([
    db.collection("games").where("status", "==", "scheduled").get(),
    db.collection("attendance").where("playerId", "==", playerId).get(),
  ]);

  const games = gamesSnap.docs.map((d) => ({
    ...(d.data() as Game),
    id: d.id,
  }));
  const clearIds = new Set(
    gamesRequiringAttendanceResetOnReactivate(games).map((g) => g.id)
  );

  const toDelete = attendanceSnap.docs.filter((d) => {
    const gameId = (d.data() as { gameId?: string }).gameId;
    return Boolean(gameId && clearIds.has(gameId));
  });

  for (let i = 0; i < toDelete.length; i += 450) {
    const batch = db.batch();
    for (const d of toDelete.slice(i, i + 450)) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }

  return toDelete.length;
}

export interface SetPlayerActiveResult {
  playerId: string;
  active: boolean;
  clearedAttendance: number;
  teamsGameId: string | null;
  teamsAction: string | null;
  teamsMessage: string | null;
}

/**
 * Admin activate / deactivate with nearest-team integrity.
 *
 * Deactivate: set active=false, then recalculate nearest teams (inactive excluded).
 * Reactivate: set active=true, clear upcoming attendance to "—", then recalculate
 * (player will not enter teams until they choose Playing again).
 */
export async function setPlayerActiveAdmin(input: {
  playerId: string;
  active: boolean;
  updatedBy: string | null;
}): Promise<SetPlayerActiveResult> {
  const db = getAdminDb();
  const playerRef = db.collection("players").doc(input.playerId);
  const playerSnap = await playerRef.get();
  if (!playerSnap.exists) {
    throw Object.assign(new Error("Player not found"), { status: 404 });
  }

  const player = { ...(playerSnap.data() as Player), id: input.playerId };
  if (Boolean(player.active) === input.active) {
    const { gameId, decision } = await recalculateNearestUpcomingTeams(
      input.updatedBy
    );
    return {
      playerId: input.playerId,
      active: input.active,
      clearedAttendance: 0,
      teamsGameId: gameId,
      teamsAction: decision?.action ?? null,
      teamsMessage: decision?.message ?? null,
    };
  }

  // Write active flag first so team generation sees authoritative state
  await playerRef.update({
    active: input.active,
    updatedAt: nowIso(),
  });

  let clearedAttendance = 0;
  if (input.active) {
    clearedAttendance = await clearUpcomingAttendanceForPlayer(input.playerId);
  }

  const { gameId, decision } = await recalculateNearestUpcomingTeams(
    input.updatedBy
  );

  return {
    playerId: input.playerId,
    active: input.active,
    clearedAttendance,
    teamsGameId: gameId,
    teamsAction: decision?.action ?? null,
    teamsMessage: decision?.message ?? null,
  };
}
