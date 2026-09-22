import { NOTIFICATION_TIMEZONE } from "./defaults";

/**
 * Convert a Vancouver local calendar date + HH:mm wall time to a UTC Date.
 * Handles PST/PDT via Intl — no manual UTC offsets.
 */
export function vancouverLocalToUtc(
  dateYYYYMMDD: string,
  timeHHmm: string,
  timeZone: string = NOTIFICATION_TIMEZONE
): Date {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const [hh, mm] = timeHHmm.split(":").map(Number);
  if (!y || !m || !d || !Number.isFinite(hh) || !Number.isFinite(mm)) {
    throw new Error(`Invalid Vancouver local datetime: ${dateYYYYMMDD} ${timeHHmm}`);
  }

  // Initial guess: treat components as UTC, then correct by zone offset.
  let utcMs = Date.UTC(y, m - 1, d, hh, mm, 0, 0);

  for (let i = 0; i < 4; i++) {
    const parts = getZonedParts(new Date(utcMs), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const desired = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
    const delta = desired - asUtc;
    if (delta === 0) break;
    utcMs += delta;
  }

  return new Date(utcMs);
}

export function getZonedParts(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** YYYY-MM-DD in the given IANA timezone. */
export function zonedCalendarDate(
  date: Date,
  timeZone: string = NOTIFICATION_TIMEZONE
): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Add (or subtract) whole calendar days from YYYY-MM-DD. */
export function addCalendarDays(dateYYYYMMDD: string, days: number): string {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function parseTimeLocal(timeLocal: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeLocal.trim());
  if (!match) throw new Error(`Invalid timeLocal: ${timeLocal}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid timeLocal: ${timeLocal}`);
  }
  return { hour, minute };
}

/** Format HH:mm for display as h:mm AM/PM. */
export function formatTimeLocal12(timeHHmm: string): string {
  const { hour, minute } = parseTimeLocal(timeHHmm);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}
