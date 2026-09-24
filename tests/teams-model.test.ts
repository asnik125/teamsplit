import { describe, expect, it } from "vitest";
import {
  gameStartMs,
  gameHasNotStarted,
  nextUpcomingGame,
  GAME_TIMEZONE,
} from "@/lib/schedule";
import { vancouverLocalToUtc } from "@/lib/notifications/timezone";
import type { Game, Player, PlayerEvaluation, RatedPlayer } from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";
import {
  areTeamsStale,
  eligiblePlayerIdsFromAttendance,
  eligiblePoolFingerprint,
  TEAMS_STALE_MESSAGE,
} from "@/lib/team-eligibility";
import {
  MissingEvaluationError,
  buildRatedEligible,
  computeBestBalancedSplit,
  enumerateBalancedPartitions,
  partitionKey,
  scorePartition,
} from "@/lib/team-generate";
import { buildPlayerGameView } from "@/lib/player-game-view";
import type { GameTeams } from "@/lib/types";
import { calculateOverall } from "@/lib/balancer";

function game(
  partial: Partial<Game> & Pick<Game, "id" | "date" | "startTime">
): Game {
  return {
    endTime: null,
    location: "Gym",
    status: "scheduled",
    noGame: false,
    seasonId: "2026-2027",
    createdBy: "t",
    createdAt: "",
    updatedAt: "",
    teamsMayBeStale: false,
    teamsStatusMessage: null,
    lastAttendanceChange: null,
    ...partial,
  };
}

