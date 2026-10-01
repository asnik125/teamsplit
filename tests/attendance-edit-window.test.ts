import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_ADMIN_LOCK_LOCAL_TIME,
  adminTeamsFocusGame,
  attendanceAdminLockAtMs,
  canAdminOperateTeamsOnGame,
  canEditAttendanceOnGame,
  roleMayEditAttendanceAfterKickoff,
} from "@/lib/no-game";
import {
  areTeamsStale,
  eligiblePoolFingerprint,
  TEAMS_STALE_MESSAGE,
  teamsStatusMessageForState,
} from "@/lib/team-eligibility";
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

/** 19:30 kickoff on 2026-09-24 → after kickoff, before 22:00 Vancouver. */
const AFTER_KICKOFF = vancouverLocalToUtc(
  "2026-09-24",
  "20:00",
  GAME_TIMEZONE
);
/** Exactly / after 22:00 Vancouver lock. */
const AFTER_22 = vancouverLocalToUtc("2026-09-24", "22:00", GAME_TIMEZONE);
const AFTER_22_01 = vancouverLocalToUtc("2026-09-24", "22:01", GAME_TIMEZONE);
const BEFORE_KICKOFF = vancouverLocalToUtc(
  "2026-09-24",
  "18:00",
  GAME_TIMEZONE
);

const tonight = () =>
  game({ id: "tonight", date: "2026-09-24", startTime: "19:30" });

describe("Attendance edit window (America/Vancouver)", () => {
  it("locks at 22:00 local on the game date", () => {
    expect(ATTENDANCE_ADMIN_LOCK_LOCAL_TIME).toBe("22:00");
    expect(attendanceAdminLockAtMs(tonight())).toBe(AFTER_22.getTime());
  });

  it("Admin and Owner may edit after kickoff", () => {
    expect(roleMayEditAttendanceAfterKickoff("admin")).toBe(true);
    expect(roleMayEditAttendanceAfterKickoff("owner")).toBe(true);
    expect(roleMayEditAttendanceAfterKickoff("player")).toBe(false);
  });

  it("Player cannot edit after kickoff", () => {
    const g = tonight();
    expect(canEditAttendanceOnGame(g, "player", AFTER_KICKOFF)).toBe(false);
    expect(canEditAttendanceOnGame(g, null, AFTER_KICKOFF)).toBe(false);
  });

  it("Admin can edit after kickoff but before 10 PM Vancouver", () => {
    const g = tonight();
    expect(canEditAttendanceOnGame(g, "admin", AFTER_KICKOFF)).toBe(true);
    expect(canEditAttendanceOnGame(g, "admin", BEFORE_KICKOFF)).toBe(true);
  });

  it("Owner can edit after kickoff but before 10 PM Vancouver", () => {
    const g = tonight();
    expect(canEditAttendanceOnGame(g, "owner", AFTER_KICKOFF)).toBe(true);
  });

  it("Admin/Owner cannot edit after 10 PM Vancouver", () => {
    const g = tonight();
    expect(canEditAttendanceOnGame(g, "admin", AFTER_22)).toBe(false);
    expect(canEditAttendanceOnGame(g, "owner", AFTER_22_01)).toBe(false);
    expect(canEditAttendanceOnGame(g, "player", AFTER_22)).toBe(false);
  });

  it("future games stay editable for players before their kickoff", () => {
    const future = game({
      id: "next",
      date: "2026-10-01",
      startTime: "19:30",
    });
    expect(canEditAttendanceOnGame(future, "player", AFTER_KICKOFF)).toBe(
      true
    );
  });

  it("No Game remains locked for Admin even before 10 PM", () => {
    const g = game({
      id: "nogame",
      date: "2026-09-24",
      startTime: "19:30",
      noGame: true,
    });
    expect(canEditAttendanceOnGame(g, "admin", AFTER_KICKOFF)).toBe(false);
  });
});

describe("Admin team ops after kickoff", () => {
  it("allows Generate on in-progress game until 22:00 Vancouver", () => {
    const g = tonight();
    const next = game({ id: "next", date: "2026-10-01", startTime: "19:30" });
    expect(canAdminOperateTeamsOnGame(g, [g, next], AFTER_KICKOFF)).toBe(true);
    expect(canAdminOperateTeamsOnGame(g, [g, next], AFTER_22)).toBe(false);
  });

  it("still allows nearest upcoming before its kickoff", () => {
    const next = game({ id: "next", date: "2026-10-01", startTime: "19:30" });
    expect(
      canAdminOperateTeamsOnGame(next, [tonight(), next], AFTER_KICKOFF)
    ).toBe(true);
  });

  it("Admin Teams focus prefers in-progress game over next week", () => {
    const g = tonight();
    const next = game({ id: "next", date: "2026-10-01", startTime: "19:30" });
    expect(adminTeamsFocusGame([g, next], AFTER_KICKOFF)?.id).toBe("tonight");
    expect(adminTeamsFocusGame([g, next], AFTER_22)?.id).toBe("next");
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

    // Player marked Not playing → drops from eligible pool
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

    // Composition membership is preserved (stale flag only — no regen)
    expect(teams.teamA.map((m) => m.playerId)).toEqual(["a", "b"]);
    expect(teams.teamB.map((m) => m.playerId)).toEqual(["c", "d"]);
  });
});
