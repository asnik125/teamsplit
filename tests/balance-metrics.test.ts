import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ADMIN_PLAYERS_METRIC_COLUMNS,
  OPEN_FIELD_ADJUSTMENT_CLAMP,
  averageOpenFieldFactorForActivePlayers,
  buildAdminPlayersMetricRow,
  clampOpenFieldAdjustment,
  computeOpenFieldAdjustment,
  computePlayerBalanceMetrics,
  computePlayerBalanceMetricsFromEvaluation,
  formatOneDecimal,
  formatSignedOneDecimal,
  openFieldFactorFromRatings,
  playerViewMaySeeBalanceMetrics,
  publicTeamMemberExposesPrivateRatings,
  ratingsFromEvaluation,
} from "@/lib/balance-metrics";
import { toPublicMembers } from "@/lib/balancer";
import type { Player, PlayerEvaluation, PlayerRatings } from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";

function ratings(partial: Partial<PlayerRatings> & PlayerRatings): PlayerRatings {
  return partial;
}

function fromTuple(
  values: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
): PlayerRatings {
  return Object.fromEntries(
    RATING_KEYS.map((k, i) => [k, values[i]!])
  ) as PlayerRatings;
}

function loadSeed(): Array<Record<string, string | number>> {
  return JSON.parse(
    readFileSync(resolve("soccer_players_backup.json"), "utf8")
  ) as Array<Record<string, string | number>>;
}

function seedAsPlayersAndEvals(activeNames?: Set<string>) {
  const seed = loadSeed();
  const players: Player[] = seed.map((p) => ({
    id: String(p.id),
    displayName: String(p.name),
    email: null,
    active: activeNames ? activeNames.has(String(p.name)) : true,
    linkedUid: null,
    createdAt: "",
    updatedAt: "",
  }));
  const evals: Record<string, PlayerEvaluation> = {};
  for (const p of seed) {
    const id = String(p.id);
    evals[id] = {
      playerId: id,
      updatedAt: "",
      updatedBy: null,
      ...fromTuple([
        Number(p.speed),
        Number(p.strength),
        Number(p.stamina),
        Number(p.control),
        Number(p.passing),
        Number(p.action),
        Number(p.defend),
        Number(p.attack),
        Number(p.transition),
        Number(p.decisions),
        Number(p.workrate),
      ]),
    };
  }
  return { players, evals, seed };
}

describe("balance metrics formulas", () => {
  const alex = fromTuple([8, 7, 7, 9, 8, 8, 8, 9, 8, 9, 8]);
  const michael = fromTuple([8, 7, 8, 5, 5, 7, 7, 5, 6, 5, 8]);
  const yura = fromTuple([5, 5, 6, 8, 8, 8, 8, 8, 8, 8, 7]);
  const igor = fromTuple([7, 7, 7, 4, 4, 4, 8, 4, 5, 4, 7]);

  it("Physical = (Speed + Strength + Stamina) / 3", () => {
    expect(computePlayerBalanceMetrics(alex, 7).physical).toBeCloseTo(
      (8 + 7 + 7) / 3,
      10
    );
  });

  it("Football excludes Attack and Defend", () => {
    expect(computePlayerBalanceMetrics(alex, 7).football).toBeCloseTo(
      (9 + 8 + 8 + 8 + 9 + 8) / 6,
      10
    );
  });

  it("Role = (Attack + Defend) / 2", () => {
    expect(computePlayerBalanceMetrics(alex, 7).role).toBeCloseTo(
      (9 + 8) / 2,
      10
    );
  });

  it("Balance Rating = Football×0.5 + Role×0.3 + Physical×0.2", () => {
    const m = computePlayerBalanceMetrics(alex, 7);
    expect(m.balanceRating).toBeCloseTo(
      m.football * 0.5 + m.role * 0.3 + m.physical * 0.2,
      10
    );
  });

  it("Indoor = Balance Rating", () => {
    const m = computePlayerBalanceMetrics(michael, 7);
    expect(m.indoorRating).toBe(m.balanceRating);
  });

  it("OpenFieldFactor = (Speed + Stamina) / 2", () => {
    expect(openFieldFactorFromRatings(alex)).toBe(7.5);
  });

  it("uses full precision before display rounding", () => {
    const m = computePlayerBalanceMetrics(alex, 6.545454545454546);
    expect(m.physical).not.toBe(7.3);
    expect(m.physical).toBeCloseTo(7.3333333333, 8);
    expect(formatOneDecimal(m.physical)).toBe("7.3");
    expect(formatOneDecimal(m.balanceRating)).toBe("8.2");
  });

  it("one-decimal display rounding", () => {
    expect(formatOneDecimal(8.1833333333)).toBe("8.2");
    expect(formatOneDecimal(5.5333333333)).toBe("5.5");
    expect(formatSignedOneDecimal(0.095)).toBe("+0.1");
    expect(formatSignedOneDecimal(-0.1045)).toBe("-0.1");
    expect(formatSignedOneDecimal(0)).toBe("0.0");
  });
});

