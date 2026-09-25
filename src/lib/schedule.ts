import type { AttendanceStatus, Game, GameStatus, Player } from "./types";
import { vancouverLocalToUtc } from "./notifications/timezone";

/** IANA zone for all game wall-clock times (kickoff, nearest-game, locks). */
export const GAME_TIMEZONE = "America/Vancouver" as const;

export interface WeeklyScheduleInput {
  firstDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime?: string | null;
  location: string;
  weeks: number;
  seasonId: string;
  createdBy: string;
  /** Optional stable prefix so IDs are unique per submit */
  idBase?: string;
}

export interface AttendanceGroups {
  playing: Player[];
  maybe: Player[];
  notPlaying: Player[];
  noResponse: Player[];
}

/** Derive a season id like `2026-2027` (Aug–Jul style) for architecture readiness. */
export function seasonIdForDate(dateYYYYMMDD: string): string {
  const [yStr, mStr] = dateYYYYMMDD.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) throw new Error(`Invalid date: ${dateYYYYMMDD}`);
  if (m >= 8) return `${y}-${y + 1}`;
  return `${y - 1}-${y}`;
}

/** Add n days to YYYY-MM-DD using UTC noon to avoid DST edge cases. */
export function addDaysYYYYMMDD(dateYYYYMMDD: string, days: number): string {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Create N independent weekly game records at 7-day intervals.
 * Not a recurring-calendar engine — one-shot generation only.
 */
export function buildWeeklyGames(input: WeeklyScheduleInput): Game[] {
  const weeks = Math.floor(input.weeks);
  if (!Number.isFinite(weeks) || weeks < 1) {
    throw new Error("Number of weeks must be at least 1");
  }
  if (weeks > 52) {
    throw new Error("Number of weeks cannot exceed 52");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.firstDate)) {
    throw new Error("firstDate must be YYYY-MM-DD");
  }
  if (!input.location.trim()) {
    throw new Error("Location is required");
  }

  const now = new Date().toISOString();
  const idBase = input.idBase ?? `g_${Date.now()}`;

  const games: Game[] = [];
  for (let i = 0; i < weeks; i++) {
    const date = addDaysYYYYMMDD(input.firstDate, i * 7);
    games.push({
      id: `${idBase}_${i + 1}`,
      date,
      startTime: input.startTime,
      endTime: input.endTime ?? null,
      location: input.location.trim(),
      status: "scheduled",
      noGame: false,
      seasonId: input.seasonId,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      teamsMayBeStale: false,
      teamsStatusMessage: null,
      lastAttendanceChange: null,
    });
  }
  return games;
}

export function buildSingleGame(input: {
  date: string;
  startTime: string;
  endTime?: string | null;
  location: string;
  seasonId: string;
  createdBy: string;
  id?: string;
  existing?: Game | null;
}): Game {
  const now = new Date().toISOString();
  const existing = input.existing ?? null;
  return {
    id: input.id ?? existing?.id ?? `g_${Date.now()}`,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime ?? null,
    location: input.location.trim(),
    status: existing?.status ?? "scheduled",
    noGame: existing?.noGame ?? false,
    seasonId: input.seasonId || existing?.seasonId || seasonIdForDate(input.date),
    createdBy: existing?.createdBy ?? input.createdBy,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    teamsMayBeStale: existing?.teamsMayBeStale ?? false,
    teamsStatusMessage: existing?.teamsStatusMessage ?? null,
    lastAttendanceChange: existing?.lastAttendanceChange ?? null,
  };
}

