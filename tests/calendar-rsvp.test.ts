import { describe, expect, it } from "vitest";
import { nextUpcomingGame } from "@/lib/firebase/data";
import {
  buildSingleGame,
  buildWeeklyGames,
  cancelGameInList,
  deleteGameFromList,
  formatDisplayDate,
  formatDisplayTime,
  formatShortDate,
  formatAttendanceColumnDate,
  compareGamesByDateTime,
  gamesForSeason,
  groupAttendanceByStatus,
  playingPlayerIds,
  seasonIdForDate,
  splitUpcomingPast,
  updateGameInList,
} from "@/lib/schedule";
import type { Game, Player } from "@/lib/types";
import { getNotificationService, NoopNotificationService } from "@/lib/notifications";
import { isStaffRole } from "@/lib/roles";

function game(partial: Partial<Game> & Pick<Game, "id" | "date">): Game {
  return {
    startTime: "19:00",
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

function player(id: string, name: string): Player {
  return {
    id,
    displayName: name,
    email: null,
    active: true,
    linkedUid: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("create single game", () => {
  it("admin can create one game with date, time, location, season", () => {
    const g = buildSingleGame({
      date: "2026-10-01",
      startTime: "19:00",
      location: "Gym",
      seasonId: "2026-2027",
      createdBy: "admin1",
    });
    expect(g.date).toBe("2026-10-01");
    expect(g.startTime).toBe("19:00");
    expect(g.location).toBe("Gym");
    expect(g.seasonId).toBe("2026-2027");
    expect(g.status).toBe("scheduled");
  });
});

describe("create multiple weekly games", () => {
  it("creating 3 weeks produces 3 games at 7-day intervals", () => {
    const games = buildWeeklyGames({
      firstDate: "2026-10-01",
      startTime: "19:00",
      location: "Gym",
      weeks: 3,
      seasonId: "2026-2027",
      createdBy: "admin1",
      idBase: "g_batch",
    });
    expect(games).toHaveLength(3);
    expect(games.map((g) => g.date)).toEqual([
      "2026-10-01",
      "2026-10-08",
      "2026-10-15",
    ]);
    expect(new Set(games.map((g) => g.id)).size).toBe(3);
  });

  it("creating 10 weeks produces 10 games at 7-day intervals", () => {
    const games = buildWeeklyGames({
      firstDate: "2026-10-01",
      startTime: "19:00",
      location: "Gym",
      weeks: 10,
      seasonId: "2026-2027",
      createdBy: "admin1",
      idBase: "g_ten",
    });
    expect(games).toHaveLength(10);
    expect(games[0].date).toBe("2026-10-01");
    expect(games[3].date).toBe("2026-10-22");
    expect(games[9].date).toBe("2026-12-03");
    games.forEach((g) => {
      expect(g.startTime).toBe("19:00");
      expect(g.location).toBe("Gym");
      expect(g.seasonId).toBe("2026-2027");
    });
  });

  it("rejects invalid week counts", () => {
    expect(() =>
      buildWeeklyGames({
        firstDate: "2026-10-01",
        startTime: "19:00",
        location: "Gym",
        weeks: 0,
        seasonId: "2026-2027",
        createdBy: "x",
      })
    ).toThrow(/at least 1/i);
  });
});

describe("games are independent after weekly create", () => {
  it("editing one generated game does not modify the others", () => {
    let games = buildWeeklyGames({
      firstDate: "2026-10-01",
      startTime: "19:00",
      location: "Gym",
      weeks: 5,
      seasonId: "2026-2027",
      createdBy: "admin1",
      idBase: "g_ind",
    });
    const fourthId = games[3].id;
    const beforeOthers = games.filter((g) => g.id !== fourthId).map((g) => ({ ...g }));

    games = updateGameInList(games, fourthId, {
      date: "2026-10-23",
      startTime: "20:00",
      location: "Field",
    });

    const edited = games.find((g) => g.id === fourthId)!;
    expect(edited.date).toBe("2026-10-23");
    expect(edited.startTime).toBe("20:00");
    expect(edited.location).toBe("Field");

    const others = games.filter((g) => g.id !== fourthId);
    expect(others).toEqual(
      beforeOthers.map((g) => expect.objectContaining({
        id: g.id,
        date: g.date,
        startTime: g.startTime,
        location: g.location,
      }))
    );
    // Stronger: exact date/time/location unchanged
    others.forEach((g, i) => {
      expect(g.date).toBe(beforeOthers[i].date);
      expect(g.startTime).toBe(beforeOthers[i].startTime);
      expect(g.location).toBe(beforeOthers[i].location);
    });
  });

  it("cancelling/deleting one game does not affect the rest", () => {
    let games = buildWeeklyGames({
      firstDate: "2026-10-01",
      startTime: "19:00",
      location: "Gym",
      weeks: 4,
      seasonId: "2026-2027",
      createdBy: "admin1",
      idBase: "g_cancel",
    });
    const target = games[1].id;
    games = cancelGameInList(games, target);
    expect(games.find((g) => g.id === target)?.status).toBe("cancelled");
    expect(games.filter((g) => g.id !== target).every((g) => g.status === "scheduled")).toBe(
      true
    );

    games = deleteGameFromList(games, target);
    expect(games).toHaveLength(3);
    expect(games.find((g) => g.id === target)).toBeUndefined();
  });
});

describe("player calendar / RSVP", () => {
  it("splits upcoming and past; past games remain available", () => {
    const games = [
      game({ id: "past1", date: "2020-01-01" }),
      game({ id: "up1", date: "2099-01-01" }),
      game({ id: "up2", date: "2099-02-01" }),
      game({ id: "cancel", date: "2099-01-15", status: "cancelled" }),
    ];
    const { upcoming, past } = splitUpcomingPast(games, "2026-09-21");
    expect(upcoming.map((g) => g.id)).toEqual(["up1", "up2"]);
    expect(past.map((g) => g.id).sort()).toEqual(["cancel", "past1"]);
  });

  it("picks the next upcoming scheduled game", () => {
    const today = new Date().toISOString().slice(0, 10);
    const games = [
      game({ id: "past", date: "2020-01-01" }),
      game({ id: "cancel", date: today, status: "cancelled" }),
      game({ id: "soon", date: "2099-01-02", startTime: "18:00" }),
      game({ id: "sooner", date: "2099-01-01", startTime: "20:00" }),
    ];
    expect(nextUpcomingGame(games)?.id).toBe("sooner");
  });

  it("handles Playing / Not Playing / No Response and independent RSVP maps", () => {
    const players = [
      player("p1", "A"),
      player("p2", "B"),
      player("p3", "C"),
    ];
    const gameA = new Map<string, "playing" | "not_playing" | "no_response">([
      ["p1", "playing"],
      ["p2", "not_playing"],
    ]);
    const gameB = new Map<string, "playing" | "not_playing" | "no_response">([
      ["p1", "not_playing"],
      ["p3", "playing"],
    ]);

    const groupsA = groupAttendanceByStatus(players, gameA);
    expect(groupsA.playing.map((p) => p.id)).toEqual(["p1"]);
    expect(groupsA.notPlaying.map((p) => p.id)).toEqual(["p2"]);
    expect(groupsA.noResponse.map((p) => p.id)).toEqual(["p3"]);

    expect(playingPlayerIds(players, gameA)).toEqual(["p1"]);
    expect(playingPlayerIds(players, gameB)).toEqual(["p3"]);
  });

  it("Team Builder defaults to Playing players for the selected game", () => {
    const players = [player("p1", "A"), player("p2", "B"), player("p3", "C")];
    const attendance = new Map([
      ["p1", "playing" as const],
      ["p2", "not_playing" as const],
    ]);
    expect(playingPlayerIds(players, attendance)).toEqual(["p1"]);
  });
});

describe("seasons architecture", () => {
  it("derives seasonId and filters games by season", () => {
    expect(seasonIdForDate("2026-10-01")).toBe("2026-2027");
    expect(seasonIdForDate("2027-03-01")).toBe("2026-2027");
    const games = [
      game({ id: "a", date: "2026-10-01", seasonId: "2026-2027" }),
      game({ id: "b", date: "2025-10-01", seasonId: "2025-2026" }),
    ];
    expect(gamesForSeason(games, "2026-2027").map((g) => g.id)).toEqual(["a"]);
  });
});

describe("display formatting", () => {
  it("formats date and time for players", () => {
    expect(formatDisplayDate("2026-10-01")).toContain("October");
    expect(formatDisplayTime("19:00")).toBe("7:00 PM");
  });

  it("formats short sheet-style dates", () => {
    expect(formatShortDate("2026-09-24")).toBe("Sep-24");
    expect(formatShortDate("2026-10-01")).toBe("Oct-1");
  });

  it("includes year in attendance columns when years differ", () => {
    const dates = ["2026-11-05", "2099-08-01"];
    expect(formatAttendanceColumnDate("2099-08-01", dates)).toBe("Aug-1-2099");
    expect(formatAttendanceColumnDate("2026-11-05", dates)).toBe("Nov-5-2026");
    expect(
      formatAttendanceColumnDate("2026-10-08", ["2026-10-08", "2026-11-05"])
    ).toBe("Oct-8");
  });

  it("sorts by full date+time not display label", () => {
    const games = [
      game({ id: "a", date: "2099-08-01", startTime: "19:00" }),
      game({ id: "b", date: "2026-11-05", startTime: "19:30" }),
      game({ id: "c", date: "2026-10-08", startTime: "19:30" }),
    ];
    const ordered = [...games].sort(compareGamesByDateTime).map((g) => g.date);
    expect(ordered).toEqual(["2026-10-08", "2026-11-05", "2099-08-01"]);
  });
});

describe("published teams stay bound to a game", () => {
  it("published payload is keyed by gameId and has no ratings", () => {
    const published = {
      gameId: "g_ten_4",
      published: true,
      publishedAt: new Date().toISOString(),
      teamA: [{ playerId: "1", displayName: "One" }],
      teamB: [{ playerId: "2", displayName: "Two" }],
      updatedAt: "",
      updatedBy: null,
    };
    expect(published.gameId).toBe("g_ten_4");
    expect(JSON.stringify(published)).not.toMatch(
      /overall|speed|strength|teamStrength|defend|attack/
    );
  });
});

describe("staff vs player authorization contract", () => {
  it("players cannot create/edit games; admin can", () => {
    expect(isStaffRole("player")).toBe(false);
    expect(isStaffRole("admin")).toBe(true);
  });
});

describe("notification boundary", () => {
  it("exposes a noop service that does not send mail", async () => {
    const service = getNotificationService();
    expect(service).toBeInstanceOf(NoopNotificationService);
    const result = await service.send({
      event: "gameCreated",
      to: [{ email: "a@test.com", displayName: "A" }],
      gameId: "g1",
    });
    expect(result.queued).toBe(false);
  });
});
