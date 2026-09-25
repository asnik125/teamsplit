import type { AttendanceStatus, Game, UserRole } from "./types";
import { GAME_TIMEZONE, gameHasNotStarted, nextUpcomingGame } from "./schedule";
import { vancouverLocalToUtc } from "./notifications/timezone";

/** Missing/undefined `noGame` is treated as false. */
export function gameHasNoGame(game: Pick<Game, "noGame"> | { noGame?: boolean }): boolean {
  return Boolean(game.noGame);
}

/**
 * Admin/Owner may edit attendance after kickoff until this local time
 * on the game date (America/Vancouver).
 */
export const ATTENDANCE_ADMIN_LOCK_LOCAL_TIME = "22:00";

/** Instant when post-kickoff Admin attendance edits lock (22:00 Vancouver). */
export function attendanceAdminLockAtMs(game: Pick<Game, "date">): number {
  return vancouverLocalToUtc(
    game.date,
    ATTENDANCE_ADMIN_LOCK_LOCAL_TIME,
    GAME_TIMEZONE
  ).getTime();
}

/** Admin and Owner may continue editing after kickoff (until 22:00). */
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
 * - After kickoff until 22:00 Vancouver on the game date: Admin/Owner only
 * - After 22:00 Vancouver on the game date: locked for everyone
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
 * - the in-progress game until 22:00 Vancouver on its date (post-kickoff repair).
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
 * Which game the Admin Teams panel should follow.
 * Prefer tonight's in-progress game until 22:00 Vancouver; otherwise nearest upcoming.
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
