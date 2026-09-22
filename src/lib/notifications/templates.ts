import type { AttendanceStatus, Game, NotificationType } from "../types";
import { formatDisplayDate, formatDisplayTime } from "../schedule";
import { DEFAULT_MIN_PLAYING_FOR_FINAL } from "./defaults";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function statusLabel(status: AttendanceStatus | null | undefined): string {
  if (status === "playing") return "Playing";
  if (status === "maybe") return "Maybe";
  if (status === "not_playing") return "Not playing";
  if (status === "no_response") return "No response";
  return "Unknown";
}

function openLink(appUrl: string): string {
  return appUrl.replace(/\/$/, "");
}

function wrapHtml(body: string, appUrl: string): string {
  const url = openLink(appUrl);
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;">
  <p><strong>TeamSplit</strong></p>
  ${body}
  <p style="margin-top:1.5rem;">
    <a href="${url}" style="display:inline-block;padding:0.6rem 1rem;background:#16a34a;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;">
      Open TeamSplit
    </a>
  </p>
  <p style="color:#64748b;font-size:12px;">If the button does not work, open: ${url}</p>
</body></html>`;
}

export function buildGameReminderEmail(input: {
  game: Game;
  attendanceStatus: AttendanceStatus | null;
  appUrl: string;
}): EmailContent {
  const { game, attendanceStatus, appUrl } = input;
  const when = `${formatDisplayDate(game.date)} · ${formatDisplayTime(game.startTime)}`;
  const statusLine = attendanceStatus
    ? `Your current attendance: ${statusLabel(attendanceStatus)}`
    : "Your attendance has not been set yet.";
  const subject = "TeamSplit — Game tomorrow";
  const text = [
    "TeamSplit",
    "",
    "Game tomorrow",
    when,
    `Location: ${game.location}`,
    statusLine,
    "",
    "Please check and update your attendance in TeamSplit.",
    openLink(appUrl),
  ].join("\n");
  const html = wrapHtml(
    `<p>Game tomorrow</p>
     <p>${when}<br/>Location: ${escapeHtml(game.location)}</p>
     <p>${escapeHtml(statusLine)}</p>
     <p>Please check and update your attendance in TeamSplit.</p>`,
    appUrl
  );
  return { subject, text, html };
}

export function buildMaybeReminderEmail(input: {
  game: Game;
  appUrl: string;
}): EmailContent {
  const { game, appUrl } = input;
  const when = `${formatDisplayDate(game.date)} · ${formatDisplayTime(game.startTime)}`;
  const subject = "TeamSplit — Are you playing today?";
  const text = [
    "TeamSplit",
    "",
    "Are you playing today?",
    when,
    `Location: ${game.location}`,
    "Your current status is Maybe.",
    "Please confirm Playing or Not playing in TeamSplit.",
    openLink(appUrl),
  ].join("\n");
  const html = wrapHtml(
    `<p>Are you playing today?</p>
     <p>${when}<br/>Location: ${escapeHtml(game.location)}</p>
     <p>Your current status is <strong>Maybe</strong>.</p>
     <p>Please confirm <strong>Playing</strong> or <strong>Not playing</strong> in TeamSplit.</p>`,
    appUrl
  );
  return { subject, text, html };
}

export function buildFinalStatusEmail(input: {
  game: Game;
  playingCount: number;
  minPlaying?: number;
  appUrl: string;
}): EmailContent {
  const minPlaying = input.minPlaying ?? DEFAULT_MIN_PLAYING_FOR_FINAL;
  const { game, playingCount, appUrl } = input;
  const isOn = playingCount >= minPlaying;
  const when = `${formatDisplayDate(game.date)} · ${formatDisplayTime(game.startTime)}`;
  const subject = isOn
    ? "TeamSplit — Game is ON"
    : "TeamSplit — Game is OFF";
  const headline = isOn ? "Game is ON" : "Game is OFF";
  const countLine = isOn
    ? `${playingCount} players confirmed Playing.`
    : `${playingCount} players confirmed Playing (need ${minPlaying}).`;
  const text = [
    "TeamSplit",
    "",
    headline,
    countLine,
    when,
    `Location: ${game.location}`,
    "",
    openLink(appUrl),
  ].join("\n");
  const html = wrapHtml(
    `<p><strong>${headline}</strong></p>
     <p>${escapeHtml(countLine)}</p>
     <p>${when}<br/>Location: ${escapeHtml(game.location)}</p>`,
    appUrl
  );
  return { subject, text, html };
}

export function buildTestEmail(input: {
  from: string;
  environment: string;
  timestampIso: string;
  appUrl: string;
}): EmailContent {
  const subject = "TeamSplit notification test";
  const text = [
    "TeamSplit notification test",
    "",
    `Sender: ${input.from}`,
    `Environment: ${input.environment}`,
    `Timestamp: ${input.timestampIso}`,
    "",
    openLink(input.appUrl),
  ].join("\n");
  const html = wrapHtml(
    `<p><strong>TeamSplit notification test</strong></p>
     <p>Sender: ${escapeHtml(input.from)}<br/>
        Environment: ${escapeHtml(input.environment)}<br/>
        Timestamp: ${escapeHtml(input.timestampIso)}</p>`,
    input.appUrl
  );
  return { subject, text, html };
}

export function buildEmailForType(input: {
  type: NotificationType;
  game: Game;
  attendanceStatus: AttendanceStatus | null;
  playingCount: number;
  minPlaying?: number;
  appUrl: string;
}): EmailContent {
  if (input.type === "game_reminder") {
    return buildGameReminderEmail({
      game: input.game,
      attendanceStatus: input.attendanceStatus,
      appUrl: input.appUrl,
    });
  }
  if (input.type === "maybe_reminder") {
    return buildMaybeReminderEmail({
      game: input.game,
      appUrl: input.appUrl,
    });
  }
  return buildFinalStatusEmail({
    game: input.game,
    playingCount: input.playingCount,
    minPlaying: input.minPlaying,
    appUrl: input.appUrl,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
