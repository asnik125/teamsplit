import type { UserProfile, UserRole } from "./types";
import { isStaffRole } from "./roles";

export const LAST_ADMIN_MESSAGE = "TeamSplit must have at least one Admin.";

export type RoleChangeDecision =
  | { ok: true; previousRole: UserRole; nextRole: UserRole }
  | { ok: false; error: string; status: 400 | 403 | 404 };

/** Count active users with role admin. */
export function countActiveAdmins(
  users: Array<Pick<UserProfile, "role" | "active">>
): number {
  return users.filter((u) => u.active && isStaffRole(u.role)).length;
}

/**
 * Decide whether an Admin may set `target` to `nextRole`.
 * Enforces: requester is admin, target exists/active enough for promote,
 * linked account required (caller checks linkedUid separately if needed),
 * and never leave zero active Admins.
 */
export function decideRoleChange(input: {
  actorRole: UserRole | string;
  actorUid: string;
  target: Pick<UserProfile, "uid" | "role" | "active"> | null;
  nextRole: UserRole;
  activeAdminCount: number;
  /** Player has a linked Auth/user account */
  hasLinkedAccount: boolean;
}): RoleChangeDecision {
  if (!isStaffRole(input.actorRole)) {
    return { ok: false, error: "Admin only", status: 403 };
  }
  if (input.nextRole !== "admin" && input.nextRole !== "player") {
    return { ok: false, error: "Invalid role", status: 400 };
  }
  if (!input.hasLinkedAccount || !input.target) {
    return {
      ok: false,
      error: "No linked account",
      status: 400,
    };
  }

  const previousRole = input.target.role;
  if (previousRole === input.nextRole) {
    return { ok: true, previousRole, nextRole: input.nextRole };
  }

  // Demoting an active Admin — safeguard last Admin (including self-demotion)
  if (
    previousRole === "admin" &&
    input.nextRole === "player" &&
    input.target.active
  ) {
    if (input.activeAdminCount <= 1) {
      return { ok: false, error: LAST_ADMIN_MESSAGE, status: 403 };
    }
  }

  return { ok: true, previousRole, nextRole: input.nextRole };
}

/** UI / API: promote only when a user account is linked. */
export function canOfferRoleChange(linkedUid: string | null | undefined): boolean {
  return Boolean(linkedUid);
}
