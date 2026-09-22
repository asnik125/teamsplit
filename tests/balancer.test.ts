import { describe, expect, it } from "vitest";
import {
  assertNoDuplicatePlayers,
  assertValidTeamSplit,
  autoRebalanceAfterMove,
  calculateOverall,
  generateSnakeDraftTeams,
  moveMemberKeepingSizeBalance,
  movePlayerBetweenTeams,
  teamStrength,
  toPublicMembers,
} from "@/lib/balancer";
import type { RatedPlayer } from "@/lib/types";
import { readFileSync } from "fs";
import { resolve } from "path";

function rated(
  id: string,
  name: string,
  overall: number,
  overrides: Partial<RatedPlayer> = {}
): RatedPlayer {
  const base = Math.round(overall);
  return {
    id,
    displayName: name,
    email: null,
    active: true,
    linkedUid: null,
    createdAt: "",
    updatedAt: "",
    speed: base,
    strength: base,
    stamina: base,
    control: base,
    passing: base,
    action: base,
    defend: base,
    attack: base,
    transition: base,
    decisions: base,
    workrate: base,
    overall,
    ...overrides,
  };
}

describe("calculateOverall", () => {
  it("averages all 11 dimensions", () => {
    const ratings = {
      speed: 7,
      strength: 7,
      stamina: 7,
      control: 7,
      passing: 8,
      action: 6,
      defend: 6,
      attack: 8,
      transition: 7,
      decisions: 8,
      workrate: 7,
    };
    // sum = 78, 78/11 = 7.0909… → 7.1
    expect(calculateOverall(ratings)).toBe(7.1);
  });

  it("matches seed JSON players from backup file", () => {
    const raw = JSON.parse(
      readFileSync(resolve("soccer_players_backup.json"), "utf8")
    ) as Array<Record<string, number | string>>;
    const kolya = raw.find((p) => p.name === "Kolya A")!;
    expect(
      calculateOverall({
        speed: Number(kolya.speed),
        strength: Number(kolya.strength),
        stamina: Number(kolya.stamina),
        control: Number(kolya.control),
        passing: Number(kolya.passing),
        action: Number(kolya.action),
        defend: Number(kolya.defend),
        attack: Number(kolya.attack),
        transition: Number(kolya.transition),
        decisions: Number(kolya.decisions),
        workrate: Number(kolya.workrate),
      })
    ).toBe(7.1);
  });
});

describe("generateSnakeDraftTeams", () => {
  it("rejects fewer than 2 players", () => {
    expect(() => generateSnakeDraftTeams([rated("1", "A", 8)])).toThrow(
      /at least 2/i
    );
  });

  it("produces deterministic snake assignments for a known fixture", () => {
    // Sorted desc: 9,8,7,6,5,4
    // index%4: 0→A, 1→B, 2→B, 3→A, 0→A, 1→B
    const players = [
      rated("a", "A", 9),
      rated("b", "B", 8),
      rated("c", "C", 7),
      rated("d", "D", 6),
      rated("e", "E", 5),
      rated("f", "F", 4),
    ];
    const { teamA, teamB } = generateSnakeDraftTeams(players);
    expect(teamA.map((p) => p.id)).toEqual(["a", "d", "e"]);
    expect(teamB.map((p) => p.id)).toEqual(["b", "c", "f"]);
  });

  it("keeps team sizes within 1 for 6..12 players", () => {
    for (let n = 6; n <= 12; n++) {
      const players = Array.from({ length: n }, (_, i) =>
        rated(`p${i}`, `P${i}`, 90 - i)
      );
      const { teamA, teamB } = generateSnakeDraftTeams(players);
      expect(Math.abs(teamA.length - teamB.length)).toBeLessThanOrEqual(1);
      expect(teamA.length + teamB.length).toBe(n);
      const ids = [...teamA, ...teamB].map((p) => p.id).sort();
      expect(ids).toEqual(players.map((p) => p.id).sort());
    }
  });

  it("11 players → 6/5 or 5/6 with complete membership", () => {
    const players = Array.from({ length: 11 }, (_, i) =>
      rated(`p${i}`, `P${i}`, 80 - i)
    );
    const { teamA, teamB } = generateSnakeDraftTeams(players);
    expect([teamA.length, teamB.length].sort()).toEqual([5, 6]);
    assertValidTeamSplit(
      players.map((p) => p.id),
      teamA,
      teamB
    );
  });

  it("only includes provided/selected players", () => {
    const selected = [rated("1", "One", 8), rated("2", "Two", 7)];
    const { teamA, teamB } = generateSnakeDraftTeams(selected);
    const ids = [...teamA, ...teamB].map((p) => p.id).sort();
    expect(ids).toEqual(["1", "2"]);
  });
});

