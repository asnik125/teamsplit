import { getAdminAuth, getAdminDb } from "./admin";
import type { Player, UserProfile } from "../types";
import {
  countActiveAdmins,
  decideDeletePlayer,
  isFirebaseAuthUserNotFound,
} from "../player-delete";
import { recalculateNearestUpcomingTeams } from "./sync-teams-admin";

export interface DeletePlayerResult {
  playerId: string;
  deletedAttendance: number;
  deletedEvaluation: boolean;
  deletedUserProfile: boolean;
  /** True when Auth delete succeeded; false if unlinked or Auth was already gone */
  authDeleted: boolean;
  /** True when Auth uid was targeted but the account was already missing */
  authAlreadyMissing: boolean;
  teamsGameId: string | null;
  teamsAction: string | null;
  teamsMessage: string | null;
}

/**
 * Permanently delete a roster player.
 *
 * Order:
 * 1. Validate (incl. last-active-Admin) — no destructive work yet
 * 2. Delete linked Firebase Auth account (if any); missing Auth is OK
 * 3. Delete attendance, evaluation, players/{id}, users/{uid}
 * 4. Recalculate nearest upcoming gameTeams
 *
 * Historical completed-game team display names stay in old gameTeams docs.
 */
export async function deletePlayerAdmin(input: {
  actorUid: string;
  actorRole: string;
  playerId: string;
}): Promise<DeletePlayerResult> {
  const db = getAdminDb();
  const playerRef = db.collection("players").doc(input.playerId);
  const playerSnap = await playerRef.get();
  if (!playerSnap.exists) {
    throw Object.assign(new Error("Player not found"), { status: 404 });
  }
  const player = { ...(playerSnap.data() as Player), id: input.playerId };

  let linkedUser: UserProfile | null = null;
  if (player.linkedUid) {
    const userSnap = await db.collection("users").doc(player.linkedUid).get();
    if (userSnap.exists) {
      linkedUser = {
        ...(userSnap.data() as UserProfile),
        uid: player.linkedUid,
      };
    }
  }

  const usersSnap = await db.collection("users").get();
  const activeAdminCount = countActiveAdmins(
    usersSnap.docs.map((d) => d.data() as UserProfile)
  );

  const decision = decideDeletePlayer({
    actorRole: input.actorRole,
    player,
    linkedUser,
    activeAdminCount,
  });
  if (!decision.ok) {
    throw Object.assign(new Error(decision.error), { status: decision.status });
  }

  let authDeleted = false;
  let authAlreadyMissing = false;

  // Auth after validation, before/alongside app cleanup — so credentials cannot
  // continue signing in / reprovisioning while Firestore cleanup runs.
  if (decision.deleteAuthUid) {
    try {
      await getAdminAuth().deleteUser(decision.deleteAuthUid);
      authDeleted = true;
    } catch (err) {
      if (isFirebaseAuthUserNotFound(err)) {
        authAlreadyMissing = true;
      } else {
        throw Object.assign(
          new Error(
            err instanceof Error
              ? `Failed to delete Firebase Auth account: ${err.message}`
              : "Failed to delete Firebase Auth account"
          ),
          { status: 500 }
        );
      }
    }
  }

  const attendanceSnap = await db
    .collection("attendance")
    .where("playerId", "==", input.playerId)
    .get();

  const docs = attendanceSnap.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 450)) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }

  const evalRef = db.collection("playerEvaluations").doc(input.playerId);
  const evalSnap = await evalRef.get();
  if (evalSnap.exists) {
    await evalRef.delete();
  }

  const simpleEvalRef = db
    .collection("playerEvaluationsSimple")
    .doc(input.playerId);
  const simpleSnap = await simpleEvalRef.get();
  if (simpleSnap.exists) {
    await simpleEvalRef.delete();
  }

  await playerRef.delete();

  let deletedUserProfile = false;
  if (decision.unlinkUserUid) {
    const userRef = db.collection("users").doc(decision.unlinkUserUid);
    const uSnap = await userRef.get();
    if (uSnap.exists) {
      await userRef.delete();
      deletedUserProfile = true;
    }
  }

  const teams = await recalculateNearestUpcomingTeams(input.actorUid);

  return {
    playerId: input.playerId,
    deletedAttendance: attendanceSnap.size,
    deletedEvaluation: evalSnap.exists,
    deletedUserProfile,
    authDeleted,
    authAlreadyMissing,
    teamsGameId: teams.gameId,
    teamsAction: teams.decision?.action ?? null,
    teamsMessage: teams.decision?.message ?? null,
  };
}