/** Edit one game in a list without mutating siblings (independence after weekly create). */
export function updateGameInList(
  games: Game[],
  gameId: string,
  patch: Partial<Pick<Game, "date" | "startTime" | "endTime" | "location" | "status" | "seasonId">>
): Game[] {
  return games.map((g) => {
    if (g.id !== gameId) return g;
    return {
      ...g,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function cancelGameInList(games: Game[], gameId: string): Game[] {
  return updateGameInList(games, gameId, { status: "cancelled" });
}

export function deleteGameFromList(games: Game[], gameId: string): Game[] {
  return games.filter((g) => g.id !== gameId);
}

export function splitUpcomingPast(
  games: Game[],
  todayYYYYMMDD: string = new Date().toISOString().slice(0, 10)
): { upcoming: Game[]; past: Game[] } {
  const upcoming: Game[] = [];
  const past: Game[] = [];

  for (const g of games) {
    if (g.status === "cancelled" || g.date < todayYYYYMMDD) {
      past.push(g);
    } else {
      upcoming.push(g);
    }
  }

  upcoming.sort((a, b) =>
    a.date === b.date
      ? a.startTime.localeCompare(b.startTime)
      : a.date.localeCompare(b.date)
  );
  past.sort((a, b) =>
    a.date === b.date
      ? b.startTime.localeCompare(a.startTime)
      : b.date.localeCompare(a.date)
  );

  return { upcoming, past };
}

export function groupAttendanceByStatus(
  players: Player[],
  attendanceByPlayerId: Map<string, AttendanceStatus>
): AttendanceGroups {
  const playing: Player[] = [];
  const maybe: Player[] = [];
  const notPlaying: Player[] = [];
  const noResponse: Player[] = [];

  for (const p of players) {
    const status = attendanceByPlayerId.get(p.id) ?? "no_response";
    if (status === "playing") playing.push(p);
    else if (status === "maybe") maybe.push(p);
    else if (status === "not_playing") notPlaying.push(p);
    else noResponse.push(p);
  }

  const byName = (a: Player, b: Player) =>
    a.displayName.localeCompare(b.displayName);
  playing.sort(byName);
  maybe.sort(byName);
  notPlaying.sort(byName);
  noResponse.sort(byName);

  return { playing, maybe, notPlaying, noResponse };
}

export function playingPlayerIds(
  players: Player[],
  attendanceByPlayerId: Map<string, AttendanceStatus>
): string[] {
  return groupAttendanceByStatus(players, attendanceByPlayerId).playing.map(
    (p) => p.id
  );
}

export function formatDisplayDate(dateYYYYMMDD: string): string {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Compact column header like the sheet: `Sep-24`. */
export function formatShortDate(
  dateYYYYMMDD: string,
  options?: { includeYear?: boolean }
): string {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const month = dt.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  if (options?.includeYear) {
    return `${month}-${d}-${y}`;
  }
  return `${month}-${d}`;
}

/**
 * Attendance column label. Includes year when the visible set spans multiple
 * years so chronological order is never ambiguous (e.g. Aug-1-2099 after Nov-5-2026).
 */
export function formatAttendanceColumnDate(
  dateYYYYMMDD: string,
  allGameDates: string[]
): string {
  const years = new Set(
    allGameDates.map((d) => d.slice(0, 4)).filter((y) => /^\d{4}$/.test(y))
  );
  return formatShortDate(dateYYYYMMDD, { includeYear: years.size > 1 });
}

/** Sort by full game date then startTime (never by display label). */
export function compareGamesByDateTime(
  a: { date: string; startTime: string },
  b: { date: string; startTime: string }
): number {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) return byDate;
  return (a.startTime || "").localeCompare(b.startTime || "");
}

export function formatDisplayTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function gamesForSeason(games: Game[], seasonId: string): Game[] {
  return games.filter((g) => g.seasonId === seasonId);
}

/** Local start datetime ms for a game (date + startTime) in America/Vancouver. */
export function gameStartMs(
  game: Pick<Game, "date" | "startTime">
): number {
  return vancouverLocalToUtc(
    game.date,
    game.startTime || "00:00",
    GAME_TIMEZONE
  ).getTime();
}

/** True while the game's local start datetime is still in the future. */
export function gameHasNotStarted(
  game: Pick<Game, "date" | "startTime">,
  now = new Date()
): boolean {
  return gameStartMs(game) > now.getTime();
}

/** True when the weekly slot is an active game (not cancelled, not No Game). */
export function isPlayableGame(
  game: Pick<Game, "status" | "noGame">
): boolean {
  return game.status === "scheduled" && !Boolean(game.noGame);
}

/**
 * Nearest upcoming scheduled game that has not started yet and is not No Game.
 * Teams panel always follows this game.
 */
export function nextUpcomingGame<
  T extends Pick<Game, "id" | "date" | "startTime" | "status" | "noGame">,
>(games: T[], now = new Date()): T | null {
  const upcoming = games
    .filter((g) => isPlayableGame(g) && gameHasNotStarted(g, now))
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.startTime.localeCompare(b.startTime);
    });
  return upcoming[0] ?? null;
}

export type { GameStatus };