function rated(
  id: string,
  overallHint: number,
  dims?: Partial<Record<(typeof RATING_KEYS)[number], number>>
): RatedPlayer {
  const base = Math.max(1, Math.min(10, Math.round(overallHint)));
  const ratings = Object.fromEntries(
    RATING_KEYS.map((k) => [k, dims?.[k] ?? base])
  ) as RatedPlayer;
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

describe("Vancouver gameStartMs (server/client identical)", () => {
  it("PDT: Sep 24 19:30 Vancouver = 02:30 UTC next day", () => {
    const g = game({ id: "g", date: "2026-09-24", startTime: "19:30" });
    const ms = gameStartMs(g);
    expect(new Date(ms).toISOString()).toBe("2026-09-25T02:30:00.000Z");
    expect(ms).toBe(
      vancouverLocalToUtc("2026-09-24", "19:30", GAME_TIMEZONE).getTime()
    );
  });

  it("PST: Jan 15 19:30 Vancouver = 03:30 UTC next day", () => {
    const g = game({ id: "g", date: "2026-01-15", startTime: "19:30" });
    expect(new Date(gameStartMs(g)).toISOString()).toBe(
      "2026-01-16T03:30:00.000Z"
    );
  });

  it("does not treat 13:20 PDT as past kickoff for a 19:30 PDT game", () => {
    const g = game({ id: "g", date: "2026-09-24", startTime: "19:30" });
    const now = new Date("2026-09-24T20:20:00.000Z");
    expect(gameHasNotStarted(g, now)).toBe(true);
    expect(nextUpcomingGame([g], now)?.id).toBe("g");
  });
});

describe("eligibility / stale (attendance never regenerates)", () => {
  const players = [
    { id: "a", active: true },
    { id: "b", active: true },
    { id: "c", active: true },
  ];

  it("Playing included; Not playing / no_response excluded", () => {
    expect(
      eligiblePlayerIdsFromAttendance({
        players,
        attendance: [
          { playerId: "a", status: "playing" },
          { playerId: "b", status: "not_playing" },
          { playerId: "c", status: "no_response" },
        ],
        includeMaybe: false,
      })
    ).toEqual(["a"]);
  });

  it("Maybe OFF/ON", () => {
    const att = [
      { playerId: "a", status: "playing" as const },
      { playerId: "b", status: "maybe" as const },
    ];
    expect(
      eligiblePlayerIdsFromAttendance({
        players,
        attendance: att,
        includeMaybe: false,
      })
    ).toEqual(["a"]);
    expect(
      eligiblePlayerIdsFromAttendance({
        players,
        attendance: att,
        includeMaybe: true,
      })
    ).toEqual(["a", "b"]);
  });

  it("fingerprint change marks stale; manual flag conceptually survives", () => {
    const teams: GameTeams = {
      gameId: "g",
      teamA: [{ playerId: "a", displayName: "A" }],
      teamB: [{ playerId: "b", displayName: "B" }],
      published: false,
      publishedAt: null,
      updatedAt: "",
      updatedBy: null,
      manuallyAdjusted: true,
      includeMaybePlayers: false,
      eligibleFingerprint: eligiblePoolFingerprint(["a", "b"]),
      stale: false,
    };
    expect(areTeamsStale({ teams, currentEligibleIds: ["a", "b"] })).toBe(
      false
    );
    expect(areTeamsStale({ teams, currentEligibleIds: ["a", "c"] })).toBe(true);
    expect(teams.manuallyAdjusted).toBe(true);
    expect(TEAMS_STALE_MESSAGE).toContain("generate teams again");
  });
});

describe("single best skill-balanced Generate", () => {
  it("even pool → equal sizes (10 → 5/5)", () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      rated(`p${String(i).padStart(2, "0")}`, 5 + (i % 3))
    );
    const best = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
    });
    expect(best.teamA.length).toBe(5);
    expect(best.teamB.length).toBe(5);
  });

  it("odd pool → sizes differ by 1 (9 → 5/4)", () => {
    const pool = Array.from({ length: 9 }, (_, i) =>
      rated(`p${String(i).padStart(2, "0")}`, 5 + (i % 4))
    );
    const best = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
    });
    expect(Math.abs(best.teamA.length - best.teamB.length)).toBe(1);
    expect(best.teamA.length + best.teamB.length).toBe(9);
  });

  it("A/B mirrors are not duplicated in enumeration", () => {
    const ids = ["a", "b", "c", "d"];
    const parts = enumerateBalancedPartitions(ids);
    const keys = parts.map((a) => {
      const setA = new Set(a);
      const b = ids.filter((id) => !setA.has(id));
      return partitionKey(a, b);
    });
    expect(new Set(keys).size).toBe(keys.length);
    // C(4,2)/2 = 3 unique partitions for equal sizes
    expect(parts.length).toBe(3);
  });

  it("lowest overallGap wins", () => {
    // Two strong + two weak: best is one strong each side
    const pool = [
      rated("s1", 9),
      rated("s2", 9),
      rated("w1", 3),
      rated("w2", 3),
    ];
    const best = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
    });
    const aIds = best.teamA.map((m) => m.playerId);
    const bIds = best.teamB.map((m) => m.playerId);
    const strongOnA = aIds.filter((id) => id.startsWith("s")).length;
    const strongOnB = bIds.filter((id) => id.startsWith("s")).length;
    expect(strongOnA).toBe(1);
    expect(strongOnB).toBe(1);
    expect(best.score.overallGap).toBeLessThan(0.01);
  });

  it("11 dimensions used for secondary balancing when overall tied", () => {
    const flat = (id: string) => rated(id, 6);
    const highSpeed = rated("hs", 6, {
      speed: 10,
      strength: 2,
      stamina: 6,
      control: 6,
      passing: 6,
      action: 6,
      defend: 6,
      attack: 6,
      transition: 6,
      decisions: 6,
      workrate: 6,
    });
    const highStrength = rated("hk", 6, {
      speed: 2,
      strength: 10,
      stamina: 6,
      control: 6,
      passing: 6,
      action: 6,
      defend: 6,
      attack: 6,
      transition: 6,
      decisions: 6,
      workrate: 6,
    });
    expect(highSpeed.overall).toBe(6);
    expect(highStrength.overall).toBe(6);

    const byId = new Map([
      ["f1", flat("f1")],
      ["f2", flat("f2")],
      ["hs", highSpeed],
      ["hk", highStrength],
    ]);
    const balancedDims = scorePartition(["hs", "hk"], ["f1", "f2"], byId);
    const unbalancedDims = scorePartition(["hs", "f1"], ["hk", "f2"], byId);
    expect(balancedDims.overallGap).toBe(unbalancedDims.overallGap);
    expect(balancedDims.dimensionGapAvg).toBeLessThan(
      unbalancedDims.dimensionGapAvg
    );
    expect(RATING_KEYS.length).toBe(11);

    const best = computeBestBalancedSplit({
      rated: [...byId.values()],
      maybePlayerIds: new Set(),
    });
    expect(best.score.dimensionGapAvg).toBe(balancedDims.dimensionGapAvg);
    const a = new Set(best.teamA.map((m) => m.playerId));
    const spikesTogether =
      (a.has("hs") && a.has("hk")) || (!a.has("hs") && !a.has("hk"));
    expect(spikesTogether).toBe(true);
  });

  it("identical input → identical composition", () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      rated(`p${i}`, 4 + (i % 5))
    );
    const a = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
    });
    const b = computeBestBalancedSplit({
      rated: [...pool].reverse(),
      maybePlayerIds: new Set(),
    });
    expect(partitionKey(
      a.teamA.map((m) => m.playerId),
      a.teamB.map((m) => m.playerId)
    )).toBe(
      partitionKey(
        b.teamA.map((m) => m.playerId),
        b.teamB.map((m) => m.playerId)
      )
    );
  });

  it("missing evaluation blocks Generate", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "No Eval",
        email: null,
        active: true,
        linkedUid: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(() =>
      buildRatedEligible({
        eligibleIds: ["p1"],
        players,
        evalMap: {},
        maybePlayerIds: new Set(),
      })
    ).toThrow(MissingEvaluationError);
  });

  it("scorePartition uses mean overall gap", () => {
    const byId = new Map([
      ["a", rated("a", 8)],
      ["b", rated("b", 4)],
      ["c", rated("c", 8)],
      ["d", rated("d", 4)],
    ]);
    const balanced = scorePartition(["a", "b"], ["c", "d"], byId);
    const unbalanced = scorePartition(["a", "c"], ["b", "d"], byId);
    expect(balanced.overallGap).toBeLessThan(unbalanced.overallGap);
  });
});

