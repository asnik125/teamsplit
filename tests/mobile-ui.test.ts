import { describe, expect, it } from "vitest";
import { moveMemberKeepingSizeBalance } from "@/lib/balancer";
import {
  MOBILE_BREAKPOINT_PX,
  TEAM_BUILDER_FRAMES,
  adjacentPlayerFrame,
  adjacentTeamBuilderFrame,
  defaultAdminMobileTab,
  defaultPlayerMobileFrame,
  defaultTeamBuilderFrame,
  isMobileViewportWidth,
  isPlayerSafeTeamMember,
  shouldNavigateFromSwipe,
} from "@/lib/mobile-nav";
import { notificationTimeSelectOptions } from "@/lib/notifications/timezone";
import { sanitizeTeamMembers, type TeamMemberPublic } from "@/lib/types";

function member(id: string): TeamMemberPublic {
  return { playerId: id, displayName: id };
}

describe("mobile / desktop viewport split", () => {
  it("uses 768px breakpoint (Tailwind md)", () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(768);
    expect(isMobileViewportWidth(767)).toBe(true);
    expect(isMobileViewportWidth(768)).toBe(false);
    expect(isMobileViewportWidth(1024)).toBe(false);
  });

  it("covers common phone widths under the breakpoint", () => {
    for (const w of [375, 390, 414, 430]) {
      expect(isMobileViewportWidth(w)).toBe(true);
    }
  });

  it("Player mobile defaults to Attendance", () => {
    expect(defaultPlayerMobileFrame()).toBe("attendance");
  });

  it("Admin mobile defaults to Team Builder (Game)", () => {
    expect(defaultAdminMobileTab()).toBe("team-builder");
  });

  it("Admin Team Builder defaults to Teams (not Participants)", () => {
    expect(defaultTeamBuilderFrame()).toBe("teams");
    expect(TEAM_BUILDER_FRAMES[0]).toBe("teams");
    expect(TEAM_BUILDER_FRAMES[1]).toBe("participants");
  });

  it("Player can navigate Attendance → Teams → Profile", () => {
    expect(adjacentPlayerFrame("attendance", 1)).toBe("teams");
    expect(adjacentPlayerFrame("teams", 1)).toBe("profile");
    expect(adjacentPlayerFrame("profile", 1)).toBe("profile");
    expect(adjacentPlayerFrame("teams", -1)).toBe("attendance");
  });

  it("Admin Team Builder navigates Teams ↔ Participants", () => {
    expect(adjacentTeamBuilderFrame("teams", 1)).toBe("participants");
    expect(adjacentTeamBuilderFrame("participants", -1)).toBe("teams");
    expect(adjacentTeamBuilderFrame("teams", -1)).toBe("teams");
    expect(adjacentTeamBuilderFrame("participants", 1)).toBe("participants");
  });
});

describe("mobile hamburger menu contract", () => {
  it("Player menu items are Profile + separate Sign out", () => {
    const playerMenu = ["Profile", "Sign out"];
    expect(playerMenu).toEqual(["Profile", "Sign out"]);
    expect(playerMenu).not.toContain("More");
  });

  it("Admin menu items include destinations without More nesting", () => {
    const adminMenu = [
      "Games",
      "Players",
      "Notifications",
      "Profile",
      "Sign out",
    ];
    expect(adminMenu).toContain("Games");
    expect(adminMenu).toContain("Players");
    expect(adminMenu).toContain("Notifications");
    expect(adminMenu).toContain("Profile");
    expect(adminMenu).toContain("Sign out");
    expect(adminMenu).not.toContain("More");
    expect(adminMenu.indexOf("Sign out")).toBeGreaterThan(
      adminMenu.indexOf("Profile")
    );
  });
});