describe("Open Field population + clamps", () => {
  it("active-player population average from full seed fixture", () => {
    const { players, evals } = seedAsPlayersAndEvals();
    const avg = averageOpenFieldFactorForActivePlayers(players, evals);
    expect(avg).toBeCloseTo(6.545454545454546, 10);
  });

  it("inactive players excluded from Open Field reference", () => {
    const { players, evals } = seedAsPlayersAndEvals();
    const withInactive = players.map((p) =>
      p.displayName === "Alex R" ? { ...p, active: false } : p
    );
    const full = averageOpenFieldFactorForActivePlayers(players, evals)!;
    const withoutAlex = averageOpenFieldFactorForActivePlayers(
      withInactive,
      evals
    )!;
    expect(withoutAlex).not.toBeCloseTo(full, 8);
    // Alex OF factor 7.5 is above mean → removing him lowers the average
    expect(withoutAlex).toBeLessThan(full);
  });

  it("positive / negative / near-neutral adjustments", () => {
    expect(computeOpenFieldAdjustment(8, 6.5)).toBeCloseTo(0.15, 10);
    expect(computeOpenFieldAdjustment(5, 6.5)).toBeCloseTo(-0.15, 10);
    expect(formatSignedOneDecimal(computeOpenFieldAdjustment(7, 7))).toBe(
      "0.0"
    );
  });

  it("clamps at +0.30 and −0.30", () => {
    expect(clampOpenFieldAdjustment(1)).toBe(OPEN_FIELD_ADJUSTMENT_CLAMP);
    expect(clampOpenFieldAdjustment(-1)).toBe(-OPEN_FIELD_ADJUSTMENT_CLAMP);
    expect(computeOpenFieldAdjustment(20, 0)).toBe(0.3);
    expect(computeOpenFieldAdjustment(0, 20)).toBe(-0.3);
  });

  it("raising Speed/Stamina increases Open Field in expected direction", () => {
    const base = fromTuple([5, 5, 5, 7, 7, 7, 7, 7, 7, 7, 7]);
    const faster = ratings({ ...base, speed: 9, stamina: 9 });
    const avg = 6.5;
    const a = computePlayerBalanceMetrics(base, avg);
    const b = computePlayerBalanceMetrics(faster, avg);
    expect(b.openFieldRating).toBeGreaterThan(a.openFieldRating);
    expect(b.openFieldAdjustment).toBeGreaterThan(a.openFieldAdjustment);
  });
});

describe("known seed players (Alex R, Michael, Yura O, Igor)", () => {
  const { players, evals, seed } = seedAsPlayersAndEvals();
  const avg = averageOpenFieldFactorForActivePlayers(players, evals);

  function metricsFor(name: string) {
    const row = seed.find((p) => p.name === name)!;
    return computePlayerBalanceMetricsFromEvaluation(
      evals[String(row.id)],
      avg
    )!;
  }

  it("Alex R approximate expected values", () => {
    const m = metricsFor("Alex R");
    expect(m.overall).toBe(8.1);
    expect(formatOneDecimal(m.physical)).toBe("7.3");
    expect(formatOneDecimal(m.football)).toBe("8.3");
    expect(formatOneDecimal(m.balanceRating)).toBe("8.2");
    expect(formatOneDecimal(m.openFieldRating)).toBe("8.3");
  });

  it("Michael approximate expected values", () => {
    const m = metricsFor("Michael");
    expect(m.overall).toBe(6.5);
    expect(formatOneDecimal(m.physical)).toBe("7.7");
    expect(formatOneDecimal(m.football)).toBe("6.0");
    expect(formatOneDecimal(m.balanceRating)).toBe("6.3");
    expect(formatOneDecimal(m.openFieldRating)).toBe("6.5");
  });

  it("Yura O approximate expected values", () => {
    const m = metricsFor("Yura O");
    expect(m.overall).toBe(7.2);
    expect(formatOneDecimal(m.physical)).toBe("5.3");
    expect(formatOneDecimal(m.football)).toBe("7.8");
    expect(formatOneDecimal(m.balanceRating)).toBe("7.4");
    expect(formatOneDecimal(m.openFieldRating)).toBe("7.3");
  });

  it("Igor approximate expected values", () => {
    const m = metricsFor("Igor");
    expect(m.overall).toBe(5.5);
    expect(formatOneDecimal(m.physical)).toBe("7.0");
    expect(formatOneDecimal(m.football)).toBe("4.7");
    expect(formatOneDecimal(m.balanceRating)).toBe("5.5");
    expect(formatOneDecimal(m.openFieldRating)).toBe("5.6");
  });
});

