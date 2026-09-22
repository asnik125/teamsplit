/**
 * End-to-end workflow smoke (logic), covering the main MVP scenario:
 * Create weekly games → RSVP Playing → Team Builder selection → Publish (player-safe).
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  calculateOverall,
  generateSnakeDraftTeams,
  toPublicMembers,
} from "@/lib/balancer";
import { isStaffRole } from "@/lib/roles";
import {
  buildWeeklyGames,
  playingPlayerIds,
  updateGameInList,
} from "@/lib/schedule";
import type { Player, RatedPlayer } from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";

describe("core MVP calendar → teams flow", () => {
  it("Admin creates 10 weekly games → Playing RSVP → generate → publish is player-safe", () => {
    expect(isStaffRole("admin")).toBe(true);

    const schedule = buildWeeklyGames({
      firstDate: "2026-10-01",
      startTime: "19:00",
      location: "Gym",
      weeks: 10,
      seasonId: "2026-2027",
      createdBy: "admin1",
      idBase: "g_mvp",
    });
    expect(schedule).toHaveLength(10);

    const targetGame = schedule[0];
    const players: Player[] = [
      {
        id: "p1",
        displayName: "Misha",
        email: null,
        active: true,
        linkedUid: null,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "p2",
        displayName: "Yura",
        email: null,
        active: true,
        linkedUid: null,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "p3",
        displayName: "Boris",
        email: null,
        active: true,
        linkedUid: null,
        createdAt: "",
        updatedAt: "",
      },
    ];

    // Per-game RSVP map (independent)
    const attendance = new Map([
      ["p1", "playing" as const],
      ["p2", "playing" as const],
      ["p3", "not_playing" as const],
    ]);
    const selected = playingPlayerIds(players, attendance);
    expect(selected).toEqual(["p1", "p2"]);

    const seed = JSON.parse(
      readFileSync(resolve("soccer_players_backup.json"), "utf8")
    ) as Array<Record<string, string | number>>;

    const ratedPool = seed
      .filter((row) =>
        selected.includes("p1")
          ? ["Misha", "Yura O"].includes(String(row.name))
          : false
      )
      .map((row): RatedPlayer => {
        const ratings = Object.fromEntries(
          RATING_KEYS.map((k) => [k, Number(row[k])])
        ) as import("@/lib/types").PlayerRatings;
        return {
          id: String(row.id),
          displayName: String(row.name),
          email: null,
          active: true,
          linkedUid: null,
          createdAt: "",
          updatedAt: "",
          ...ratings,
          overall: calculateOverall(ratings),
        };
      });

    expect(ratedPool.length).toBeGreaterThanOrEqual(2);
    const { teamA, teamB } = generateSnakeDraftTeams(ratedPool);

    const published = {
      gameId: targetGame.id,
      published: true,
      publishedAt: new Date().toISOString(),
      teamA: toPublicMembers(teamA),
      teamB: toPublicMembers(teamB),
    };

    expect(published.gameId).toBe("g_mvp_1");
    expect(JSON.stringify(published)).not.toMatch(
      /overall|speed|strength|stamina|control|passing|action|defend|attack|transition|decisions|workrate|teamStrength/
    );

    // Editing another game in the batch does not change published game id binding
    const edited = updateGameInList(schedule, schedule[3].id, {
      location: "Other Gym",
    });
    expect(edited.find((g) => g.id === targetGame.id)?.location).toBe("Gym");
    expect(edited.find((g) => g.id === schedule[3].id)?.location).toBe(
      "Other Gym"
    );
  });

  it("documents that Player staff routes are gated by role (contract)", () => {
    expect(isStaffRole("player")).toBe(false);
    expect(isStaffRole("admin")).toBe(true);
  });
});
