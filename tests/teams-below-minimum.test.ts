import { describe, expect, it } from "vitest";
import { buildPlayerGameView } from "@/lib/player-game-view";
import { isIncludedForTeams } from "@/lib/team-sync";
import { createThreeTeamsControl } from "@/lib/team-generate";
import {
  areTeamsStale,
  clearedGeneratedTeams,
  countConfirmedPlaying,
  shouldClearGeneratedTeams,
  teamsHaveComposition,
} from "@/lib/team-eligibility";
import type { GameTeams, TeamMemberPublic } from "@/lib/types";

function member(id: string): TeamMemberPublic {
  return { playerId: id, displayName: id };
}

function generated(teamC?: TeamMemberPublic[]): GameTeams {
  const teams: GameTeams = {
    gameId: "g1",
    teamA: [member("p1"), member("p2"), member("p3")],
    teamB: [member("p4"), member("p5"), member("p6")],
    published: false,
    publishedAt: null,
    updatedAt: "t",
    updatedBy: "admin",
    manuallyAdjusted: false,
    includeMaybePlayers: true,
    stale: false,
    eligibleFingerprint: "p1,p2,p3,p4,p5,p6",
  };
  if (teamC && teamC.length > 0) teams.teamC = teamC;
  return teams;
}

function players(ids: string[]) {
  return ids.map((id) => ({ id, active: true }));
}