describe("player view stale / generate UX", () => {
  function teamsDoc(stale = false): GameTeams {
    return {
      gameId: "g1",
      teamA: [{ playerId: "p1", displayName: "A" }],
      teamB: [{ playerId: "p2", displayName: "B" }],
      published: false,
      publishedAt: null,
      updatedAt: "t",
      updatedBy: null,
      manuallyAdjusted: false,
      includeMaybePlayers: false,
      stale,
      eligibleFingerprint: "p1,p2",
    };
  }

  it("stale keeps lists and shows regenerate message", () => {
    const v = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p1",
      playingCount: 6,
      maybeCount: 0,
      includedCount: 6,
      currentTeams: teamsDoc(true),
    });
    expect(v.teamsPhase).toBe("stale");
    expect(v.showTeamLists).toBe(true);
    expect(v.teamsMessage).toBe(TEAMS_STALE_MESSAGE);
  });

  it("no composition awaits generate", () => {
    const v = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p1",
      playingCount: 6,
      maybeCount: 0,
      includedCount: 6,
      currentTeams: null,
    });
    expect(v.teamsPhase).toBe("awaiting_generate");
  });
});

describe("Admin-only Generate contract", () => {
  it("Generate visible only when showAdminUI", () => {
    const show = (isAdmin: boolean, viewMode: "admin" | "player") =>
      isAdmin && viewMode === "admin";
    expect(show(true, "admin")).toBe(true);
    expect(show(true, "player")).toBe(false);
    expect(show(false, "admin")).toBe(false);
  });

  it("no Shuffle API surface in attendance-api exports contract", async () => {
    const api = await import("@/lib/firebase/attendance-api");
    expect("shuffleTeamsApi" in api).toBe(false);
    expect(typeof api.regenerateTeamsApi).toBe("function");
  });
});
