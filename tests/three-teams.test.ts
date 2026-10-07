import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moveMemberAmongThreeTeams } from "@/lib/balancer";
import {
  buildPlayerGameView,
  visibleTeamColumns,
} from "@/lib/player-game-view";
import { areTeamsStale } from "@/lib/team-eligibility";
import {
  CLASSIC_ODD_OVERALL_COMPENSATION,
  computeBestBalancedSplit,
  computeBestBalancedThreeWay,
  createThreeTeamsControl,
  scorePartition,
  threeTeamSizes,
} from "@/lib/team-generate";
import {
  normalizeStoredGameTeams,
  RATING_KEYS,
  SIMPLE_RATING_KEYS,
  type GameTeams,
  type TeamMemberPublic,
} from "@/lib/types";

function member(id: string): TeamMemberPublic {
  return { playerId: id, displayName: id };
}

function classicRated(count: number, overalls?: number[]) {
  return Array.from({ length: count }, (_, index) => {
    const overall = overalls?.[index] ?? ((index % 5) + 1);
    const speed = index % 2 === 0 ? 1 : 5;
    const dims = Object.fromEntries(
      RATING_KEYS.map((key) => [key, key === "speed" ? speed : overall])
    );
    return {
      id: `p${String(index + 1).padStart(2, "0")}`,
      displayName: `P${index + 1}`,
      overall,
      ...dims,
    };
  });
}

function simpleRated(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const overall = index + 1;
    const dims = Object.fromEntries(
      SIMPLE_RATING_KEYS.map((key) => [key, overall])
    );
    return {
      id: `p${String(index + 1).padStart(2, "0")}`,
      displayName: `P${index + 1}`,
      overall,
      ...dims,
    };
  });
}

function idsOf(teams: { playerId: string }[][]) {
  return teams.flat().map((player) => player.playerId);
}

function assertExactRoster(
  teams: { playerId: string }[][],
  expectedIds: string[]
) {
  const assigned = idsOf(teams);
  expect(assigned.slice().sort()).toEqual(expectedIds.slice().sort());
  expect(new Set(assigned).size).toBe(assigned.length);
  expect(assigned.length).toBe(expectedIds.length);
}

describe("Create 3 teams control", () => {
  it("disables and unchecks the checkbox at 10 eligible players", () => {
    expect(
      createThreeTeamsControl({ eligibleCount: 10, checked: true })
    ).toEqual({ enabled: false, checked: false });
  });

  it("enables the checkbox at 11 eligible players and stays unchecked by default", () => {
    expect(
      createThreeTeamsControl({ eligibleCount: 11, checked: false })
    ).toEqual({ enabled: true, checked: false });
    expect(
      createThreeTeamsControl({ eligibleCount: 11, checked: true })
    ).toEqual({ enabled: true, checked: true });
  });
});

