import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applySavedManualTeams,
  createMoveGate,
  movePlayerToSide,
  rosterAfterFailedManualSave,
} from "@/lib/mobile-team-move";
import { normalizeStoredGameTeams, type GameTeams, type TeamMemberPublic } from "@/lib/types";

function member(id: string, displayName = id): TeamMemberPublic {
  return { playerId: id, displayName };
}

function ids(list: TeamMemberPublic[]): string[] {
  return list.map((m) => m.playerId);
}

function storedTeams(partial: Pick<GameTeams, "teamA" | "teamB" | "teamC">): GameTeams {
  return {
    gameId: "g1",
    teamA: partial.teamA,
    teamB: partial.teamB,
    ...(partial.teamC ? { teamC: partial.teamC } : {}),
    published: false,
    publishedAt: null,
    updatedAt: "",
    updatedBy: null,
    manuallyAdjusted: false,
    includeMaybePlayers: false,
    stale: true,
    eligibleFingerprint: "keep",
  };
}

describe("mobile arrow moves", () => {
  const black = [member("alex", "Alex R"), member("yura", "Yura O")];
  const white = [member("misha", "Misha"), member("max", "Max")];

  it("moves Black to White and White to Black without moving anyone else", () => {
    const toWhite = movePlayerToSide({
      teamA: black,
      teamB: white,
      playerId: "alex",
      to: "B",
    });
    expect(ids(toWhite.teamA)).toEqual(["yura"]);
    expect(ids(toWhite.teamB)).toEqual(["misha", "max", "alex"]);
    expect(toWhite.teamC).toEqual([]);

    const back = movePlayerToSide({
      teamA: toWhite.teamA,
      teamB: toWhite.teamB,
      playerId: "alex",
      to: "A",
    });
    expect(ids(back.teamA)).toEqual(["yura", "alex"]);
    expect(ids(back.teamB)).toEqual(["misha", "max"]);

    const toBlack = movePlayerToSide({
      teamA: black,
      teamB: white,
      playerId: "misha",
      to: "A",
    });
    expect(ids(toBlack.teamA)).toEqual(["alex", "yura", "misha"]);
    expect(ids(toBlack.teamB)).toEqual(["max"]);
  });

  it("moves between every pair of three teams without swapping another player", () => {
    const teamA = [member("a1"), member("a2")];
    const teamB = [member("b1"), member("b2")];
    const teamC = [member("c1"), member("c2")];
    const cases: Array<{
      playerId: string;
      to: "A" | "B" | "C";
      from: "A" | "B" | "C";
    }> = [
      { playerId: "a1", to: "B", from: "A" },
      { playerId: "a2", to: "C", from: "A" },
      { playerId: "b1", to: "A", from: "B" },
      { playerId: "b2", to: "C", from: "B" },
      { playerId: "c1", to: "A", from: "C" },
      { playerId: "c2", to: "B", from: "C" },
    ];

    for (const item of cases) {
      const next = movePlayerToSide({
        teamA,
        teamB,
        teamC,
        playerId: item.playerId,
        to: item.to,
      });
      const buckets = { A: next.teamA, B: next.teamB, C: next.teamC };
      expect(ids(buckets[item.to])).toContain(item.playerId);
      expect(ids(buckets[item.from])).not.toContain(item.playerId);
      expect(buckets[item.from]).toHaveLength(1);
      expect(buckets[item.to]).toHaveLength(3);
      const untouched = (["A", "B", "C"] as const).find(
        (side) => side !== item.from && side !== item.to
      )!;
      expect(ids(buckets[untouched])).toEqual(
        untouched === "A" ? ["a1", "a2"] : untouched === "B" ? ["b1", "b2"] : ["c1", "c2"]
      );
      expect([...ids(next.teamA), ...ids(next.teamB), ...ids(next.teamC)].sort()).toEqual(
        ["a1", "a2", "b1", "b2", "c1", "c2"]
      );
    }
  });
});