describe("teams clear when confirmed Playing drops below the minimum", () => {
  it("6 Playing → generate → 5 Playing clears teams → 6 again stays empty", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const attendance = ids.map((playerId) => ({
      playerId,
      status: "playing" as const,
    }));
    expect(countConfirmedPlaying({ players: players(ids), attendance })).toBe(6);

    let teams: GameTeams | null = generated();
    expect(teamsHaveComposition(teams)).toBe(true);
    expect(
      shouldClearGeneratedTeams({
        playingCount: 6,
        minPlaying: 6,
        hasComposition: true,
      })
    ).toBe(false);

    const afterDrop = attendance.map((row) =>
      row.playerId === "p6" ? { ...row, status: "not_playing" as const } : row
    );
    const playing = countConfirmedPlaying({
      players: players(ids),
      attendance: afterDrop,
    });
    expect(playing).toBe(5);
    expect(
      shouldClearGeneratedTeams({
        playingCount: playing,
        minPlaying: 6,
        hasComposition: teamsHaveComposition(teams),
      })
    ).toBe(true);

    teams = clearedGeneratedTeams({
      gameId: "g1",
      includeMaybePlayers: true,
      updatedAt: "t2",
      updatedBy: "admin",
    });
    expect(teams.teamA).toEqual([]);
    expect(teams.teamB).toEqual([]);
    expect(teams.teamC).toBeUndefined();
    expect(teamsHaveComposition(teams)).toBe(false);

    const hidden = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p1",
      playingCount: 5,
      maybeCount: 0,
      includedCount: 5,
      currentTeams: teams,
      minPlaying: 6,
    });
    expect(hidden.teamsPhase).toBe("insufficient");
    expect(hidden.teamsMessage).toBe("Not enough players yet.");
    expect(hidden.showTeamLists).toBe(false);

    const restored = buildPlayerGameView({
      myStatus: "playing",
      myPlayerId: "p1",
      playingCount: 6,
      maybeCount: 0,
      includedCount: 6,
      currentTeams: teams,
      minPlaying: 6,
    });
    expect(restored.teamsPhase).toBe("awaiting_generate");
    expect(restored.showTeamLists).toBe(false);
    expect(restored.teamsMessage).toBe("Generate teams when ready");
    expect(
      shouldClearGeneratedTeams({
        playingCount: 6,
        minPlaying: 6,
        hasComposition: teamsHaveComposition(teams),
      })
    ).toBe(false);
  });

  it("Generate uses Playing plus Maybe only when Include Maybe is on", () => {
    function view(input: {
      playing: number;
      maybe: number;
      includeMaybe: boolean;
    }) {
      const included = input.includeMaybe
        ? input.playing + input.maybe
        : input.playing;
      return buildPlayerGameView({
        myStatus: "playing",
        myPlayerId: "p1",
        playingCount: input.playing,
        maybeCount: input.maybe,
        includedCount: included,
        includeMaybePlayers: input.includeMaybe,
        currentTeams: null,
        minPlaying: 6,
      });
    }

    const off = view({ playing: 5, maybe: 1, includeMaybe: false });
    expect(off.teamsPhase).toBe("insufficient");
    expect(off.teamsMessage).toBe("Not enough players yet.");

    const oneMaybe = view({ playing: 5, maybe: 1, includeMaybe: true });
    expect(oneMaybe.teamsPhase).toBe("awaiting_generate");
    expect(oneMaybe.teamsMessage).toBe("Generate teams when ready");
    expect(oneMaybe.showTeamLists).toBe(false);

    const twoMaybe = view({ playing: 4, maybe: 2, includeMaybe: true });
    expect(twoMaybe.teamsPhase).toBe("awaiting_generate");

    const shortPool = view({ playing: 4, maybe: 1, includeMaybe: true });
    expect(shortPool.teamsPhase).toBe("insufficient");

    const generatedFromPool = buildPlayerGameView({
      myStatus: "maybe",
      myPlayerId: "m1",
      playingCount: 5,
      maybeCount: 1,
      includedCount: 6,
      includeMaybePlayers: true,
      currentTeams: generated([member("m1")]),
      minPlaying: 6,
    });
    expect(generatedFromPool.teamsPhase).not.toBe("insufficient");
    expect(generatedFromPool.showTeamLists).toBe(true);
    expect(generatedFromPool.teamC.map((player) => player.playerId)).toEqual([
      "m1",
    ]);

    const pool = (playing: number, maybe: number, includeMaybe: boolean) =>
      [
        ...Array.from({ length: playing }, () => "playing" as const),
        ...Array.from({ length: maybe }, () => "maybe" as const),
      ].filter((status) => isIncludedForTeams(status, includeMaybe)).length;
    expect(pool(10, 1, false)).toBe(10);
    expect(
      createThreeTeamsControl({ eligibleCount: pool(10, 1, false), checked: true })
        .enabled
    ).toBe(false);
    expect(pool(10, 1, true)).toBe(11);
    expect(
      createThreeTeamsControl({ eligibleCount: pool(10, 1, true), checked: false })
        .enabled
    ).toBe(true);

    expect(
      shouldClearGeneratedTeams({
        playingCount: 5,
        minPlaying: 6,
        hasComposition: true,
      })
    ).toBe(true);
  });

  it("Maybe does not keep teams when Playing is below the minimum", () => {
    const roster = players(["p1", "p2", "p3", "p4", "p5", "m1", "m2"]);
    const attendance = [
      ...["p1", "p2", "p3", "p4", "p5"].map((playerId) => ({
        playerId,
        status: "playing" as const,
      })),
      ...["m1", "m2"].map((playerId) => ({
        playerId,
        status: "maybe" as const,
      })),
    ];
    expect(countConfirmedPlaying({ players: roster, attendance })).toBe(5);
    expect(
      shouldClearGeneratedTeams({
        playingCount: 5,
        minPlaying: 6,
        hasComposition: true,
      })
    ).toBe(true);
  });

  it("6+ Playing still only marks teams stale", () => {
    const teams = generated();
    expect(
      shouldClearGeneratedTeams({
        playingCount: 6,
        minPlaying: 6,
        hasComposition: true,
      })
    ).toBe(false);
    expect(
      areTeamsStale({
        teams,
        currentEligibleIds: ["p1", "p2", "p3", "p4", "p5"],
      })
    ).toBe(true);
    expect(teams.teamA).toHaveLength(3);
    expect(teams.teamB).toHaveLength(3);
  });

  it("clears a saved third team along with Black and White", () => {
    const teams = generated([member("p7"), member("p8"), member("p9")]);
    expect(teams.teamC).toHaveLength(3);
    const cleared = clearedGeneratedTeams({
      gameId: teams.gameId,
      includeMaybePlayers: teams.includeMaybePlayers,
      updatedAt: "t2",
      updatedBy: null,
    });
    expect(cleared.teamC).toBeUndefined();
    expect(cleared.includeMaybePlayers).toBe(true);
  });
});