describe("three-team sizes and balance", () => {
  it.each([
    [11, [4, 4, 3]],
    [12, [4, 4, 4]],
    [13, [5, 4, 4]],
    [14, [5, 5, 4]],
    [15, [5, 5, 5]],
  ] as const)("%i players → %j", (count, sizes) => {
    expect(threeTeamSizes(count)).toEqual(sizes);
    const rated = classicRated(count);
    const best = computeBestBalancedThreeWay({
      rated,
      maybePlayerIds: new Set(),
    });
    expect([best.teamA.length, best.teamB.length, best.teamC.length]).toEqual([
      ...sizes,
    ]);
    assertExactRoster(
      [best.teamA, best.teamB, best.teamC],
      rated.map((player) => player.id)
    );
    const byOverall = new Map(rated.map((player) => [player.id, player.overall]));
    const means = [best.teamA, best.teamB, best.teamC].map((team) => {
      const total = team.reduce(
        (sum, player) => sum + (byOverall.get(player.playerId) ?? 0),
        0
      );
      return total / team.length;
    });
    const rawRange = Math.max(...means) - Math.min(...means);
    expect(best.score.overallGap).toBeCloseTo(Number(rawRange.toFixed(6)), 5);
  });

  it("balances Classic ratings across all three teams", () => {
    const rated = classicRated(12);
    const best = computeBestBalancedThreeWay({
      rated,
      maybePlayerIds: new Set(),
    });
    expect(best.teamA.length).toBe(4);
    expect(best.score.dimensionGapAvg).toBeGreaterThanOrEqual(0);
    assertExactRoster(
      [best.teamA, best.teamB, best.teamC],
      rated.map((player) => player.id)
    );
  });

  it("balances Simple ratings across all three teams", () => {
    const rated = simpleRated(12);
    const best = computeBestBalancedThreeWay({
      rated,
      maybePlayerIds: new Set(),
      dimensionKeys: SIMPLE_RATING_KEYS,
    });
    const classic = computeBestBalancedThreeWay({
      rated: classicRated(12),
      maybePlayerIds: new Set(),
      dimensionKeys: RATING_KEYS,
    });
    const signature = (split: {
      teamA: { playerId: string }[];
      teamB: { playerId: string }[];
      teamC: { playerId: string }[];
    }) =>
      [split.teamA, split.teamB, split.teamC]
        .map((team) =>
          team
            .map((player) => player.playerId)
            .sort()
            .join(",")
        )
        .sort()
        .join("|");
    expect(signature(best)).not.toBe(signature(classic));
    assertExactRoster(
      [best.teamA, best.teamB, best.teamC],
      rated.map((player) => player.id)
    );
  });

  it("keeps the existing two-team split, including Classic odd compensation", () => {
    const rated = [9, 8, 1].map((overall, index) => {
      const dims = Object.fromEntries(
        RATING_KEYS.map((key) => [key, overall])
      );
      return {
        id: `p${index}`,
        displayName: `P${index}`,
        overall,
        ...dims,
      };
    });
    const best = computeBestBalancedSplit({
      rated,
      maybePlayerIds: new Set(),
    });
    expect(Math.abs(best.teamA.length - best.teamB.length)).toBe(1);
    expect(best).not.toHaveProperty("teamC");
    const idsA = best.teamA.map((player) => player.playerId);
    const idsB = best.teamB.map((player) => player.playerId);
    const byId = new Map(
      rated.map((player) => [player.id, player as (typeof rated)[number] & Record<string, number>])
    );
    const compensated = scorePartition(
      idsA,
      idsB,
      byId,
      RATING_KEYS,
      CLASSIC_ODD_OVERALL_COMPENSATION
    );
    const raw = scorePartition(idsA, idsB, byId, RATING_KEYS, 0);
    expect(best.score.overallGap).toBe(compensated.overallGap);
    expect(best.score.overallGap).not.toBe(raw.overallGap);
    expect(CLASSIC_ODD_OVERALL_COMPENSATION).toBe(0.2);
  });
});

describe("manual moves and persistence", () => {
  it("moves players between A, B, and C without dropping or duplicating anyone", () => {
    const teamA = ["a1", "a2", "a3", "a4"].map(member);
    const teamB = ["b1", "b2", "b3", "b4"].map(member);
    const teamC = ["c1", "c2", "c3"].map(member);
    const all = idsOf([teamA, teamB, teamC]);

    const toC = moveMemberAmongThreeTeams(teamA, teamB, teamC, "a1", "C");
    expect([toC.teamA.length, toC.teamB.length, toC.teamC.length]).toEqual([
      3, 4, 4,
    ]);
    expect(toC.teamC.some((player) => player.playerId === "a1")).toBe(true);
    assertExactRoster([toC.teamA, toC.teamB, toC.teamC], all);

    const evenC = ["c1", "c2", "c3", "c4"].map(member);
    const toB = moveMemberAmongThreeTeams(teamA, teamB, evenC, "a1", "B");
    expect([toB.teamA.length, toB.teamB.length, toB.teamC.length]).toEqual([
      4, 4, 4,
    ]);
    expect(toB.teamB.some((player) => player.playerId === "a1")).toBe(true);
    expect(toB.teamA.some((player) => player.playerId.startsWith("b"))).toBe(
      true
    );
    assertExactRoster(
      [toB.teamA, toB.teamB, toB.teamC],
      idsOf([teamA, teamB, evenC])
    );

    const toA = moveMemberAmongThreeTeams(
      toB.teamA,
      toB.teamB,
      toB.teamC,
      "c1",
      "A"
    );
    expect(toA.teamA.some((player) => player.playerId === "c1")).toBe(true);
    assertExactRoster(
      [toA.teamA, toA.teamB, toA.teamC],
      idsOf([teamA, teamB, evenC])
    );
  });

  it("reloads a saved three-team roster and leaves two-team games without Team C", () => {
    const stored = normalizeStoredGameTeams("g1", {
      teamA: [member("a")],
      teamB: [member("b")],
      teamC: [member("c")],
      published: false,
      publishedAt: null,
      updatedAt: "t",
      updatedBy: null,
      manuallyAdjusted: false,
      includeMaybePlayers: false,
    });
    expect(stored.teamA.map((player) => player.playerId)).toEqual(["a"]);
    expect(stored.teamB.map((player) => player.playerId)).toEqual(["b"]);
    expect(stored.teamC?.map((player) => player.playerId)).toEqual(["c"]);

    const legacy = normalizeStoredGameTeams("g1", {
      teamA: [member("a")],
      teamB: [member("b")],
    });
    expect(legacy.teamC).toBeUndefined();
    expect(legacy.teamA).toHaveLength(1);

    const emptyThird = normalizeStoredGameTeams("g1", {
      teamA: [member("a")],
      teamB: [member("b")],
      teamC: [],
    });
    expect(emptyThird.teamC).toBeUndefined();
  });

  it("does not mark teams stale just because a third roster exists", () => {
    const teamA = [member("p1"), member("p2")];
    const teamB = [member("p3"), member("p4")];
    const teamC = [member("p5")];
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const teams = {
      gameId: "g1",
      teamA,
      teamB,
      teamC,
      published: false,
      publishedAt: null,
      updatedAt: "t",
      updatedBy: null,
      manuallyAdjusted: false,
      includeMaybePlayers: false,
      stale: false,
      eligibleFingerprint: ids.join(","),
    } satisfies GameTeams;
    expect(areTeamsStale({ teams, currentEligibleIds: ids })).toBe(false);
    expect(
      areTeamsStale({ teams, currentEligibleIds: ["p1", "p2", "p3", "p4"] })
    ).toBe(true);
  });
});

