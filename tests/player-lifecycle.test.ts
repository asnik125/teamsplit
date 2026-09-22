import { describe, expect, it } from "vitest";
import { calculateOverall } from "@/lib/balancer";
import {
  activeEligiblePlayerIds,
  gamesRequiringAttendanceResetOnReactivate,
  nearestTeamsIntegrity,
  nearestTeamsNeedRepair,
} from "@/lib/player-lifecycle";
import { decideTeamsSync, isIncludedForTeams } from "@/lib/team-sync";
import type {
  AttendanceStatus,
  Game,
  PlayerRatings,
  RatedPlayer,
  TeamMemberPublic,
} from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";

function rated(id: string, overallHint = 60, active = true): RatedPlayer {
  const ratings = Object.fromEntries(
    RATING_KEYS.map((k) => [k, Math.max(1, Math.round(overallHint / 10))])
  ) as PlayerRatings;
  return {
    id,
    displayName: id,
    email: null,
    active,
    linkedUid: null,
    createdAt: "",
    updatedAt: "",
    ...ratings,
    overall: calculateOverall(ratings),
  };
}

function pool(n: number): RatedPlayer[] {
  return Array.from({ length: n }, (_, i) => rated(`p${i + 1}`, 50 + i));
}

function member(playerId: string): TeamMemberPublic {
  return { playerId, displayName: playerId, overall: 5, maybe: false };
}

function game(
  id: string,
  date: string,
  opts?: Partial<Game>
): Game {
  return {
    id,
    date,
    startTime: "19:30",
    endTime: null,
    location: "Gym",
    status: "scheduled",
    noGame: false,
    seasonId: "2026-2027",
    createdBy: "admin",
    createdAt: "",
    updatedAt: "",
    teamsMayBeStale: false,
    teamsStatusMessage: null,
    lastAttendanceChange: null,
    ...opts,
  };
}