describe("missing evaluation handling", () => {
  it("does not invent ratings when evaluation is missing", () => {
    expect(ratingsFromEvaluation(null)).toBeNull();
    expect(ratingsFromEvaluation(undefined)).toBeNull();
    expect(computePlayerBalanceMetricsFromEvaluation(null, 7)).toBeNull();
  });

  it("rejects incomplete evaluations instead of fabricating 6s", () => {
    const incomplete = {
      playerId: "x",
      updatedAt: "",
      updatedBy: null,
      speed: 8,
    } as unknown as PlayerEvaluation;
    expect(ratingsFromEvaluation(incomplete)).toBeNull();
  });
});

describe("Admin UI metric presentation helpers", () => {
  it("Players table exposes required columns", () => {
    expect([...ADMIN_PLAYERS_METRIC_COLUMNS]).toEqual([
      "Player",
      "Overall",
      "Balance",
      "Indoor",
      "Open Field",
    ]);
  });

  it("builds display rows for Admin Players / detail", () => {
    const m = computePlayerBalanceMetrics(
      fromTuple([8, 7, 7, 9, 8, 8, 8, 9, 8, 9, 8]),
      6.545454545454546
    );
    const row = buildAdminPlayersMetricRow({
      displayName: "Alex R",
      active: true,
      metrics: m,
    });
    expect(row.overall).toBe("8.1");
    expect(row.balance).toBe("8.2");
    expect(row.indoor).toBe("8.2");
    expect(row.openField).toBe("8.3");
  });

  it("detail Environment shows signed Open Field adjustment", () => {
    const m = computePlayerBalanceMetrics(
      fromTuple([8, 7, 7, 9, 8, 8, 8, 9, 8, 9, 8]),
      6.545454545454546
    );
    expect(formatSignedOneDecimal(m.openFieldAdjustment)).toBe("+0.1");
    const low = computePlayerBalanceMetrics(
      fromTuple([5, 5, 6, 8, 8, 8, 8, 8, 8, 8, 7]),
      6.545454545454546
    );
    expect(formatSignedOneDecimal(low.openFieldAdjustment)).toBe("-0.1");
  });

  it("missing metrics render as em dash (not editable defaults)", () => {
    const row = buildAdminPlayersMetricRow({
      displayName: "New",
      active: true,
      metrics: null,
    });
    expect(row.balance).toBe("—");
    expect(row.openField).toBe("—");
  });
});

describe("privacy / Player View must not see balance metrics", () => {
  it("Player View may not see balance metrics", () => {
    expect(playerViewMaySeeBalanceMetrics(false)).toBe(false);
    expect(playerViewMaySeeBalanceMetrics(true)).toBe(true);
  });

  it("public team members never include ratings/balance fields", () => {
    const pub = toPublicMembers([
      { id: "p1", displayName: "Alex R", overall: 8.1 } as {
        id: string;
        displayName: string;
        overall: number;
      },
    ]);
    expect(pub[0]).toEqual({ playerId: "p1", displayName: "Alex R" });
    expect(publicTeamMemberExposesPrivateRatings(pub[0] as Record<string, unknown>)).toBe(
      false
    );
    expect(
      publicTeamMemberExposesPrivateRatings({
        playerId: "p1",
        displayName: "Alex R",
        balanceRating: 8.2,
      })
    ).toBe(true);
  });

  it("firestore.rules keep playerEvaluations Admin-only", () => {
    const rules = readFileSync(resolve("firestore.rules"), "utf8");
    expect(rules).toMatch(
      /match \/playerEvaluations\/\{playerId\}[\s\S]*?allow read, write: if isAdmin\(\);/
    );
    expect(rules).toMatch(
      /match \/gameTeams\/\{gameId\}[\s\S]*?!\('overall' in request\.resource\.data\)/
    );
  });

  it("Player-facing Game/Profile sources do not import balance metrics", () => {
    const board = readFileSync(
      resolve("src/components/PlayerGameBoard.tsx"),
      "utf8"
    );
    const profile = readFileSync(resolve("src/app/profile/page.tsx"), "utf8");
    const home = readFileSync(resolve("src/app/page.tsx"), "utf8");
    for (const src of [board, profile, home]) {
      expect(src).not.toMatch(/balance-metrics/);
      expect(src).not.toMatch(/Balance Rating/);
      expect(src).not.toMatch(/Open Field/);
    }
  });
});

describe("Teams/snake generation unchanged by balance metrics", () => {
  it("snake draft still sorts by Overall, not Balance Rating", async () => {
    const { generateSnakeDraftTeams } = await import("@/lib/balancer");
    const players = [
      { id: "low-overall-high-balance", overall: 5, balanceRating: 9 },
      { id: "high-overall-low-balance", overall: 9, balanceRating: 5 },
      { id: "mid", overall: 7, balanceRating: 7 },
      { id: "mid2", overall: 6, balanceRating: 8 },
    ];
    const { teamA } = generateSnakeDraftTeams(players);
    expect(teamA[0]?.id).toBe("high-overall-low-balance");
  });
});