describe("manual move persistence", () => {
  it("reloads the moved roster after a refresh", () => {
    const moved = movePlayerToSide({
      teamA: [member("alex"), member("yura")],
      teamB: [member("misha")],
      playerId: "yura",
      to: "B",
    });
    const saved = applySavedManualTeams(
      storedTeams({
        teamA: [member("alex"), member("yura")],
        teamB: [member("misha")],
      }),
      moved
    );
    expect(saved.stale).toBe(true);
    expect(saved.eligibleFingerprint).toBe("keep");
    const reloaded = normalizeStoredGameTeams("g1", saved);
    expect(ids(reloaded.teamA)).toEqual(["alex"]);
    expect(ids(reloaded.teamB)).toEqual(["misha", "yura"]);
    expect(reloaded.teamC).toBeUndefined();
    expect(reloaded.manuallyAdjusted).toBe(true);
  });

  it("keeps the previous roster when the save fails", () => {
    const current = storedTeams({
      teamA: [member("alex"), member("yura")],
      teamB: [member("misha"), member("max")],
    });
    const proposed = movePlayerToSide({
      teamA: current.teamA,
      teamB: current.teamB,
      playerId: "alex",
      to: "B",
    });
    expect(ids(rosterAfterFailedManualSave(current, null).teamA)).toEqual([
      "alex",
      "yura",
    ]);
    const server = storedTeams({
      teamA: [member("alex"), member("yura")],
      teamB: [member("misha"), member("max")],
    });
    const restored = rosterAfterFailedManualSave(current, server);
    expect(ids(restored.teamA)).toEqual(["alex", "yura"]);
    expect(ids(restored.teamB)).toEqual(["misha", "max"]);
    expect(ids(restored.teamA)).not.toEqual(ids(proposed.teamA));
  });

  it("ignores a second move while the first save is in progress", () => {
    const gate = createMoveGate();
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
    gate.leave();
    expect(gate.tryEnter()).toBe(true);
  });
});

describe("mobile move controls stay on Admin", () => {
  const columns = readFileSync(
    "src/components/mobile/MobileTouchTeamColumns.tsx",
    "utf8"
  );
  const admin = readFileSync(
    "src/components/mobile/MobileAdminApp.tsx",
    "utf8"
  );
  const player = readFileSync(
    "src/components/mobile/MobilePlayerApp.tsx",
    "utf8"
  );
  const desktop = readFileSync("src/components/PlayerGameBoard.tsx", "utf8");
  const hook = readFileSync("src/hooks/useNearestGameSession.ts", "utf8");

  it("uses arrow buttons on Mobile Admin and drops the drag instruction", () => {
    expect(columns).toContain(">");
    expect(columns).toContain("<");
    expect(columns).toContain("Move");
    expect(columns).toContain("movePlayerToSide");
    expect(columns).not.toContain("Drag players between teams");
    expect(columns).not.toContain("onPointerDown");
    expect(columns).not.toContain("moveMemberKeepingSizeBalance");
    expect(columns).not.toContain("moveMemberAmongThreeTeams");
    expect(admin).toContain("saving={session.savingTeams}");
    expect(admin).toContain("session.persistManualTeams");
    expect(admin).not.toContain("Drag players between teams");
    expect(hook).toContain("allowUnevenSizes: true");
    expect(hook).toContain("rosterAfterFailedManualSave");
  });

  it("leaves the player mobile teams view read-only", () => {
    expect(player).not.toContain("MobileTouchTeamColumns");
    expect(player).not.toContain("m-team-move-btn");
    expect(player).not.toContain("persistManualTeams");
    expect(player).toContain("m-team-split-readonly");
  });

  it("leaves desktop drag and size-preserving moves in place", () => {
    expect(desktop).toContain("moveMemberKeepingSizeBalance");
    expect(desktop).toContain("moveMemberAmongThreeTeams");
    expect(desktop).toContain("draggable={isAdmin}");
    expect(desktop).not.toContain("movePlayerToSide");
    expect(desktop).not.toContain("allowUnevenSizes");
  });
});
