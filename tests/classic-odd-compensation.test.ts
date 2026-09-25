/**
 * Classic Generate: fixed 20% odd-team Overall compensation regressions.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { calculateOverall } from "@/lib/balancer";
import {
  CLASSIC_ODD_OVERALL_COMPENSATION,
  computeBestBalancedSplit,
  enumerateBalancedPartitions,
  partitionKey,
  scorePartition,
} from "@/lib/team-generate";
import type { PlayerRatings, RatedPlayer } from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";

function loadByName(): Map<string, RatedPlayer> {
  const csv = readFileSync(resolve("player-evaluations.csv"), "utf8")
    .trim()
    .split("\n")
    .slice(1);
  const byName = new Map<string, RatedPlayer>();
  for (const line of csv) {
    const p = line.split(",");
    const name = p[0]!;
    const ratings = {
      speed: +p[2]!,
      strength: +p[3]!,
      stamina: +p[4]!,
      control: +p[5]!,
      passing: +p[6]!,
      action: +p[7]!,
      defend: +p[8]!,
      attack: +p[9]!,
      transition: +p[10]!,
      decisions: +p[11]!,
      workrate: +p[12]!,
    } as PlayerRatings;
    byName.set(name, {
      id: p[14]!,
      displayName: name,
      email: null,
      active: true,
      linkedUid: null,
      createdAt: "",
      updatedAt: "",
      ...ratings,
      overall: calculateOverall(ratings),
    });
  }
  return byName;
}

function pool(names: string[], byName: Map<string, RatedPlayer>): RatedPlayer[] {
  return names.map((n) => {
    const p = byName.get(n);
    if (!p) throw new Error(`missing player ${n}`);
    return p;
  });
}

function sideNames(members: { displayName: string }[]): string[] {
  return members.map((m) => m.displayName).sort((a, b) => a.localeCompare(b));
}

function samePartition(
  a: string[],
  b: string[],
  ha: string[],
  hb: string[]
): boolean {
  const key = (xs: string[]) => [...xs].sort((x, y) => x.localeCompare(y)).join("|");
  const ka = key(a);
  const kb = key(b);
  return (
    (ka === key(ha) && kb === key(hb)) ||
    (ka === key(hb) && kb === key(ha))
  );
}

function splitNames(rated: RatedPlayer[]) {
  const best = computeBestBalancedSplit({
    rated,
    maybePlayerIds: new Set(),
  });
  return {
    a: sideNames(best.teamA),
    b: sideNames(best.teamB),
    best,
  };
}

describe("Classic odd-team 20% Overall compensation", () => {
  it("exports fixed 20% constant", () => {
    expect(CLASSIC_ODD_OVERALL_COMPENSATION).toBe(0.2);
  });

  it("odd scorePartition uses abs(meanSmall − meanLarge × 1.20)", () => {
    const byId = new Map<string, RatedPlayer>([
      [
        "s1",
        {
          id: "s1",
          displayName: "s1",
          email: null,
          active: true,
          linkedUid: null,
          createdAt: "",
          updatedAt: "",
          ...Object.fromEntries(RATING_KEYS.map((k) => [k, 8])),
          overall: 8,
        } as RatedPlayer,
      ],
      [
        "s2",
        {
          id: "s2",
          displayName: "s2",
          email: null,
          active: true,
          linkedUid: null,
          createdAt: "",
          updatedAt: "",
          ...Object.fromEntries(RATING_KEYS.map((k) => [k, 8])),
          overall: 8,
        } as RatedPlayer,
      ],
      [
        "w",
        {
          id: "w",
          displayName: "w",
          email: null,
          active: true,
          linkedUid: null,
          createdAt: "",
          updatedAt: "",
          ...Object.fromEntries(RATING_KEYS.map((k) => [k, 5])),
          overall: 5,
        } as RatedPlayer,
      ],
    ]);
    // sizes 1 vs 2: small mean=8, large mean=6.5 → |8 − 6.5×1.2| = |8 − 7.8| = 0.2
    const score = scorePartition(
      ["s1"],
      ["s2", "w"],
      byId,
      RATING_KEYS,
      CLASSIC_ODD_OVERALL_COMPENSATION
    );
    expect(score.overallGap).toBeCloseTo(0.2, 5);

    const uncompensated = scorePartition(
      ["s1"],
      ["s2", "w"],
      byId,
      RATING_KEYS,
      0
    );
    expect(uncompensated.overallGap).toBeCloseTo(Math.abs(8 - 6.5), 5);
  });

  it("even scorePartition ignores compensation (plain abs mean gap)", () => {
    const byId = new Map([
      ["a", { overall: 8, ...Object.fromEntries(RATING_KEYS.map((k) => [k, 8])) }],
      ["b", { overall: 4, ...Object.fromEntries(RATING_KEYS.map((k) => [k, 4])) }],
      ["c", { overall: 8, ...Object.fromEntries(RATING_KEYS.map((k) => [k, 8])) }],
      ["d", { overall: 4, ...Object.fromEntries(RATING_KEYS.map((k) => [k, 4])) }],
    ]) as Map<string, { overall: number } & Record<string, number>>;

    const withComp = scorePartition(
      ["a", "b"],
      ["c", "d"],
      byId,
      RATING_KEYS,
      CLASSIC_ODD_OVERALL_COMPENSATION
    );
    const without = scorePartition(["a", "b"], ["c", "d"], byId, RATING_KEYS, 0);
    expect(withComp.overallGap).toBe(without.overallGap);
    expect(withComp.overallGap).toBe(0);
  });

  it("odd Classic Generate uses 20% compensation by default", () => {
    const byName = loadByName();
    const rated = pool(
      ["Alexandr", "Alex R", "Boris", "Misha", "Kolya A", "Yura O", "Igor"],
      byName
    );
    const withDefault = computeBestBalancedSplit({
      rated,
      maybePlayerIds: new Set(),
    });
    const withExplicit = computeBestBalancedSplit({
      rated,
      maybePlayerIds: new Set(),
      oddTeamOverallCompensation: CLASSIC_ODD_OVERALL_COMPENSATION,
    });
    const withZero = computeBestBalancedSplit({
      rated,
      maybePlayerIds: new Set(),
      oddTeamOverallCompensation: 0,
    });
    expect(
      partitionKey(
        withDefault.teamA.map((m) => m.playerId),
        withDefault.teamB.map((m) => m.playerId)
      )
    ).toBe(
      partitionKey(
        withExplicit.teamA.map((m) => m.playerId),
        withExplicit.teamB.map((m) => m.playerId)
      )
    );
    // Uncompensated Classic differs on this reviewed odd pool (#6).
    expect(
      partitionKey(
        withDefault.teamA.map((m) => m.playerId),
        withDefault.teamB.map((m) => m.playerId)
      )
    ).not.toBe(
      partitionKey(
        withZero.teamA.map((m) => m.playerId),
        withZero.teamB.map((m) => m.playerId)
      )
    );
  });

  it("benchmark #6 matches reviewed human composition", () => {
    const byName = loadByName();
    const { a, b } = splitNames(
      pool(
        ["Alexandr", "Alex R", "Boris", "Misha", "Kolya A", "Yura O", "Igor"],
        byName
      )
    );
    expect(
      samePartition(a, b, ["Alexandr", "Alex R", "Boris"], [
        "Misha",
        "Kolya A",
        "Yura O",
        "Igor",
      ])
    ).toBe(true);
    expect(Math.abs(a.length - b.length)).toBe(1);
    expect(a.length + b.length).toBe(7);
    expect(Math.max(a.length, b.length)).toBe(Math.ceil(7 / 2));
    expect(Math.min(a.length, b.length)).toBe(Math.floor(7 / 2));
  });

  it("benchmark #10 matches reviewed human composition", () => {
    const byName = loadByName();
    const { a, b } = splitNames(
      pool(
        ["Kolya A", "Michael", "Alexandr", "Yura O", "Kolya I", "Edik", "Igor"],
        byName
      )
    );
    expect(
      samePartition(a, b, ["Kolya A", "Michael", "Alexandr"], [
        "Yura O",
        "Kolya I",
        "Edik",
        "Igor",
      ])
    ).toBe(true);
  });

  it("Classic-freeze even cases #2/#4/#5/#8/#9 remain unchanged", () => {
    const byName = loadByName();
    const freezes: { id: number; names: string[]; a: string[]; b: string[] }[] =
      [
        {
          id: 2,
          names: ["Alex R", "Alexandr", "Yura O", "Kolya A", "Boris", "Max"],
          a: ["Alex R", "Kolya A", "Max"],
          b: ["Alexandr", "Boris", "Yura O"],
        },
        {
          id: 4,
          names: [
            "Alex R",
            "Alexandr",
            "Yura O",
            "Kolya A",
            "Michael",
            "Boris",
            "Max",
            "Igor",
          ],
          a: ["Alexandr", "Boris", "Kolya A", "Max"],
          b: ["Alex R", "Igor", "Michael", "Yura O"],
        },
        {
          id: 5,
          names: [
            "Alex R",
            "Alexandr",
            "Yura O",
            "Kolya A",
            "Michael",
            "Boris",
            "Max",
            "Igor",
            "Edik",
            "Kolya I",
          ],
          a: ["Alexandr", "Boris", "Edik", "Kolya A", "Max"],
          b: ["Alex R", "Igor", "Kolya I", "Michael", "Yura O"],
        },
        {
          id: 8,
          names: [
            "Alex R",
            "Yura O",
            "Kolya A",
            "Michael",
            "Boris",
            "Max",
            "Edik",
            "Kolya I",
          ],
          a: ["Boris", "Edik", "Kolya A", "Yura O"],
          b: ["Alex R", "Kolya I", "Max", "Michael"],
        },
        {
          id: 9,
          names: ["Alexandr", "Yura O", "Kolya A", "Boris", "Max", "Igor"],
          a: ["Igor", "Kolya A", "Yura O"],
          b: ["Alexandr", "Boris", "Max"],
        },
      ];

    for (const f of freezes) {
      const { a, b, best } = splitNames(pool(f.names, byName));
      expect(samePartition(a, b, f.a, f.b), `#${f.id}`).toBe(true);
      expect(best.teamA.length).toBe(f.names.length / 2);
      expect(best.teamB.length).toBe(f.names.length / 2);
    }
  });

  it("generation remains deterministic", () => {
    const byName = loadByName();
    const rated = pool(
      ["Kolya A", "Michael", "Alexandr", "Yura O", "Kolya I", "Edik", "Igor"],
      byName
    );
    const a = computeBestBalancedSplit({
      rated,
      maybePlayerIds: new Set(),
    });
    const b = computeBestBalancedSplit({
      rated: [...rated].reverse(),
      maybePlayerIds: new Set(),
    });
    expect(
      partitionKey(
        a.teamA.map((m) => m.playerId),
        a.teamB.map((m) => m.playerId)
      )
    ).toBe(
      partitionKey(
        b.teamA.map((m) => m.playerId),
        b.teamB.map((m) => m.playerId)
      )
    );
  });

  it("odd enumeration sizes remain ceil/floor", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const parts = enumerateBalancedPartitions(ids);
    expect(parts.length).toBeGreaterThan(0);
    for (const idsA of parts) {
      const sizeA = idsA.length;
      const sizeB = ids.length - sizeA;
      expect(Math.max(sizeA, sizeB)).toBe(Math.ceil(ids.length / 2));
      expect(Math.min(sizeA, sizeB)).toBe(Math.floor(ids.length / 2));
    }
  });
});