describe("player and mobile team columns", () => {
  it("renders Team Red for players and keeps two-team names on two-team games", () => {
    const base: GameTeams = {
      gameId: "g1",
      teamA: [member("p1"), member("p2"), member("p3"), member("p4")],
      teamB: [member("p5"), member("p6"), member("p7"), member("p8")],
      teamC: [member("p9"), member("p10"), member("p11")],
      published: false,
      publishedAt: null,
      updatedAt: "t",
      updatedBy: null,
      manuallyAdjusted: false,
      includeMaybePlayers: false,
      stale: false,
      eligibleFingerprint: "p1,p10,p11,p2,p3,p4,p5,p6,p7,p8,p9",
    };
    const onC = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p9",
      playingCount: 11,
      maybeCount: 0,
      includedCount: 11,
      currentTeams: base,
    });
    expect(onC.teamC.map((player) => player.playerId)).toEqual([
      "p9",
      "p10",
      "p11",
    ]);
    expect(onC.myTeamLabel).toBe("Team Red");
    expect(visibleTeamColumns(onC).map((column) => column.title)).toEqual([
      "Team Black",
      "Team White",
      "Team Red",
    ]);

    const twoTeam = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p1",
      playingCount: 4,
      maybeCount: 0,
      includedCount: 4,
      currentTeams: { ...base, teamC: undefined },
      minPlaying: 2,
    });
    expect(twoTeam.myTeamLabel).toBe("Team Black");
    expect(visibleTeamColumns(twoTeam).map((column) => column.title)).toEqual([
      "Team Black",
      "Team White",
    ]);

    const playerMobile = readFileSync(
      "src/components/mobile/MobilePlayerApp.tsx",
      "utf8"
    );
    const adminMobile = readFileSync(
      "src/components/mobile/MobileAdminApp.tsx",
      "utf8"
    );
    const desktop = readFileSync(
      "src/components/PlayerGameBoard.tsx",
      "utf8"
    );
    const teamBuilder = readFileSync(
      "src/app/admin/games/[gameId]/teams/page.tsx",
      "utf8"
    );
    expect(playerMobile).toContain("visibleTeamColumns");
    expect(playerMobile).not.toContain("Create 3 teams");
    expect(adminMobile).toContain("teamC={session.teamsView.teamC}");
    expect(adminMobile).not.toContain("Create 3 teams");
    expect(desktop).toContain("Create 3 teams");
    expect(desktop).toContain("showTeamRatingSystem");
    expect(teamBuilder).toContain('rosterTeamLabel("C")');
    expect(teamBuilder).toContain("→ Red");
    expect(teamBuilder).not.toContain("Team C");
  });
});
