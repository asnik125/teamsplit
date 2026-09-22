import { describe, expect, it } from "vitest";
import { calculateOverall } from "@/lib/balancer";
import {
  decideTeamsSync,
  DEFAULT_MIN_PLAYING_FOR_TEAMS,
  isIncludedForTeams,
  confirmedProgressLabel,
} from "@/lib/team-sync";
import type { PlayerRatings, RatedPlayer } from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";

function rated(id: string, overallHint = 60): RatedPlayer {
  const ratings = Object.fromEntries(
    RATING_KEYS.map((k) => [k, Math.max(1, Math.round(overallHint / 10))])
  ) as PlayerRatings;
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

function pool(n: number): RatedPlayer[] {
  return Array.from({ length: n }, (_, i) => rated(`p${i + 1}`, 50 + i));
}

describe("team inclusion + sync", () => {
  it("Maybe is excluded unless includeMaybe", () => {
    expect(isIncludedForTeams("maybe", false)).toBe(false);
    expect(isIncludedForTeams("maybe", true)).toBe(true);
    expect(isIncludedForTeams("playing", false)).toBe(true);
  });

  it("5 playing insufficient; with maybe still insufficient without flag", () => {
    const d = decideTeamsSync({
      includedRated: pool(5),
      existing: null,
      minPlaying: 6,
      includeMaybePlayers: false,
    });
    expect(d.clearTeams || !d.writeTeams).toBe(true);
    expect(d.action).toBe("insufficient");
  });

  it("5 playing + 2 maybe with includeMaybe creates teams", () => {
    const d = decideTeamsSync({
      includedRated: pool(7),
      maybePlayerIds: new Set(["p6", "p7"]),
      existing: null,
      minPlaying: 6,
      includeMaybePlayers: true,
    });
    expect(d.writeTeams).toBe(true);
    expect(d.teamA.length + d.teamB.length).toBe(7);
    const marked = [...d.teamA, ...d.teamB].filter((m) => m.maybe);
    expect(marked.length).toBe(2);
  });

  it("defaults minimum 6", () => {
    expect(DEFAULT_MIN_PLAYING_FOR_TEAMS).toBe(6);
    expect(confirmedProgressLabel(5, 6)).toBe("5 / 6 players confirmed");
  });
});