describe("moveMemberKeepingSizeBalance", () => {
  it("swaps when a pure move would create 4/6 from 5/5", () => {
    const teamA = [
      { playerId: "a1", displayName: "A1" },
      { playerId: "a2", displayName: "A2" },
      { playerId: "a3", displayName: "A3" },
      { playerId: "a4", displayName: "A4" },
      { playerId: "a5", displayName: "A5" },
    ];
    const teamB = [
      { playerId: "b1", displayName: "B1" },
      { playerId: "b2", displayName: "B2" },
      { playerId: "b3", displayName: "B3" },
      { playerId: "b4", displayName: "B4" },
      { playerId: "b5", displayName: "B5" },
    ];
    const next = moveMemberKeepingSizeBalance(teamA, teamB, "a1", "B");
    expect(Math.abs(next.teamA.length - next.teamB.length)).toBeLessThanOrEqual(
      1
    );
    expect(next.teamA.length + next.teamB.length).toBe(10);
    expect(next.teamB.some((m) => m.playerId === "a1")).toBe(true);
    expect(next.teamA.some((m) => m.playerId === "a1")).toBe(false);
  });

  it("allows pure move from 6→5 side when sizes stay balanced", () => {
    const teamA = [
      { playerId: "a1", displayName: "A1" },
      { playerId: "a2", displayName: "A2" },
      { playerId: "a3", displayName: "A3" },
      { playerId: "a4", displayName: "A4" },
      { playerId: "a5", displayName: "A5" },
      { playerId: "a6", displayName: "A6" },
    ];
    const teamB = [
      { playerId: "b1", displayName: "B1" },
      { playerId: "b2", displayName: "B2" },
      { playerId: "b3", displayName: "B3" },
      { playerId: "b4", displayName: "B4" },
      { playerId: "b5", displayName: "B5" },
    ];
    const next = moveMemberKeepingSizeBalance(teamA, teamB, "a1", "B");
    expect(next.teamA.length).toBe(5);
    expect(next.teamB.length).toBe(6);
  });
});

describe("manual move and rebalance", () => {
  it("moves without losing or duplicating players", () => {
    let teamA = [rated("1", "One", 9), rated("2", "Two", 6)];
    let teamB = [rated("3", "Three", 8), rated("4", "Four", 5)];
    const moved = movePlayerBetweenTeams(teamA, teamB, "1", "B");
    assertNoDuplicatePlayers(moved.teamA, moved.teamB);
    expect([...moved.teamA, ...moved.teamB].map((p) => p.id).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(moved.teamA.map((p) => p.id)).not.toContain("1");
    expect(moved.teamB.map((p) => p.id)).toContain("1");
  });

  it("auto-rebalance swaps a compensating player when it improves balance", () => {
    // Move strong player into A; expect a swap back that reduces diff
    const teamA = [rated("weak", "Weak", 5)];
    const teamB = [rated("strong", "Strong", 9), rated("mid", "Mid", 7)];
    const afterMove = movePlayerBetweenTeams(teamA, teamB, "strong", "A");
    const rebalanced = autoRebalanceAfterMove(
      afterMove.teamA,
      afterMove.teamB,
      "strong",
      "A"
    );
    assertNoDuplicatePlayers(rebalanced.teamA, rebalanced.teamB);
    const beforeDiff = Math.abs(
      teamStrength(afterMove.teamA) - teamStrength(afterMove.teamB)
    );
    const afterDiff = Math.abs(
      teamStrength(rebalanced.teamA) - teamStrength(rebalanced.teamB)
    );
    expect(afterDiff).toBeLessThanOrEqual(beforeDiff);
    expect([...rebalanced.teamA, ...rebalanced.teamB]).toHaveLength(3);
  });
});

describe("published payload safety helper", () => {
  it("toPublicMembers strips ratings", () => {
    const members = toPublicMembers([
      rated("1", "One", 9, { defend: 9, attack: 8 }),
    ]);
    expect(members).toEqual([{ playerId: "1", displayName: "One" }]);
    expect(JSON.stringify(members)).not.toMatch(/overall|defend|attack|speed/);
  });
});
