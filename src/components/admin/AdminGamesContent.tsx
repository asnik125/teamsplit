"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/PageHeading";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import {
  cancelGame,
  deleteGame,
  getAppSettings,
  listGames,
  saveAppSettings,
  upsertGame,
  upsertGames,
} from "@/lib/firebase/data";
import {
  buildSingleGame,
  buildWeeklyGames,
  formatDisplayDate,
  formatDisplayTime,
  seasonIdForDate,
  splitUpcomingPast,
} from "@/lib/schedule";
import type { Game } from "@/lib/types";
import { formatUnknownError } from "@/lib/errors";
import { DEFAULT_MIN_PLAYING_FOR_TEAMS } from "@/lib/team-sync";

type CreateMode = "single" | "weekly";

/** Keep values compatible with <input type="time"> (HH:mm). */
function toTimeInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/** Open the native date/time picker from a real pointer gesture (whole field). */
function openNativePicker(event: MouseEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  try {
    if (typeof input.showPicker === "function") {
      input.showPicker();
    }
  } catch {
    // CSS full-field ::-webkit-calendar-picker-indicator remains as fallback.
  }
}

export function AdminGamesContent() {
  const { user } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [mode, setMode] = useState<CreateMode>("weekly");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("Gym");
  const [weeks, setWeeks] = useState(10);
  const [seasonId, setSeasonId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [minPlaying, setMinPlaying] = useState(DEFAULT_MIN_PLAYING_FOR_TEAMS);
  const [minPlayingDraft, setMinPlayingDraft] = useState(
    String(DEFAULT_MIN_PLAYING_FOR_TEAMS)
  );
  const [allowEditOthers, setAllowEditOthers] = useState(true);
  const editFormRef = useRef<HTMLFormElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  async function reload() {
    const db = getClientDb();
    const [g, settings] = await Promise.all([
      listGames(db),
      getAppSettings(db),
    ]);
    setGames(g);
    setMinPlaying(settings.minPlayingForTeams);
    setMinPlayingDraft(String(settings.minPlayingForTeams));
    setAllowEditOthers(settings.allowPlayersEditOthersAttendance);
  }

  useEffect(() => {
    reload().catch((e) => setError(formatUnknownError(e)));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#create-game") return;
    const el = document.getElementById("create-game");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (date && !editingId) {
      setSeasonId(seasonIdForDate(date));
    }
  }, [date, editingId]);

  useEffect(() => {
    if (!editingId) return;
    const form = editFormRef.current;
    form?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // Focus date so the native picker is one tap/click away.
    window.setTimeout(() => dateInputRef.current?.focus(), 50);
  }, [editingId]);

  const { upcoming, past } = useMemo(
    () => splitUpcomingPast(games),
    [games]
  );

  const editingGame = editingId
    ? games.find((g) => g.id === editingId) ?? null
    : null;

  function startEdit(g: Game) {
    setEditingId(g.id);
    setMode("single");
    setDate(g.date);
    setStartTime(toTimeInputValue(g.startTime) || "19:00");
    setEndTime(toTimeInputValue(g.endTime));
    setLocation(g.location);
    setSeasonId(g.seasonId);
    setError(null);
    setMessage(null);
  }

  function resetForm() {
    setEditingId(null);
    setDate("");
    setStartTime("19:00");
    setEndTime("");
    setLocation("Gym");
    setWeeks(10);
    setSeasonId("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setMessage(null);

    try {
      const db = getClientDb();
      const resolvedSeason = seasonId.trim() || seasonIdForDate(date);
      const normalizedStart = toTimeInputValue(startTime);
      const normalizedEnd = toTimeInputValue(endTime) || null;

      if (!normalizedStart) {
        setError("Start time is required.");
        return;
      }

      if (editingId) {
        const existing = games.find((g) => g.id === editingId) ?? null;
        if (!existing) {
          setError("That game is no longer available. Refresh and try again.");
          return;
        }
        const game = buildSingleGame({
          date,
          startTime: normalizedStart,
          endTime: normalizedEnd,
          location,
          seasonId: resolvedSeason || existing.seasonId,
          createdBy: user.uid,
          id: editingId,
          existing,
        });
        await upsertGame(db, game);
        setMessage(
          `Updated only ${formatDisplayDate(game.date)} (${game.location}). Other games were not changed.`
        );
        resetForm();
      } else if (mode === "weekly") {
        const created = buildWeeklyGames({
          firstDate: date,
          startTime: normalizedStart,
          endTime: normalizedEnd,
          location,
          weeks,
          seasonId: resolvedSeason,
          createdBy: user.uid,
        });
        await upsertGames(db, created);
        setMessage(
          `Created ${created.length} weekly games (${created[0].date} → ${created[created.length - 1].date}). Each game is independent.`
        );
        resetForm();
      } else {
        const game = buildSingleGame({
          date,
          startTime: normalizedStart,
          endTime: normalizedEnd,
          location,
          seasonId: resolvedSeason,
          createdBy: user.uid,
        });
        await upsertGame(db, game);
        setMessage(`Created game on ${formatDisplayDate(game.date)}.`);
        resetForm();
      }

      await reload();
    } catch (err) {
      setError(formatUnknownError(err));
    }
  }

  async function onCancel(g: Game) {
    if (!confirm(`Cancel game on ${g.date}? Other games are not affected.`)) {
      return;
    }
    await cancelGame(getClientDb(), g.id);
    if (editingId === g.id) resetForm();
    await reload();
  }

  async function onDelete(g: Game) {
    if (
      !confirm(
        `Permanently delete game on ${g.date}? Attendance/teams for this game id may remain orphaned. Continue?`
      )
    ) {
      return;
    }
    await deleteGame(getClientDb(), g.id);
    if (editingId === g.id) resetForm();
    await reload();
  }

  async function onSaveMinPlaying() {
    if (!user) return;
    const parsed = Number(minPlayingDraft);
    if (!Number.isFinite(parsed) || parsed < 2 || parsed > 50) {
      setError("Minimum players must be a number from 2 to 50.");
      return;
    }
    setError(null);
    const value = Math.floor(parsed);
    await saveAppSettings(getClientDb(), {
      minPlayingForTeams: value,
      allowPlayersEditOthersAttendance: allowEditOthers,
      updatedAt: new Date().toISOString(),
      updatedBy: user.uid,
    });
    setMinPlaying(value);
    setMinPlayingDraft(String(value));
    setMessage(
      `Saved: teams need ${value}+ included players; players ${
        allowEditOthers ? "can" : "cannot"
      } edit others' attendance.`
    );
  }

  async function onToggleAllowEditOthers(next: boolean) {
    if (!user) return;
    setAllowEditOthers(next);
    setError(null);
    await saveAppSettings(getClientDb(), {
      minPlayingForTeams: minPlaying,
      allowPlayersEditOthersAttendance: next,
      updatedAt: new Date().toISOString(),
      updatedBy: user.uid,
    });
    setMessage(
      next
        ? "Players can change anyone's attendance."
        : "Players can change only their own attendance."
    );
  }

  function renderGameFields(opts: { editing: boolean }) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={opts.editing ? "edit-game-date" : "create-game-date"}>
            {mode === "weekly" && !opts.editing ? "First game date" : "Date"}
          </label>
          <input
            id={opts.editing ? "edit-game-date" : "create-game-date"}
            ref={opts.editing ? dateInputRef : undefined}
            className="input input-picker"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onMouseDown={openNativePicker}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor={opts.editing ? "edit-game-location" : "create-game-location"}>
            Location
          </label>
          <input
            id={opts.editing ? "edit-game-location" : "create-game-location"}
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            required
            placeholder="Gym"
          />
        </div>
        <div>
          <label className="label" htmlFor={opts.editing ? "edit-game-start" : "create-game-start"}>
            Start time
          </label>
          <input
            id={opts.editing ? "edit-game-start" : "create-game-start"}
            className="input input-picker"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            onMouseDown={openNativePicker}
            required
            step={60}
          />
        </div>
        <div>
          <label className="label" htmlFor={opts.editing ? "edit-game-end" : "create-game-end"}>
            End time (optional)
          </label>
          <input
            id={opts.editing ? "edit-game-end" : "create-game-end"}
            className="input input-picker"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            onMouseDown={openNativePicker}
            step={60}
          />
        </div>
        {mode === "weekly" && !opts.editing && (
          <div>
            <label className="label" htmlFor="create-game-weeks">
              Number of weeks
            </label>
            <input
              id="create-game-weeks"
              className="input"
              type="number"
              min={1}
              max={52}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Creates that many independent games, one week apart (e.g. 3, 5,
              10).
            </p>
          </div>
        )}
        {!opts.editing && (
          <div>
            <label className="label" htmlFor="create-game-season">
              Season ID
            </label>
            <input
              id="create-game-season"
              className="input"
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
              placeholder="2026-2027"
              required
            />
          </div>
        )}
      </div>
    );
  }

  function GameList({
    title,
    items,
  }: {
    title: string;
    items: Game[];
  }) {
    return (
      <section className="mt-8">
        <h3 className="mb-3 text-lg font-semibold">{title}</h3>
        {items.length === 0 ? (
          <p className="card text-slate-400">None.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((g) => (
              <li key={g.id} className="card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {formatDisplayDate(g.date)}
                      {g.status === "cancelled" && (
                        <span className="ml-2 text-red-400">(cancelled)</span>
                      )}
                      {g.teamsMayBeStale && (
                        <span className="ml-2 text-xs text-amber-400">
                          teams may be stale
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-slate-300">
                      {formatDisplayTime(g.startTime)}
                      {g.endTime ? ` – ${formatDisplayTime(g.endTime)}` : ""}
                    </p>
                    <p className="text-sm text-slate-400">
                      {g.location} · Season {g.seasonId}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/games/${g.id}/attendance`}
                      className="btn btn-secondary"
                    >
                      Attendance
                    </Link>
                    <Link
                      href={`/admin/games/${g.id}/teams`}
                      className="btn btn-primary"
                    >
                      Teams
                    </Link>
                    {g.status === "scheduled" && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => startEdit(g)}
                      >
                        Edit
                      </button>
                    )}
                    {g.status === "scheduled" && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => onCancel(g)}
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onDelete(g)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {editingId === g.id && (
                  <form
                    ref={editFormRef}
                    id="edit-game"
                    onSubmit={onSubmit}
                    className="space-y-3 rounded-md border border-blue-500/50 bg-slate-950/60 p-3"
                  >
                    <h4 className="font-semibold text-blue-300">
                      Edit this game only
                    </h4>
                    <p className="text-xs text-slate-400">
                      Changes apply only to {formatDisplayDate(g.date)}. Other
                      games from a weekly series stay unchanged.
                    </p>
                    {renderGameFields({ editing: true })}
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className="btn btn-primary">
                        Save changes
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={resetForm}
                      >
                        Cancel edit
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <>
      <PageHeading>Manage Games</PageHeading>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {message && <p className="mb-2 text-sm text-green-400">{message}</p>}

      <div className="card mb-6 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="min-playing-teams">
              Minimum included players for auto teams
            </label>
            <input
              id="min-playing-teams"
              className="input w-28"
              type="number"
              min={2}
              max={50}
              value={minPlayingDraft}
              onChange={(e) => setMinPlayingDraft(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onSaveMinPlaying()}
          >
            Save minimum
          </button>
          <p className="text-xs text-slate-500">
            Current minimum: {minPlaying} (default 6). Use Game page for
            attendance &amp; teams.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={allowEditOthers}
            onChange={(e) => onToggleAllowEditOthers(e.target.checked)}
          />
          Allow players to change other players&apos; attendance
        </label>
      </div>

      {!editingId && (
        <form
          id="create-game"
          onSubmit={onSubmit}
          className="card mb-6 scroll-mt-6 space-y-3"
        >
          <h3 className="font-semibold">Create games</h3>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`btn ${mode === "single" ? "btn-blue" : "btn-secondary"}`}
              onClick={() => setMode("single")}
            >
              Single game
            </button>
            <button
              type="button"
              className={`btn ${mode === "weekly" ? "btn-blue" : "btn-secondary"}`}
              onClick={() => setMode("weekly")}
            >
              Weekly series
            </button>
          </div>

          {renderGameFields({ editing: false })}

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary">
              {mode === "weekly"
                ? `Create ${weeks} weekly games`
                : "Create game"}
            </button>
          </div>
        </form>
      )}

      {editingId && editingGame && (
        <p className="mb-3 text-sm text-blue-300">
          Editing {formatDisplayDate(editingGame.date)} — scroll to that game’s
          form below, or{" "}
          <button type="button" className="underline" onClick={resetForm}>
            cancel edit
          </button>
          .
        </p>
      )}

      <GameList title="Upcoming" items={upcoming} />
      <GameList title="Past / history" items={past} />
    </>
  );
}