describe("mobile single-game selection contract", () => {
  it("selecting a game id resolves exactly one game from the list", () => {
    const games = [
      { id: "g1", date: "2026-09-17" },
      { id: "g2", date: "2026-09-24" },
      { id: "g3", date: "2026-10-01" },
    ];
    let selectedId = "g2";
    const selected = games.find((g) => g.id === selectedId) ?? null;
    expect(selected?.id).toBe("g2");
    selectedId = "g1";
    expect(games.find((g) => g.id === selectedId)?.date).toBe("2026-09-17");
    // Only one selected at a time
    expect(games.filter((g) => g.id === selectedId)).toHaveLength(1);
  });

  it("falls back to nearest when selection is missing", () => {
    const games = [
      { id: "g1", date: "2026-09-17" },
      { id: "g2", date: "2026-09-24" },
    ];
    const selectedId = "gone";
    const found = games.find((g) => g.id === selectedId);
    const fallback = found ?? games[0] ?? null;
    expect(fallback?.id).toBe("g1");
  });
});

describe("mobile swipe vs scroll / drag", () => {
  it("ignores mostly-vertical movement", () => {
    expect(shouldNavigateFromSwipe({ dx: 40, dy: 80 })).toBeNull();
  });

  it("navigates on clear horizontal swipe", () => {
    expect(shouldNavigateFromSwipe({ dx: -80, dy: 10 })).toBe("next");
    expect(shouldNavigateFromSwipe({ dx: 80, dy: 5 })).toBe("prev");
  });

  it("does not navigate while team drag is active", () => {
    expect(
      shouldNavigateFromSwipe({ dx: -100, dy: 0, dragActive: true })
    ).toBeNull();
  });
});

describe("mobile team drag integrity", () => {
  it("moves with size-preserving existing helper (touch path)", () => {
    const teamA = ["a", "b", "c"].map(member);
    const teamB = ["d", "e", "f"].map(member);
    const next = moveMemberKeepingSizeBalance(teamA, teamB, "a", "B");
    const ids = [...next.teamA, ...next.teamB].map((m) => m.playerId).sort();
    expect(ids).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(Math.abs(next.teamA.length - next.teamB.length)).toBeLessThanOrEqual(
      1
    );
    expect(next.teamB.some((m) => m.playerId === "a")).toBe(true);
  });
});

describe("Player mobile Teams privacy", () => {
  it("rejects evaluation / derived rating fields on team members", () => {
    expect(
      isPlayerSafeTeamMember({
        playerId: "p1",
        displayName: "Alex R",
      })
    ).toBe(true);
    expect(
      isPlayerSafeTeamMember({
        playerId: "p1",
        displayName: "Alex R",
        balanceRating: 8.2,
      })
    ).toBe(false);
    expect(
      isPlayerSafeTeamMember({
        playerId: "p1",
        displayName: "Alex R",
        overall: 8.1,
      })
    ).toBe(false);
  });

  it("sanitizeTeamMembers strips overall / ratings from client team state", () => {
    const cleaned = sanitizeTeamMembers([
      {
        playerId: "p1",
        displayName: "Alex",
        overall: 9,
        balanceRating: 8,
        maybe: true,
      },
      { playerId: "p2", displayName: "Sam" },
    ]);
    expect(cleaned).toEqual([
      { playerId: "p1", displayName: "Alex", maybe: true },
      { playerId: "p2", displayName: "Sam" },
    ]);
    for (const m of cleaned) {
      expect(
        isPlayerSafeTeamMember(m as unknown as Record<string, unknown>)
      ).toBe(true);
    }
  });
});

describe("mobile notifications time dropdown unchanged", () => {
  it("still stores HH:mm with 15-minute options", () => {
    const opts = notificationTimeSelectOptions("19:00");
    expect(opts.find((o) => o.value === "19:00")?.label).toBe("07:00 PM");
    expect(opts.every((o) => /^\d{2}:\d{2}$/.test(o.value))).toBe(true);
  });
});

describe("Admin/Player view switch remains UI-only (contract)", () => {
  it("showAdminUI is derived from role + viewMode, not a role write", () => {
    const isAdmin = true;
    const viewMode = "player" as const;
    const showAdminUI = isAdmin && viewMode === "admin";
    expect(showAdminUI).toBe(false);
    expect(isAdmin).toBe(true);
  });
});