describe("player lifecycle / team integrity", () => {
  it("1. register → — attendance is not eligible for teams", () => {
    const eligible = activeEligiblePlayerIds({
      players: [{ id: "new", active: true }],
      attendance: [{ playerId: "new", status: "no_response" }],
      includeMaybe: false,
    });
    expect(eligible).toEqual([]);
  });

  it("2. new player Playing → appears exactly once in teams", () => {
    const included = pool(6);
    const d = decideTeamsSync({
      includedRated: included,
      existing: null,
      minPlaying: 6,
      includeMaybePlayers: false,
    });
    const ids = [...d.teamA, ...d.teamB].map((m) => m.playerId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("3. inactive player excluded from eligible even with playing attendance", () => {
    const eligible = activeEligiblePlayerIds({
      players: [
        { id: "a", active: true },
        { id: "ghost", active: false },
      ],
      attendance: [
        { playerId: "a", status: "playing" },
        { playerId: "ghost", status: "playing" },
      ],
      includeMaybe: false,
    });
    expect(eligible).toEqual(["a"]);
  });

  it("4. inactive + stale playing cannot enter teams", () => {
    const eligible = activeEligiblePlayerIds({
      players: [{ id: "noname", active: false }],
      attendance: [{ playerId: "noname", status: "playing" }],
      includeMaybe: true,
    });
    expect(eligible).toEqual([]);
    expect(
      nearestTeamsNeedRepair({
        teamA: [member("noname")],
        teamB: [],
        eligibleIds: eligible,
        minPlaying: 6,
      })
    ).toBe(true);
  });

  it("5. reactivation attendance reset targets upcoming playable games only", () => {
    const now = new Date("2026-09-22T12:00:00");
    const games = [
      game("past", "2026-09-10"),
      game("nearest", "2026-09-24"),
      game("future", "2026-10-01"),
      game("nogame", "2026-10-08", { noGame: true }),
    ];
    const reset = gamesRequiringAttendanceResetOnReactivate(games, now);
    expect(reset.map((g) => g.id).sort()).toEqual(["future", "nearest"]);
  });

  it("5b. after attendance reset to —, reactivated player not eligible", () => {
    const eligible = activeEligiblePlayerIds({
      players: [{ id: "reactivated", active: true }],
      attendance: [], // cleared → —
      includeMaybe: false,
    });
    expect(eligible).toEqual([]);
  });

  it("6. deleted player missing from players → not eligible; stored teams need repair", () => {
    const eligible = activeEligiblePlayerIds({
      players: [{ id: "still_here", active: true }],
      attendance: [
        { playerId: "still_here", status: "playing" },
        { playerId: "deleted", status: "playing" },
      ],
      includeMaybe: false,
    });
    expect(eligible).toEqual(["still_here"]);
    expect(
      nearestTeamsIntegrity({
        teamA: [member("still_here"), member("deleted")],
        teamB: pool(4).map((p) => member(p.id)),
        eligibleIds: eligible,
        minPlaying: 6,
      }).ok
    ).toBe(false);
  });

  it("7. delete causes 6 → 5 eligible → teams must clear", () => {
    expect(
      nearestTeamsNeedRepair({
        teamA: pool(3).map((p) => member(p.id)),
        teamB: pool(3).map((p) => member(`x${p.id}`)),
        eligibleIds: ["p1", "p2", "p3", "p4", "p5"],
        minPlaying: 6,
      })
    ).toBe(true);
    const d = decideTeamsSync({
      includedRated: pool(5),
      existing: {
        teamA: pool(3).map((p) => member(p.id)),
        teamB: pool(3).map((p) => member(`b${p.id}`)),
        published: false,
        manuallyAdjusted: true,
        includeMaybePlayers: false,
      },
      minPlaying: 6,
    });
    expect(d.clearTeams).toBe(true);
    expect(d.action).toBe("insufficient");
  });

  it("8-9. 9 → 8 eligible regenerates without ghost", () => {
    const included = pool(8);
    const d = decideTeamsSync({
      includedRated: included,
      existing: {
        teamA: [...pool(5), rated("ghost")].map((p) => member(p.id)),
        teamB: pool(4).map((p) => member(p.id)),
        published: false,
        manuallyAdjusted: true,
        includeMaybePlayers: false,
      },
      minPlaying: 6,
      includeMaybePlayers: false,
    });
    expect(d.writeTeams).toBe(true);
    const ids = [...d.teamA, ...d.teamB].map((m) => m.playerId);
    expect(ids).toHaveLength(8);
    expect(ids).not.toContain("ghost");
    expect(d.manuallyAdjusted).toBe(false);
  });

  it("10. Playing → Not playing removes from eligible", () => {
    expect(isIncludedForTeams("not_playing", false)).toBe(false);
    const eligible = activeEligiblePlayerIds({
      players: [{ id: "a", active: true }],
      attendance: [{ playerId: "a", status: "not_playing" }],
      includeMaybe: false,
    });
    expect(eligible).toEqual([]);
  });

  it("11. Playing → — removes from eligible", () => {
    const eligible = activeEligiblePlayerIds({
      players: [{ id: "a", active: true }],
      attendance: [{ playerId: "a", status: "no_response" }],
      includeMaybe: false,
    });
    expect(eligible).toEqual([]);
  });

  it("12. Maybe with Include Maybe OFF excluded", () => {
    expect(isIncludedForTeams("maybe", false)).toBe(false);
  });

  it("13. Maybe with Include Maybe ON included", () => {
    expect(isIncludedForTeams("maybe", true)).toBe(true);
    const eligible = activeEligiblePlayerIds({
      players: [{ id: "m", active: true }],
      attendance: [{ playerId: "m", status: "maybe" }],
      includeMaybe: true,
    });
    expect(eligible).toEqual(["m"]);
  });

  it("14. Include Maybe ON → OFF removes Maybe members", () => {
    const withMaybe = activeEligiblePlayerIds({
      players: [
        { id: "p", active: true },
        { id: "m", active: true },
      ],
      attendance: [
        { playerId: "p", status: "playing" },
        { playerId: "m", status: "maybe" },
      ],
      includeMaybe: true,
    });
    const without = activeEligiblePlayerIds({
      players: [
        { id: "p", active: true },
        { id: "m", active: true },
      ],
      attendance: [
        { playerId: "p", status: "playing" },
        { playerId: "m", status: "maybe" },
      ],
      includeMaybe: false,
    });
    expect(withMaybe).toEqual(["p", "m"]);
    expect(without).toEqual(["p"]);
  });

  it("15-16. manual teams + deactivate/delete → integrity fails until repair", () => {
    // Stored manual roster still has deactivated player "b"
    const eligible = activeEligiblePlayerIds({
      players: [
        { id: "a", active: true },
        { id: "b", active: false },
        { id: "c", active: true },
        { id: "d", active: true },
        { id: "e", active: true },
        { id: "f", active: true },
        { id: "g", active: true },
        { id: "h", active: true },
      ],
      attendance: ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({
        playerId: id,
        status: "playing" as AttendanceStatus,
      })),
      includeMaybe: false,
    });
    expect(eligible).not.toContain("b");
    expect(eligible).toHaveLength(7);
    expect(
      nearestTeamsIntegrity({
        teamA: ["a", "b", "c", "d"].map(member),
        teamB: ["e", "f", "g", "h"].map(member),
        eligibleIds: eligible,
        minPlaying: 6,
      }).ok
    ).toBe(false);

    const repaired = decideTeamsSync({
      includedRated: eligible.map((id) => rated(id)),
      existing: {
        teamA: ["a", "b", "c", "d"].map(member),
        teamB: ["e", "f", "g", "h"].map(member),
        published: false,
        manuallyAdjusted: true,
        includeMaybePlayers: false,
      },
      minPlaying: 6,
    });
    const ids = [...repaired.teamA, ...repaired.teamB].map((m) => m.playerId);
    expect(ids).not.toContain("b");
    expect(ids).toHaveLength(7);
    expect(repaired.manuallyAdjusted).toBe(false);
  });

  it("17. future attendance does not change current eligible set helper scope", () => {
    // Eligible is always computed for one gameId's attendance docs.
    const current = activeEligiblePlayerIds({
      players: [{ id: "a", active: true }],
      attendance: [{ playerId: "a", status: "playing" }],
      includeMaybe: false,
    });
    const futureOnly = activeEligiblePlayerIds({
      players: [{ id: "a", active: true }],
      attendance: [{ playerId: "a", status: "not_playing" }],
      includeMaybe: false,
    });
    expect(current).toEqual(["a"]);
    expect(futureOnly).toEqual([]);
  });

  it("18. next upcoming game cannot resurrect deleted/inactive from old docs", () => {
    const oct1Eligible = activeEligiblePlayerIds({
      players: [
        { id: "alive", active: true },
        { id: "inactive", active: false },
      ],
      attendance: [
        { playerId: "alive", status: "playing" },
        { playerId: "inactive", status: "playing" },
        { playerId: "deleted", status: "playing" },
      ],
      includeMaybe: false,
    });
    expect(oct1Eligible).toEqual(["alive"]);
  });

  it("19. no duplicate across A+B", () => {
    const result = nearestTeamsIntegrity({
      teamA: [member("a"), member("b")],
      teamB: [member("a"), member("c")],
      eligibleIds: ["a", "b", "c"],
      minPlaying: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/duplicate/);
  });

  it("20. every current team member must exist, be active, attendance-eligible", () => {
    const players = [
      { id: "a", active: true },
      { id: "b", active: true },
      { id: "c", active: true },
      { id: "d", active: true },
      { id: "e", active: true },
      { id: "f", active: true },
    ];
    const attendance: { playerId: string; status: AttendanceStatus }[] =
      players.map((p) => ({ playerId: p.id, status: "playing" }));
    const eligible = activeEligiblePlayerIds({
      players,
      attendance,
      includeMaybe: false,
    });
    expect(
      nearestTeamsIntegrity({
        teamA: ["a", "b", "c"].map(member),
        teamB: ["d", "e", "f"].map(member),
        eligibleIds: eligible,
        minPlaying: 6,
      })
    ).toEqual({ ok: true });
  });
});
