import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_ADMIN_LOCK_LOCAL_TIME,
  adminTeamsFocusGame,
  attendanceAdminLockAtMs,
  canAdminOperateTeamsOnGame,
  canEditAttendanceOnGame,
  defaultFocusedGame,
  roleMayEditAttendanceAfterKickoff,
} from "@/lib/no-game";
import {
  areTeamsStale,
  eligiblePoolFingerprint,
  TEAMS_STALE_MESSAGE,
  teamsStatusMessageForState,
} from "@/lib/team-eligibility";
import { nextUpcomingGame } from "@/lib/schedule";
import { vancouverLocalToUtc } from "@/lib/notifications/timezone";
import { GAME_TIMEZONE } from "@/lib/schedule";
import type { Game, GameTeams } from "@/lib/types";

function game(
  partial: Partial<Game> & Pick<Game, "id" | "date" | "startTime">
): Game {
  return {
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

/** Thursday Oct 15, 2026 7:30 PM Vancouver kickoff — production failure date. */
const GAME_DATE = "2026-10-15";
const NEXT_DATE = "2026-10-22";

const AT_729 = vancouverLocalToUtc(GAME_DATE, "19:29", GAME_TIMEZONE);
const AT_730 = vancouverLocalToUtc(GAME_DATE, "19:30", GAME_TIMEZONE);
const AT_902 = vancouverLocalToUtc(GAME_DATE, "21:02", GAME_TIMEZONE);
const AT_943 = vancouverLocalToUtc(GAME_DATE, "21:43", GAME_TIMEZONE);
const AT_1001 = vancouverLocalToUtc(GAME_DATE, "22:01", GAME_TIMEZONE);
const AT_1159 = vancouverLocalToUtc(GAME_DATE, "23:59", GAME_TIMEZONE);
const AT_MIDNIGHT = vancouverLocalToUtc("2026-10-16", "00:00", GAME_TIMEZONE);
const BEFORE_KICKOFF = vancouverLocalToUtc(GAME_DATE, "18:00", GAME_TIMEZONE);

const tonight = () =>
  game({ id: "tonight", date: GAME_DATE, startTime: "19:30", endTime: "21:02" });
const nextWeek = () =>
  game({ id: "next", date: NEXT_DATE, startTime: "19:30" });

describe("Attendance edit window (America/Vancouver)", () => {
  it("locks at midnight on the next Vancouver calendar day", () => {
    expect(ATTENDANCE_ADMIN_LOCK_LOCAL_TIME).toBe("00:00");
    expect(attendanceAdminLockAtMs(tonight())).toBe(AT_MIDNIGHT.getTime());
  });

  it("Admin and Owner may edit after kickoff", () => {
    expect(roleMayEditAttendanceAfterKickoff("admin")).toBe(true);
    expect(roleMayEditAttendanceAfterKickoff("owner")).toBe(true);
    expect(roleMayEditAttendanceAfterKickoff("player")).toBe(false);
  });

  it("Player cannot edit after kickoff", () => {
    const g = tonight();
    expect(canEditAttendanceOnGame(g, "player", AT_943)).toBe(false);
    expect(canEditAttendanceOnGame(g, null, AT_943)).toBe(false);
  });

  it("Admin can edit after kickoff through 11:59 PM Vancouver", () => {
    const g = tonight();
    expect(canEditAttendanceOnGame(g, "admin", BEFORE_KICKOFF)).toBe(true);
    expect(canEditAttendanceOnGame(g, "admin", AT_730)).toBe(true);
    expect(canEditAttendanceOnGame(g, "admin", AT_943)).toBe(true);
    expect(canEditAttendanceOnGame(g, "admin", AT_1001)).toBe(true);
    expect(canEditAttendanceOnGame(g, "admin", AT_1159)).toBe(true);
  });

  it("Owner can edit after kickoff through 11:59 PM Vancouver", () => {
    const g = tonight();
    expect(canEditAttendanceOnGame(g, "owner", AT_943)).toBe(true);
    expect(canEditAttendanceOnGame(g, "owner", AT_1159)).toBe(true);
  });

  it("Admin/Owner cannot edit from midnight Vancouver", () => {
    const g = tonight();
    expect(canEditAttendanceOnGame(g, "admin", AT_MIDNIGHT)).toBe(false);
    expect(canEditAttendanceOnGame(g, "owner", AT_MIDNIGHT)).toBe(false);
    expect(canEditAttendanceOnGame(g, "player", AT_MIDNIGHT)).toBe(false);
  });

  it("future games stay editable for players before their kickoff", () => {
    expect(canEditAttendanceOnGame(nextWeek(), "player", AT_943)).toBe(true);
  });

  it("No Game remains locked for Admin even before midnight", () => {
    const g = game({
      id: "nogame",
      date: GAME_DATE,
      startTime: "19:30",
      noGame: true,
    });
    expect(canEditAttendanceOnGame(g, "admin", AT_943)).toBe(false);
  });
});

describe("Admin team ops after kickoff through midnight", () => {
  it("allows Generate / Include Maybe / manual moves through 11:59 PM", () => {
    const g = tonight();
    const next = nextWeek();
    for (const now of [AT_729, AT_730, AT_902, AT_943, AT_1001, AT_1159]) {
      expect(canAdminOperateTeamsOnGame(g, [g, next], now)).toBe(true);
    }
    expect(canAdminOperateTeamsOnGame(g, [g, next], AT_MIDNIGHT)).toBe(false);
  });

  it("still allows nearest upcoming before its kickoff", () => {
    const next = nextWeek();
    expect(
      canAdminOperateTeamsOnGame(next, [tonight(), next], AT_943)
    ).toBe(true);
  });

  it("Admin focus prefers tonight until midnight; players jump at kickoff", () => {
    const g = tonight();
    const next = nextWeek();
    const games = [g, next];

    for (const now of [AT_729, AT_730, AT_902, AT_943, AT_1001, AT_1159]) {
      expect(adminTeamsFocusGame(games, now)?.id).toBe("tonight");
      expect(defaultFocusedGame(games, { adminFocus: true, now })?.id).toBe(
        "tonight"
      );
    }

    // Player / nextUpcomingGame drops tonight as soon as kickoff arrives.
    expect(nextUpcomingGame(games, AT_729)?.id).toBe("tonight");
    expect(nextUpcomingGame(games, AT_730)?.id).toBe("next");
    expect(defaultFocusedGame(games, { adminFocus: false, now: AT_943 })?.id).toBe(
      "next"
    );

    // After midnight Admin may advance to next week.
    expect(adminTeamsFocusGame(games, AT_MIDNIGHT)?.id).toBe("next");
    expect(
      defaultFocusedGame(games, { adminFocus: true, now: AT_MIDNIGHT })?.id
    ).toBe("next");
  });

  it("mobile Admin default must match desktop Admin focus (not nextUpcomingGame)", () => {
    const games = [tonight(), nextWeek()];
    // Regression: previous mobile path used nextUpcomingGame and jumped at 7:30.
    expect(nextUpcomingGame(games, AT_943)?.id).toBe("next");
    expect(defaultFocusedGame(games, { adminFocus: true, now: AT_943 })?.id).toBe(
      "tonight"
    );
    expect(
      defaultFocusedGame(games, { adminFocus: false, now: AT_943 })?.id
    ).toBe("next");
  });

  it("keeps an already-selected game id across reload while it still exists", () => {
    const games = [tonight(), nextWeek()];
    const selectedId = "tonight";
    const stillPresent = games.some((g) => g.id === selectedId);
    expect(stillPresent).toBe(true);
    // Selection effect returns early when the id is still in the list —
    // even after kickoff and after 10 PM — until midnight default changes.
    expect(adminTeamsFocusGame(games, AT_943)?.id).toBe("tonight");
    expect(adminTeamsFocusGame(games, AT_1001)?.id).toBe("tonight");
  });

  it("mobile session and desktop board both default with adminFocus", () => {
    const hook = readFileSync("src/hooks/useNearestGameSession.ts", "utf8");
    const board = readFileSync("src/components/PlayerGameBoard.tsx", "utf8");
    expect(hook).toContain(
      "defaultFocusedGame(games, { adminFocus: showAdminUI })"
    );
    expect(hook).not.toContain("nextUpcomingGame(games)");
    expect(board).toContain(
      "defaultFocusedGame(games, { adminFocus: showAdminUI })"
    );
    expect(board).toContain("adminTeamsFocusGame(games)");
  });
});

describe("Attendance change after kickoff → stale, no regenerate", () => {
  it("eligible pool change marks generated teams stale", () => {
    const teams: GameTeams = {
      gameId: "tonight",
      teamA: [
        { playerId: "a", displayName: "A" },
        { playerId: "b", displayName: "B" },
      ],
      teamB: [
        { playerId: "c", displayName: "C" },
        { playerId: "d", displayName: "D" },
      ],
      published: false,
      publishedAt: null,
      updatedAt: "",
      updatedBy: null,
      manuallyAdjusted: false,
      includeMaybePlayers: false,
      stale: false,
      eligibleFingerprint: eligiblePoolFingerprint(["a", "b", "c", "d"]),
    };

    const after = areTeamsStale({
      teams,
      currentEligibleIds: ["a", "b", "c"],
    });
    expect(after).toBe(true);
    expect(
      teamsStatusMessageForState({
        hasComposition: true,
        stale: true,
        includedCount: 3,
        minPlaying: 2,
      })
    ).toBe(TEAMS_STALE_MESSAGE);

    expect(teams.teamA.map((m) => m.playerId)).toEqual(["a", "b"]);
    expect(teams.teamB.map((m) => m.playerId)).toEqual(["c", "d"]);
  });
});
