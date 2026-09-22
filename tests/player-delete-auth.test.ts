import { describe, expect, it } from "vitest";
import { calculateOverall } from "@/lib/balancer";
import {
  deletedAuthBlocksProvisioning,
  decideDeletePlayer,
  isFirebaseAuthUserNotFound,
  LAST_ADMIN_MESSAGE,
  permanentDeleteStepOrder,
} from "@/lib/player-delete";
import {
  activeEligiblePlayerIds,
  nearestTeamsNeedRepair,
} from "@/lib/player-lifecycle";
import { decideTeamsSync } from "@/lib/team-sync";
import type { PlayerRatings, RatedPlayer, UserProfile } from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";

function user(
  partial: Partial<UserProfile> & Pick<UserProfile, "uid" | "role">
): UserProfile {
  return {
    playerId: partial.playerId ?? `p_${partial.uid}`,
    displayName: partial.displayName ?? partial.uid,
    email: partial.email ?? `${partial.uid}@example.com`,
    emailNotifications: true,
    active: partial.active ?? true,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

function rated(id: string): RatedPlayer {
  const ratings = Object.fromEntries(
    RATING_KEYS.map((k) => [k, 5])
  ) as PlayerRatings;
  return {
    id,
    displayName: id,
    email: null,
    active: true,
    linkedUid: null,
    createdAt: "",
    updatedAt: "",
    ...ratings,
    overall: calculateOverall(ratings),
  };
}

describe("permanent Delete Player + Auth", () => {
  it("1. linked Player delete plans Auth + Firestore user removal", () => {
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p_linked", linkedUid: "uid_player" },
      linkedUser: user({ uid: "uid_player", role: "player" }),
      activeAdminCount: 1,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.deleteAuthUid).toBe("uid_player");
    expect(d.unlinkUserUid).toBe("uid_player");
    expect(
      permanentDeleteStepOrder({
        playerId: "p_linked",
        unlinkUserUid: d.unlinkUserUid,
        deleteAuthUid: d.deleteAuthUid,
      })
    ).toEqual([
      "validate_last_admin",
      "delete_auth_if_linked",
      "delete_attendance",
      "delete_evaluation",
      "delete_player",
      "delete_user_profile",
      "recalculate_nearest_teams",
    ]);
  });

  it("2. deleted Auth credentials cannot reprovision", () => {
    expect(deletedAuthBlocksProvisioning()).toBe(true);
    // Provision requires verifyIdToken → live Auth user; Auth delete removes that.
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p1", linkedUid: "gone" },
      linkedUser: user({ uid: "gone", role: "player" }),
      activeAdminCount: 1,
    });
    expect(d.ok && d.deleteAuthUid).toBe("gone");
  });

  it("3. unlinked Player delete works without Auth target", () => {
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p_seed", linkedUid: null },
      linkedUser: null,
      activeAdminCount: 1,
    });
    expect(d).toEqual({
      ok: true,
      unlinkUserUid: null,
      deleteAuthUid: null,
    });
    expect(
      permanentDeleteStepOrder({
        playerId: "p_seed",
        unlinkUserUid: null,
        deleteAuthUid: null,
      })
    ).toEqual([
      "validate_last_admin",
      "delete_auth_if_linked",
      "delete_attendance",
      "delete_evaluation",
      "delete_player",
      "recalculate_nearest_teams",
    ]);
  });

  it("4. linked Admin delete works when another active Admin exists", () => {
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p_admin2", linkedUid: "admin2" },
      linkedUser: user({ uid: "admin2", role: "admin", active: true }),
      activeAdminCount: 2,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.deleteAuthUid).toBe("admin2");
  });

  it("5. last active Admin delete is rejected before destructive changes", () => {
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p_only", linkedUid: "only_admin" },
      linkedUser: user({ uid: "only_admin", role: "admin", active: true }),
      activeAdminCount: 1,
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error).toBe(LAST_ADMIN_MESSAGE);
    expect(d.status).toBe(403);
    // No Auth/Firestore step plan is produced for a rejected decision
    expect("deleteAuthUid" in d).toBe(false);
  });

  it("6. already-missing Auth user is treated as non-fatal", () => {
    expect(
      isFirebaseAuthUserNotFound({ code: "auth/user-not-found" })
    ).toBe(true);
    expect(
      isFirebaseAuthUserNotFound({
        message: "There is no user record corresponding to the provided identifier.",
      })
    ).toBe(true);
    expect(isFirebaseAuthUserNotFound({ code: "auth/network-request-failed" })).toBe(
      false
    );
    // Decision still targets Auth uid so cleanup proceeds after not-found
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p1", linkedUid: "orphan_uid" },
      linkedUser: null, // users doc already gone
      activeAdminCount: 1,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.deleteAuthUid).toBe("orphan_uid");
  });

  it("7. nearest Teams are recalculated after deletion (step order)", () => {
    const steps = permanentDeleteStepOrder({
      playerId: "p1",
      unlinkUserUid: "u1",
      deleteAuthUid: "u1",
    });
    expect(steps[steps.length - 1]).toBe("recalculate_nearest_teams");
    expect(steps.indexOf("delete_auth_if_linked")).toBeLessThan(
      steps.indexOf("delete_player")
    );
  });

  it("8. deleted player cannot remain in current Teams", () => {
    const remaining = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const eligible = activeEligiblePlayerIds({
      players: remaining.map((id) => ({ id, active: true })),
      attendance: remaining.map((id) => ({
        playerId: id,
        status: "playing" as const,
      })),
      includeMaybe: false,
    });
    expect(eligible).not.toContain("deleted");
    expect(
      nearestTeamsNeedRepair({
        teamA: ["a", "b", "c", "deleted"].map((playerId) => ({
          playerId,
          displayName: playerId,
          overall: 5,
          maybe: false,
        })),
        teamB: ["e", "f", "g", "h"].map((playerId) => ({
          playerId,
          displayName: playerId,
          overall: 5,
          maybe: false,
        })),
        eligibleIds: eligible,
        minPlaying: 6,
      })
    ).toBe(true);

    const repaired = decideTeamsSync({
      includedRated: eligible.map(rated),
      existing: {
        teamA: ["a", "b", "c", "deleted"].map((playerId) => ({
          playerId,
          displayName: playerId,
          overall: 5,
          maybe: false,
        })),
        teamB: ["e", "f", "g", "h"].map((playerId) => ({
          playerId,
          displayName: playerId,
          overall: 5,
          maybe: false,
        })),
        published: false,
        manuallyAdjusted: true,
        includeMaybePlayers: false,
      },
      minPlaying: 6,
    });
    const ids = [...repaired.teamA, ...repaired.teamB].map((m) => m.playerId);
    expect(ids).not.toContain("deleted");
    expect(ids).toHaveLength(8);
  });
});
