import type { AttendanceStatus, Game, UserRole } from "./types";

/** Missing/undefined `noGame` is treated as false. */
export function gameHasNoGame(game: Pick<Game, "noGame"> | { noGame?: boolean }): boolean {
  return Boolean(game.noGame);
}

/** Attendance edits are locked when the date is No Game (Admin and Players). */
export function canEditAttendanceOnGame(
  game: Pick<Game, "status" | "noGame">
): boolean {
  return game.status === "scheduled" && !gameHasNoGame(game);
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
