import { describe, expect, it } from "vitest";
import { buildPlayerGameView } from "@/lib/player-game-view";
import type { GameTeams } from "@/lib/types";

function teams(): GameTeams {
  return {
    gameId: "g1",
    teamA: [
      { playerId: "p1", displayName: "Kolya A" },
      { playerId: "p2", displayName: "B", maybe: true },
    ],
    teamB: [
      { playerId: "p3", displayName: "C" },
      { playerId: "p4", displayName: "D" },
      { playerId: "p5", displayName: "E" },
      { playerId: "p6", displayName: "F" },
    ],
    published: false,
    publishedAt: null,
    updatedAt: "t",
    updatedBy: null,
    manuallyAdjusted: false,
    includeMaybePlayers: true,
  };
}

describe("buildPlayerGameView", () => {
  it("updating hides obsolete teams", () => {
    const v = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p1",
      playingCount: 7,
      maybeCount: 0,
      includedCount: 7,
      currentTeams: teams(),
      isUpdating: true,
    });
    expect(v.showTeamLists).toBe(false);
    expect(v.showProgress).toBe(true);
    expect(v.teamsMessage).toBe("Updating teams…");
  });

  it("ready shows teams", () => {
    const v = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p1",
      playingCount: 5,
      maybeCount: 1,
      includedCount: 6,
      currentTeams: teams(),
    });
    expect(v.teamsMessage).toBe("Teams ready");
    expect(v.showTeamLists).toBe(true);
    expect(v.confirmedLabel).toBe("5 confirmed + 1 maybe");
  });

  it("ready with only playing omits maybe and never shows / minPlaying", () => {
    const v = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p1",
      playingCount: 10,
      maybeCount: 0,
      includedCount: 10,
      currentTeams: teams(),
      minPlaying: 6,
    });
    expect(v.confirmedLabel).toBe("10 players confirmed");
    expect(v.confirmedLabel.includes("/")).toBe(false);
  });
});
