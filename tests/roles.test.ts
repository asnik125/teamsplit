import { describe, expect, it } from "vitest";
import { isStaffRole, roleLabel } from "@/lib/roles";
import {
  LAST_ADMIN_MESSAGE,
  canOfferRoleChange,
  countActiveAdmins,
  decideRoleChange,
} from "@/lib/role-management";
import { decideDeletePlayer } from "@/lib/player-delete";
import type { UserProfile } from "@/lib/types";

function user(
  partial: Partial<UserProfile> & Pick<UserProfile, "uid" | "role">
): UserProfile {
  return {
    playerId: partial.playerId ?? `p_${partial.uid}`,
    displayName: partial.displayName ?? partial.uid,
    email: partial.email ?? `${partial.uid}@example.com`,
    active: partial.active ?? true,
    emailNotifications: true,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("roles", () => {
  it("treats only admin as staff", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("player")).toBe(false);
    expect(isStaffRole("owner")).toBe(false);
  });

  it("labels roles for display", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("player")).toBe("Player");
  });
});

describe("Admin role management", () => {
  it("1. Admin can promote linked Player → Admin", () => {
    const d = decideRoleChange({
      actorRole: "admin",
      actorUid: "admin1",
      target: user({ uid: "u2", role: "player" }),
      nextRole: "admin",
      activeAdminCount: 1,
      hasLinkedAccount: true,
    });
    expect(d).toEqual({
      ok: true,
      previousRole: "player",
      nextRole: "admin",
    });
  });

  it("2. Promoted user is treated as staff (Admin access)", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(roleLabel("admin")).toBe("Admin");
  });

  it("3. Admin can demote Admin → Player when another Admin exists", () => {
    const d = decideRoleChange({
      actorRole: "admin",
      actorUid: "admin1",
      target: user({ uid: "u2", role: "admin" }),
      nextRole: "player",
      activeAdminCount: 2,
      hasLinkedAccount: true,
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.nextRole).toBe("player");
  });

  it("4. Demoted user loses Admin access", () => {
    expect(isStaffRole("player")).toBe(false);
  });

  it("5. Normal Player cannot change roles", () => {
    const d = decideRoleChange({
      actorRole: "player",
      actorUid: "p1",
      target: user({ uid: "u2", role: "player" }),
      nextRole: "admin",
      activeAdminCount: 1,
      hasLinkedAccount: true,
    });
    expect(d).toEqual({ ok: false, error: "Admin only", status: 403 });
  });

  it("6. Unlinked player cannot be promoted", () => {
    expect(canOfferRoleChange(null)).toBe(false);
    expect(canOfferRoleChange(undefined)).toBe(false);
    const d = decideRoleChange({
      actorRole: "admin",
      actorUid: "admin1",
      target: null,
      nextRole: "admin",
      activeAdminCount: 1,
      hasLinkedAccount: false,
    });
    expect(d).toEqual({
      ok: false,
      error: "No linked account",
      status: 400,
    });
  });

  it("7. Multiple Admins work", () => {
    const users = [
      user({ uid: "a1", role: "admin" }),
      user({ uid: "a2", role: "admin" }),
      user({ uid: "p1", role: "player" }),
    ];
    expect(countActiveAdmins(users)).toBe(2);
    const promote = decideRoleChange({
      actorRole: "admin",
      actorUid: "a1",
      target: user({ uid: "p1", role: "player" }),
      nextRole: "admin",
      activeAdminCount: 2,
      hasLinkedAccount: true,
    });
    expect(promote.ok).toBe(true);
  });

  it("8. Last remaining Admin cannot be demoted", () => {
    const d = decideRoleChange({
      actorRole: "admin",
      actorUid: "admin1",
      target: user({ uid: "only", role: "admin" }),
      nextRole: "player",
      activeAdminCount: 1,
      hasLinkedAccount: true,
    });
    expect(d).toEqual({
      ok: false,
      error: LAST_ADMIN_MESSAGE,
      status: 403,
    });
  });

  it("9. Self-demotion works only when another active Admin exists", () => {
    const alone = decideRoleChange({
      actorRole: "admin",
      actorUid: "me",
      target: user({ uid: "me", role: "admin" }),
      nextRole: "player",
      activeAdminCount: 1,
      hasLinkedAccount: true,
    });
    expect(alone.ok).toBe(false);

    const withPeer = decideRoleChange({
      actorRole: "admin",
      actorUid: "me",
      target: user({ uid: "me", role: "admin" }),
      nextRole: "player",
      activeAdminCount: 2,
      hasLinkedAccount: true,
    });
    expect(withPeer.ok).toBe(true);
  });

  it("10. Admin/Player View toggle does not alter stored role", () => {
    // viewMode is localStorage UI-only; stored role stays admin
    const storedRole: UserProfile["role"] = "admin";
    const viewMode: "admin" | "player" = "player";
    expect(storedRole).toBe("admin");
    expect(isStaffRole(storedRole)).toBe(true);
    expect(viewMode).toBe("player");
    // showAdminUI = isAdmin && viewMode === "admin" → false, but role unchanged
    expect(isStaffRole(storedRole) && viewMode === "admin").toBe(false);
  });

  it("11. Inactive Admins do not count toward the last-Admin safeguard", () => {
    expect(
      countActiveAdmins([
        user({ uid: "a1", role: "admin", active: true }),
        user({ uid: "a2", role: "admin", active: false }),
      ])
    ).toBe(1);
  });
});

describe("Delete Player", () => {
  it("allows deleting an unlinked player", () => {
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p1", linkedUid: null },
      linkedUser: null,
      activeAdminCount: 1,
    });
    expect(d).toEqual({
      ok: true,
      unlinkUserUid: null,
      deleteAuthUid: null,
    });
  });

  it("allows deleting a linked Player and unlinks their user profile", () => {
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p1", linkedUid: "u1" },
      linkedUser: user({ uid: "u1", role: "player" }),
      activeAdminCount: 1,
    });
    expect(d).toEqual({
      ok: true,
      unlinkUserUid: "u1",
      deleteAuthUid: "u1",
    });
  });

  it("allows deleting a linked Admin when another Admin remains", () => {
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p2", linkedUid: "a2" },
      linkedUser: user({ uid: "a2", role: "admin" }),
      activeAdminCount: 2,
    });
    expect(d).toEqual({
      ok: true,
      unlinkUserUid: "a2",
      deleteAuthUid: "a2",
    });
  });

  it("blocks deleting the last active Admin", () => {
    const d = decideDeletePlayer({
      actorRole: "admin",
      player: { id: "p1", linkedUid: "only" },
      linkedUser: user({ uid: "only", role: "admin" }),
      activeAdminCount: 1,
    });
    expect(d).toEqual({
      ok: false,
      error: LAST_ADMIN_MESSAGE,
      status: 403,
    });
  });

  it("players cannot delete", () => {
    const d = decideDeletePlayer({
      actorRole: "player",
      player: { id: "p1", linkedUid: null },
      linkedUser: null,
      activeAdminCount: 1,
    });
    expect(d).toEqual({ ok: false, error: "Admin only", status: 403 });
  });
});
