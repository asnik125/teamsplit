import { getAdminDb } from "./admin";
import type { UserProfile, UserRole } from "../types";
import {
  countActiveAdmins,
  decideRoleChange,
} from "../role-management";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Admin SDK: set a linked user's role with last-Admin safeguard.
 */
export async function setUserRoleAdmin(input: {
  actorUid: string;
  actorRole: string;
  targetUid: string;
  nextRole: UserRole;
  /** When promoting via player profile, require this player is linked to targetUid */
  expectedPlayerId?: string | null;
}): Promise<{ previousRole: UserRole; nextRole: UserRole }> {
  const db = getAdminDb();
  const targetRef = db.collection("users").doc(input.targetUid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw Object.assign(new Error("No linked account"), { status: 404 });
  }
  const target = targetSnap.data() as UserProfile;

  if (input.expectedPlayerId != null && input.expectedPlayerId !== "") {
    if (target.playerId !== input.expectedPlayerId) {
      throw Object.assign(
        new Error("User is not linked to this player"),
        { status: 400 }
      );
    }
    const playerSnap = await db
      .collection("players")
      .doc(input.expectedPlayerId)
      .get();
    if (!playerSnap.exists) {
      throw Object.assign(new Error("Player not found"), { status: 404 });
    }
    const linkedUid = (playerSnap.data() as { linkedUid?: string | null })
      .linkedUid;
    if (linkedUid !== input.targetUid) {
      throw Object.assign(new Error("No linked account"), { status: 400 });
    }
  }

  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map((d) => d.data() as UserProfile);
  const activeAdminCount = countActiveAdmins(users);

  const decision = decideRoleChange({
    actorRole: input.actorRole,
    actorUid: input.actorUid,
    target: { uid: target.uid ?? input.targetUid, role: target.role, active: target.active },
    nextRole: input.nextRole,
    activeAdminCount,
    hasLinkedAccount: true,
  });

  if (!decision.ok) {
    throw Object.assign(new Error(decision.error), { status: decision.status });
  }

  if (decision.previousRole !== decision.nextRole) {
    await targetRef.update({
      role: decision.nextRole,
      updatedAt: nowIso(),
    });
  }

  return {
    previousRole: decision.previousRole,
    nextRole: decision.nextRole,
  };
}
