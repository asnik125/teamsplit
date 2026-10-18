import type { AttendanceStatus, Game, UserRole } from "./types";
import { GAME_TIMEZONE, gameHasNotStarted, nextUpcomingGame } from "./schedule";
import {
  addCalendarDays,
  vancouverLocalToUtc,
} from "./notifications/timezone";

/** Missing/undefined `noGame` is treated as false. */
export function gameHasNoGame(game: Pick<Game, "noGame"> | { noGame?: boolean }): boolean {
  return Boolean(game.noGame);
}

/**
 * Admin/Owner may edit attendance and operate teams through the end of the
 * game's Vancouver calendar date. The lock instant is 00:00 on the next day
 * (editable until 11:59:59 PM America/Vancouver on the game date).
 */
export const ATTENDANCE_ADMIN_LOCK_LOCAL_TIME = "00:00";

/** Instant when post-kickoff Admin attendance / team ops lock (next-day midnight Vancouver). */
export function attendanceAdminLockAtMs(game: Pick<Game, "date">): number {
  return vancouverLocalToUtc(
    addCalendarDays(game.date, 1),
    ATTENDANCE_ADMIN_LOCK_LOCAL_TIME,
    GAME_TIMEZONE
  ).getTime();
}

/** Admin and Owner may continue editing after kickoff (until end of game date). */
export function roleMayEditAttendanceAfterKickoff(
  role: UserRole | string | null | undefined
): boolean {
  return role === "admin" || role === "owner";
}

/**
 * Whether attendance cells are editable for this role at `now`.
 *
 * - No Game / non-scheduled: locked for everyone
 * - Before kickoff (America/Vancouver): editable (player vs others still gated elsewhere)
 * - After kickoff until end of game date Vancouver: Admin/Owner only
 * - From midnight Vancouver on the next calendar day: locked for everyone
 */
export function canEditAttendanceOnGame(
  game: Pick<Game, "status" | "noGame" | "date" | "startTime">,
  role?: UserRole | string | null,
  now: Date = new Date()
): boolean {
  if (game.status !== "scheduled" || gameHasNoGame(game)) return false;
  if (gameHasNotStarted(game, now)) return true;
  if (!roleMayEditAttendanceAfterKickoff(role)) return false;
  return now.getTime() < attendanceAdminLockAtMs(game);
}

/**
 * Admin team ops (Generate / Include Maybe / manual) for a game:
 * - nearest upcoming playable game (unchanged), or
 * - the in-progress game until end of its Vancouver calendar date.
 */
export function canAdminOperateTeamsOnGame(
  game: Pick<Game, "id" | "status" | "noGame" | "date" | "startTime">,
  allScheduledGames: Pick<
    Game,
    "id" | "status" | "noGame" | "date" | "startTime"
  >[],
  now: Date = new Date()
): boolean {
  if (game.status !== "scheduled" || gameHasNoGame(game)) return false;
  const nearest = nextUpcomingGame(allScheduledGames, now);
  if (nearest?.id === game.id) return true;
  if (gameHasNotStarted(game, now)) return false;
  return now.getTime() < attendanceAdminLockAtMs(game);
}

/**
 * Which game Admin should follow by default (desktop Teams + mobile Admin).
 * Prefer tonight's game through 11:59:59 PM Vancouver; otherwise nearest upcoming.
 * Players continue to use `nextUpcomingGame` only.
 */
export function adminTeamsFocusGame(
  games: Game[],
  now: Date = new Date()
): Game | null {
  const inProgress = games
    .filter(
      (g) =>
        g.status === "scheduled" &&
        !gameHasNoGame(g) &&
        !gameHasNotStarted(g, now) &&
        now.getTime() < attendanceAdminLockAtMs(g)
    )
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return b.startTime.localeCompare(a.startTime);
    });
  if (inProgress[0]) return inProgress[0]!;
  return nextUpcomingGame(games, now);
}

/**
 * Default game id for a session: Admin/Owner keep tonight until midnight;
 * players always follow the next not-yet-started game.
 */
export function defaultFocusedGame(
  games: Game[],
  opts: { adminFocus: boolean; now?: Date }
): Game | null {
  const now = opts.now ?? new Date();
  if (opts.adminFocus) return adminTeamsFocusGame(games, now);
  return nextUpcomingGame(games, now);
}

/** Only Admins may set or clear No Game. */
export function canSetGameNoGame(role: UserRole | string | null | undefined): boolean {
  return role === "admin";
}

/**
 * Display/effective attendance for a cell.
 * No Game dates always show as — regardless of any leftover stored value.
 */
export function effectiveAttendanceStatus(
  game: Pick<Game, "noGame">,
  stored: AttendanceStatus | undefined | null
): AttendanceStatus {
  if (gameHasNoGame(game)) return "no_response";
  return stored ?? "no_response";
}

/**
 * After Admin toggles No Game on, attendance is cleared.
 * After toggle off, previous selections are not restored.
 */
export function attendanceMapAfterNoGameChange(
  _previous: Record<string, AttendanceStatus>,
  enablingNoGame: boolean
): Record<string, AttendanceStatus> {
  void enablingNoGame;
  return {};
}
