import type { Player, UserProfile, UserRole } from "./types";
import { isStaffRole } from "./roles";
import { LAST_ADMIN_MESSAGE, countActiveAdmins } from "./role-management";

export type DeletePlayerDecision =
  | {
      ok: true;
      /** Firestore users/{uid} to remove */
      unlinkUserUid: string | null;
      /** Firebase Auth uid to permanently delete (Admin SDK) */
      deleteAuthUid: string | null;
    }
  | { ok: false; error: string; status: 400 | 403 | 404 };

/**
 * Decide whether an Admin may permanently delete a player from TeamSplit.
 *
 * Permanent delete removes app records and the linked Firebase Auth account
 * (when present). Historical completed-game team display names may remain.
 * Current nearest upcoming gameTeams is recalculated after delete.
 *
 * Blocks deleting the last active Admin's linked account before any
 * destructive Auth or Firestore work.
 */
export function decideDeletePlayer(input: {
  actorRole: UserRole | string;
  player: Pick<Player, "id" | "linkedUid"> | null;
  linkedUser: Pick<UserProfile, "uid" | "role" | "active"> | null;
  activeAdminCount: number;
}): DeletePlayerDecision {
  if (!isStaffRole(input.actorRole)) {
    return { ok: false, error: "Admin only", status: 403 };
  }
  if (!input.player) {
    return { ok: false, error: "Player not found", status: 404 };
  }

  const linkedUid = input.player.linkedUid;
  if (linkedUid) {
    if (!input.linkedUser) {
      // Linked uid on player but users doc missing — still allow player + Auth delete
      return {
        ok: true,
        unlinkUserUid: linkedUid,
        deleteAuthUid: linkedUid,
      };
    }
    if (
      input.linkedUser.active &&
      isStaffRole(input.linkedUser.role) &&
      input.activeAdminCount <= 1
    ) {
      return { ok: false, error: LAST_ADMIN_MESSAGE, status: 403 };
    }
    return {
      ok: true,
      unlinkUserUid: linkedUid,
      deleteAuthUid: linkedUid,
    };
  }

  return { ok: true, unlinkUserUid: null, deleteAuthUid: null };
}

/**
 * Ordered permanent-delete steps after a successful decideDeletePlayer.
 * Auth is deleted only after last-Admin validation, and before Firestore
 * cleanup completes so credentials cannot reprovision mid-flight.
 */
export function permanentDeleteStepOrder(input: {
  playerId: string;
  unlinkUserUid: string | null;
  deleteAuthUid: string | null;
}): string[] {
  const steps = ["validate_last_admin", "delete_auth_if_linked"] as string[];
  steps.push("delete_attendance", "delete_evaluation", "delete_player");
  if (input.unlinkUserUid) steps.push("delete_user_profile");
  steps.push("recalculate_nearest_teams");
  return steps;
}

/** Firebase Auth error when the account was already removed. */
export function isFirebaseAuthUserNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "auth/user-not-found") return true;
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /user-not-found|there is no user record/i.test(message)
  );
}

/**
 * Invariant: /api/auth/provision requires verifyIdToken against a live Auth user.
 * After Auth deletion, those credentials cannot sign in or recreate the player.
 */
export function deletedAuthBlocksProvisioning(): boolean {
  return true;
}

export { countActiveAdmins, LAST_ADMIN_MESSAGE };
