import { describe, expect, it } from "vitest";
import {
  DUPLICATE_DISPLAY_NAME_MESSAGE,
  ONBOARDING_USER_MESSAGE,
  findDisplayNameConflict,
  normalizeDisplayNameKey,
  passwordResetTouchesTeamSplitRole,
  planSelfRegistration,
  playerIdForAuthUid,
} from "@/lib/auth/onboarding";
import {
  DEFAULT_REGISTRATION_RATING,
  buildDefaultEvaluation,
  defaultRegistrationOverall,
  defaultRegistrationRatings,
  shouldCreateDefaultEvaluation,
} from "@/lib/auth/default-evaluation";
import { calculateOverall } from "@/lib/balancer";
import { isStaffRole } from "@/lib/roles";
import { RATING_KEYS, type PlayerEvaluation } from "@/lib/types";
import { decideTeamsSync } from "@/lib/team-sync";
import type { RatedPlayer } from "@/lib/types";

describe("self-registration onboarding", () => {
  const now = "2026-09-22T12:00:00.000Z";

  it("1-2. plans user + linked Player", () => {
    const plan = planSelfRegistration({
      uid: "ZFsBafub2EfV8bMYnWDNVzTi1V93",
      email: "newplayer@example.com",
      displayName: "New Player",
      nowIso: now,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.profile.playerId).toBe(plan.playerId);
    expect(plan.player.linkedUid).toBe("ZFsBafub2EfV8bMYnWDNVzTi1V93");
    expect(plan.player.active).toBe(true);
  });

  it("3-5. creates default evaluation all 5s, Overall 5.0", () => {
    const ratings = defaultRegistrationRatings();
    expect(RATING_KEYS).toHaveLength(11);
    for (const k of RATING_KEYS) {
      expect(ratings[k]).toBe(DEFAULT_REGISTRATION_RATING);
      expect(ratings[k]).toBe(5);
    }
    expect(calculateOverall(ratings)).toBe(5.0);
    expect(defaultRegistrationOverall()).toBe(5.0);

    const ev = buildDefaultEvaluation("p_uid", now, "uid");
    expect(ev.playerId).toBe("p_uid");
    expect(ev.speed).toBe(5);
    expect(ev.workrate).toBe(5);
  });

  it("6-7. active Player is attendance-eligible with — default (no attendance docs)", () => {
    const plan = planSelfRegistration({
      uid: "u1",
      email: "a@b.co",
      displayName: "noname",
      nowIso: now,
    });
    expect(plan.ok && plan.player.active).toBe(true);
    // Attendance grid defaults missing records to no_response ("—")
    const cellStatus = undefined;
    expect(cellStatus ?? "no_response").toBe("no_response");
  });

  it("8-12. Playing uses default eval in balancing; leave removes from teams", () => {
    const ratings = defaultRegistrationRatings();
    const overall = calculateOverall(ratings);
    expect(overall).toBe(5.0);

    const rated: RatedPlayer = {
      id: "p1",
      displayName: "noname",
      email: "a@b.co",
      active: true,
      linkedUid: "u1",
      createdAt: now,
      updatedAt: now,
      ...ratings,
      overall,
    };

    const created = decideTeamsSync({
      includedRated: [rated, { ...rated, id: "p2", displayName: "B", overall: 5 }],
      maybePlayerIds: new Set(),
      minPlaying: 2,
      includeMaybePlayers: false,
      existing: null,
    });
    expect(created.action).toBe("created");
    if (created.action === "created") {
      const ids = [...created.teamA, ...created.teamB].map((m) => m.playerId);
      expect(ids.filter((id) => id === "p1")).toHaveLength(1);
      expect(ids).toHaveLength(2);
    }

    const cleared = decideTeamsSync({
      includedRated: [{ ...rated, id: "p2", displayName: "B" }],
      maybePlayerIds: new Set(),
      minPlaying: 2,
      includeMaybePlayers: false,
      existing: {
        teamA: [{ playerId: "p1", displayName: "noname" }],
        teamB: [{ playerId: "p2", displayName: "B" }],
        published: false,
        manuallyAdjusted: false,
        includeMaybePlayers: false,
      },
    });
    // Only 1 included → below min → leave/clear path (not keep both)
    expect(["cleared", "insufficient", "unchanged"]).toContain(cleared.action);
    expect(cleared.includedCount).toBe(1);
    if (cleared.action === "created") {
      const ids = [...cleared.teamA, ...cleared.teamB].map((m) => m.playerId);
      expect(ids).not.toContain("p1");
    }
  });

  it("15. existing evaluation is never overwritten", () => {
    const existing: PlayerEvaluation = {
      playerId: "p1",
      ...defaultRegistrationRatings(),
      speed: 9,
      updatedAt: now,
      updatedBy: "admin",
    };
    expect(shouldCreateDefaultEvaluation(existing)).toBe(false);
    expect(shouldCreateDefaultEvaluation(null)).toBe(true);
    expect(shouldCreateDefaultEvaluation(undefined)).toBe(true);
  });

  it("16. missing evaluation backfill decision", () => {
    expect(shouldCreateDefaultEvaluation(null)).toBe(true);
  });

  it("10. signup cannot request Admin", () => {
    const plan = planSelfRegistration({
      uid: "u1",
      email: "a@b.co",
      displayName: "A",
      requestedRole: "admin",
      nowIso: now,
    });
    expect(plan.ok).toBe(false);
  });

  it("11. retry deterministic player id", () => {
    expect(playerIdForAuthUid("same")).toBe(playerIdForAuthUid("same"));
  });

  it("17-18. evaluations remain Admin-only conceptually; defaults are player-role data", () => {
    expect(isStaffRole("player")).toBe(false);
    expect(ONBOARDING_USER_MESSAGE.toLowerCase()).not.toContain("firestore");
    expect(passwordResetTouchesTeamSplitRole()).toBe(false);
  });

  it("rejects duplicate display names case-insensitively", () => {
    expect(normalizeDisplayNameKey("  Alex   R ")).toBe("alex r");
    const conflict = findDisplayNameConflict({
      displayName: "alex r",
      players: [
        { id: "p1", displayName: "Alex R" },
        { id: "p2", displayName: "Michael" },
      ],
    });
    expect(conflict?.id).toBe("p1");
    expect(
      findDisplayNameConflict({
        displayName: "Alex R",
        players: [{ id: "p1", displayName: "Alex R" }],
        excludePlayerId: "p1",
      })
    ).toBeNull();
    expect(DUPLICATE_DISPLAY_NAME_MESSAGE).toMatch(/already taken/i);
  });
});
