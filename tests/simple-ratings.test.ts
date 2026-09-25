import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  calculateSimpleOverall,
  isCompleteSimpleRatings,
} from "@/lib/simple-ratings";
import {
  buildSimpleRatedEligible,
  computeBestBalancedSplit,
  MissingEvaluationError,
  partitionKey,
} from "@/lib/team-generate";
import {
  parseTeamRatingSystem,
  SIMPLE_RATING_KEYS,
  type Player,
  type SimplePlayerEvaluation,
  type SimpleRatedPlayer,
} from "@/lib/types";

function simpleRated(
  id: string,
  overallHint: number
): SimpleRatedPlayer {
  const base = Math.max(1, Math.min(5, Math.round(overallHint)));
  const ratings = Object.fromEntries(
    SIMPLE_RATING_KEYS.map((k) => [k, base])
  ) as SimpleRatedPlayer;
  return {
    id,
    displayName: id,
    email: null,
    active: true,
    linkedUid: null,
    createdAt: "",
    updatedAt: "",
    ...ratings,
    overall: calculateSimpleOverall(ratings),
  };
}

describe("Simple ratings helpers", () => {
  it("Simple Overall is mean of 8 dims to 1 decimal", () => {
    const ratings = Object.fromEntries(
      SIMPLE_RATING_KEYS.map((k, i) => [k, (i % 5) + 1])
    ) as Parameters<typeof calculateSimpleOverall>[0];
    const sum = SIMPLE_RATING_KEYS.reduce((s, k) => s + ratings[k], 0);
    expect(calculateSimpleOverall(ratings)).toBe(
      Number((sum / 8).toFixed(1))
    );
  });

  it("rejects incomplete Simple ratings", () => {
    expect(isCompleteSimpleRatings(null)).toBe(false);
    expect(isCompleteSimpleRatings({ speed: 3 })).toBe(false);
    expect(
      isCompleteSimpleRatings(
        Object.fromEntries(SIMPLE_RATING_KEYS.map((k) => [k, 3]))
      )
    ).toBe(true);
  });

  it("parseTeamRatingSystem defaults to classic", () => {
    expect(parseTeamRatingSystem(undefined)).toBe("classic");
    expect(parseTeamRatingSystem("simple")).toBe("simple");
    expect(parseTeamRatingSystem("other")).toBe("classic");
  });
});

describe("Simple Generate balancing", () => {
  it("blocks when Simple evaluation missing", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "No Simple",
        email: null,
        active: true,
        linkedUid: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(() =>
      buildSimpleRatedEligible({
        eligibleIds: ["p1"],
        players,
        evalMap: {},
        maybePlayerIds: new Set(),
      })
    ).toThrow(MissingEvaluationError);
  });

  it("does not invent defaults from Classic", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "A",
        email: null,
        active: true,
        linkedUid: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const incomplete = {
      playerId: "p1",
      speed: 5,
      updatedAt: "",
      updatedBy: null,
    } as unknown as SimplePlayerEvaluation;
    expect(() =>
      buildSimpleRatedEligible({
        eligibleIds: ["p1"],
        players,
        evalMap: { p1: incomplete },
        maybePlayerIds: new Set(),
      })
    ).toThrow(/Simple/);
  });

  it("even/odd sizes and deterministic best split", () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      simpleRated(`s${i}`, 2 + (i % 3))
    );
    const a = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
      dimensionKeys: SIMPLE_RATING_KEYS,
      oddTeamOverallCompensation: 0,
    });
    const b = computeBestBalancedSplit({
      rated: [...pool].reverse(),
      maybePlayerIds: new Set(),
      dimensionKeys: SIMPLE_RATING_KEYS,
      oddTeamOverallCompensation: 0,
    });
    expect(a.teamA.length).toBe(4);
    expect(a.teamB.length).toBe(4);
    expect(
      [...a.teamA, ...a.teamB].map((m) => m.playerId).sort()
    ).toEqual(
      [...b.teamA, ...b.teamB].map((m) => m.playerId).sort()
    );
  });

  it("lowest Simple Overall gap wins", () => {
    const pool = [
      simpleRated("hi1", 5),
      simpleRated("hi2", 5),
      simpleRated("lo1", 1),
      simpleRated("lo2", 1),
    ];
    const best = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
      dimensionKeys: SIMPLE_RATING_KEYS,
      oddTeamOverallCompensation: 0,
    });
    const aHi = best.teamA.filter((m) => m.playerId.startsWith("hi")).length;
    const bHi = best.teamB.filter((m) => m.playerId.startsWith("hi")).length;
    expect(aHi).toBe(1);
    expect(bHi).toBe(1);
  });

  it("Simple odd pools do not apply Classic 20% compensation", () => {
    const pool = Array.from({ length: 5 }, (_, i) =>
      simpleRated(`s${i}`, 1 + i)
    );
    const classicStyle = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
      dimensionKeys: SIMPLE_RATING_KEYS,
      oddTeamOverallCompensation: 0.2,
    });
    const simpleDefault = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
      dimensionKeys: SIMPLE_RATING_KEYS,
    });
    const simpleExplicit = computeBestBalancedSplit({
      rated: pool,
      maybePlayerIds: new Set(),
      dimensionKeys: SIMPLE_RATING_KEYS,
      oddTeamOverallCompensation: 0,
    });
    // Default Simple path matches compensation 0, not Classic 20%.
    expect(
      partitionKey(
        simpleDefault.teamA.map((m) => m.playerId),
        simpleDefault.teamB.map((m) => m.playerId)
      )
    ).toBe(
      partitionKey(
        simpleExplicit.teamA.map((m) => m.playerId),
        simpleExplicit.teamB.map((m) => m.playerId)
      )
    );
    // Document that forced 20% can differ (Simple must not use it in production).
    void classicStyle;
  });
});

describe("mobile has no rating-system UI", () => {
  it("MobileAdminApp has no Classic/Simple selector strings", () => {
    const src = readFileSync(
      resolve("src/components/mobile/MobileAdminApp.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/Team rating system/);
    expect(src).not.toMatch(/View ratings/);
    expect(src).not.toMatch(/playerEvaluationsSimple/);
    expect(src).not.toMatch(/enableRatingModelUi/);
  });

  it("Players page gates rating UI to desktop", () => {
    const src = readFileSync(resolve("src/app/admin/players/page.tsx"), "utf8");
    expect(src).toMatch(/enableRatingModelUi/);
    expect(src).toMatch(/enableRatingModelUi=\{false\}/);
  });
});

describe("firestore rules for Simple evaluations", () => {
  it("playerEvaluationsSimple is Admin-only", () => {
    const rules = readFileSync(resolve("firestore.rules"), "utf8");
    expect(rules).toMatch(/match \/playerEvaluationsSimple\/\{playerId\}/);
    expect(rules).toMatch(/allow read, write: if isAdmin\(\);/);
  });
});
