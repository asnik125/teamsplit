import { describe, expect, it } from "vitest";
import {
  attendanceMapAfterNoGameChange,
  canEditAttendanceOnGame,
  canSetGameNoGame,
  effectiveAttendanceStatus,
  gameHasNoGame,
} from "@/lib/no-game";
import {
  buildDueSlots,
  isNotificationDue,
  computeNotificationDueAt,
} from "@/lib/notifications/schedule";
import { defaultNotificationSettings } from "@/lib/notifications/defaults";
import { isPlayableGame, nextUpcomingGame } from "@/lib/schedule";
import type { AttendanceStatus, Game, NotificationSettings } from "@/lib/types";

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

describe("No Game permissions", () => {
  it("1. Admin can set No Game", () => {
    expect(canSetGameNoGame("admin")).toBe(true);
  });

  it("2. Player cannot set/unset No Game", () => {
    expect(canSetGameNoGame("player")).toBe(false);
    expect(canSetGameNoGame(null)).toBe(false);
  });
});

describe("No Game attendance", () => {
  it("3. Existing attendance is cleared to — when enabling No Game", () => {
    const prev: Record<string, AttendanceStatus> = {
      p1: "playing",
      p2: "maybe",
      p3: "not_playing",
    };
    const cleared = attendanceMapAfterNoGameChange(prev, true);
    expect(cleared).toEqual({});
    expect(effectiveAttendanceStatus({ noGame: true }, "playing")).toBe(
      "no_response"
    );
  });

  it("4. Player cannot change attendance on No Game", () => {
    const g = game({ id: "g1", date: "2026-10-01", noGame: true });
    expect(canEditAttendanceOnGame(g)).toBe(false);
  });

  it("5. Admin cannot change attendance on No Game", () => {
    // Lock is game-level — role does not bypass canEditAttendanceOnGame
    const g = game({ id: "g1", date: "2026-10-01", noGame: true });
    expect(canEditAttendanceOnGame(g)).toBe(false);
  });

  it("6. No Game remains visible in Attendance (still scheduled)", () => {
    const games = [
      game({ id: "g1", date: "2026-09-24", noGame: true }),
      game({ id: "g2", date: "2026-10-01" }),
    ];
    const visible = games.filter((g) => g.status === "scheduled");
    expect(visible.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(gameHasNoGame(visible[0]!)).toBe(true);
  });

  it("10. Unchecking No Game re-enables attendance but does not restore selections", () => {
    const prev: Record<string, AttendanceStatus> = {
      p1: "playing",
      p2: "maybe",
    };
    // Enabling clears
    expect(attendanceMapAfterNoGameChange(prev, true)).toEqual({});
    // Disabling also does not restore prior map
    expect(attendanceMapAfterNoGameChange(prev, false)).toEqual({});

    const reopened = game({ id: "g1", date: "2026-10-01", noGame: false });
    expect(canEditAttendanceOnGame(reopened)).toBe(true);
    expect(effectiveAttendanceStatus(reopened, undefined)).toBe("no_response");
  });

  it("11. Existing games without noGame continue to work normally", () => {
    const legacy = game({ id: "g1", date: "2026-10-01" });
    delete (legacy as { noGame?: boolean }).noGame;
    expect(gameHasNoGame(legacy as Game)).toBe(false);
    expect(canEditAttendanceOnGame(legacy as Game)).toBe(true);
    expect(isPlayableGame(legacy as Game)).toBe(true);
    expect(effectiveAttendanceStatus(legacy as Game, "playing")).toBe(
      "playing"
    );
  });
});

describe("No Game teams + nearest", () => {
  it("7+8. Teams / nearest upcoming game skips No Game", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const games = [
      game({ id: "sep24", date: "2026-09-24", startTime: "19:00", noGame: true }),
      game({ id: "oct1", date: "2026-10-01", startTime: "19:00", noGame: false }),
    ];
    expect(nextUpcomingGame(games, now)?.id).toBe("oct1");
    expect(isPlayableGame(games[0]!)).toBe(false);
    expect(isPlayableGame(games[1]!)).toBe(true);
  });

  it("skips cancelled and No Game when picking nearest", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const games = [
      game({ id: "a", date: "2026-09-24", noGame: true }),
      game({ id: "b", date: "2026-10-01", status: "cancelled" }),
      game({ id: "c", date: "2026-10-08" }),
    ];
    expect(nextUpcomingGame(games, now)?.id).toBe("c");
  });
});

describe("No Game notifications", () => {
  it("9. notifications skip No Game", () => {
    const settings: NotificationSettings = defaultNotificationSettings();
    const noGameDate = game({
      id: "nogame",
      date: "2026-09-24",
      startTime: "19:30",
      noGame: true,
    });
    const active = game({
      id: "active",
      date: "2026-10-01",
      startTime: "19:30",
      noGame: false,
    });

    // Mid window after day-before due for Sep 24
    const afterDayBefore = new Date("2026-09-24T03:00:00.000Z");
    const slots = buildDueSlots({
      games: [noGameDate, active],
      settings,
      now: afterDayBefore,
    });
    expect(slots.every((s) => s.gameId !== "nogame")).toBe(true);

    const dueAt = computeNotificationDueAt(noGameDate, settings.gameReminder);
    expect(
      isNotificationDue({
        game: noGameDate,
        dueAt,
        now: new Date(dueAt.getTime() + 60_000),
      })
    ).toBe(false);
  });
});
