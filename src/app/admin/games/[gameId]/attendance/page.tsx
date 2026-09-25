"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import {
  listAttendanceForGame,
  listGames,
  listPlayers,
  nextUpcomingGame,
} from "@/lib/firebase/data";
import { setAttendanceAndSync } from "@/lib/firebase/attendance-api";
import {
  formatDisplayDate,
  formatDisplayTime,
  formatShortDate,
  formatAttendanceColumnDate,
  compareGamesByDateTime,
} from "@/lib/schedule";
import { canEditAttendanceOnGame } from "@/lib/no-game";
import type { AttendanceStatus, Game, Player } from "@/lib/types";
import { formatUnknownError } from "@/lib/errors";

const STATUS_OPTIONS: {
  value: AttendanceStatus;
  label: string;
  short: string;
}[] = [
  { value: "playing", label: "Playing", short: "Playing" },
  { value: "maybe", label: "Maybe", short: "Maybe" },
  { value: "not_playing", label: "Not playing", short: "Not playing" },
  { value: "no_response", label: "No response", short: "—" },
];

function statusClass(status: AttendanceStatus): string {
  if (status === "playing") {
    return "border-green-500/50 bg-green-500/25 text-green-100";
  }
  if (status === "maybe") {
    return "border-amber-500/50 bg-amber-500/20 text-amber-100";
  }
  if (status === "not_playing") {
    return "border-red-500/50 bg-red-500/25 text-red-100";
  }
  return "border-slate-600 bg-slate-800/80 text-slate-300";
}

/** gameId → playerId → status */
type AttendanceGrid = Record<string, Record<string, AttendanceStatus>>;

function AttendanceContent() {
  const { gameId: routeGameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [grid, setGrid] = useState<AttendanceGrid>({});
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const db = getClientDb();
    const [allGames, allPlayers] = await Promise.all([
      listGames(db),
      listPlayers(db),
    ]);

    const scheduled = allGames
      .filter((g) => g.status === "scheduled")
      .sort(compareGamesByDateTime);

    const activePlayers = allPlayers
      .filter((p) => p.active)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const attendanceByGame = await Promise.all(
      scheduled.map(async (g) => {
        const records = await listAttendanceForGame(db, g.id);
        const byPlayer: Record<string, AttendanceStatus> = {};
        for (const r of records) {
          byPlayer[r.playerId] = r.status;
        }
        return [g.id, byPlayer] as const;
      })
    );

    const nextGrid: AttendanceGrid = {};
    for (const [id, byPlayer] of attendanceByGame) {
      nextGrid[id] = byPlayer;
    }

    setGames(scheduled);
    setPlayers(activePlayers);
    setGrid(nextGrid);
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(formatUnknownError(e)));
  }, [reload]);

  useEffect(() => {
    if (!loaded || games.length === 0) return;

    const routeOk = games.some((g) => g.id === routeGameId);
    if (routeOk) {
      setSelectedGameId(routeGameId);
      return;
    }

    const nearest = nextUpcomingGame(games);
    const fallback = nearest?.id ?? games[0]?.id ?? null;
    setSelectedGameId(fallback);
    if (fallback && fallback !== routeGameId) {
      router.replace(`/admin/games/${fallback}/attendance`);
    }
  }, [loaded, games, routeGameId, router]);

  const selectedGame = useMemo(
    () => games.find((g) => g.id === selectedGameId) ?? null,
    [games, selectedGameId]
  );

  const selectedIndex = useMemo(() => {
    if (!selectedGameId) return -1;
    return games.findIndex((g) => g.id === selectedGameId);
  }, [games, selectedGameId]);

  function selectGame(id: string) {
    setSelectedGameId(id);
    router.replace(`/admin/games/${id}/attendance`);
  }

  function goRelative(delta: number) {
    if (selectedIndex < 0) return;
    const next = games[selectedIndex + delta];
    if (next) selectGame(next.id);
  }

  function cellStatus(gId: string, playerId: string): AttendanceStatus {
    return grid[gId]?.[playerId] ?? "no_response";
  }

  async function changeStatus(
    gId: string,
    playerId: string,
    status: AttendanceStatus
  ) {
    if (!user) return;
    const game = games.find((g) => g.id === gId);
    if (!game || !canEditAttendanceOnGame(game, profile?.role ?? "admin")) {
      setError("Attendance is locked for this game");
      return;
    }
    const key = `${gId}_${playerId}`;
    const prev = cellStatus(gId, playerId);
    if (prev === status) return;

    setError(null);
    setSavingKey(key);
    setGrid((cur) => ({
      ...cur,
      [gId]: { ...(cur[gId] ?? {}), [playerId]: status },
    }));

    try {
      const result = await setAttendanceAndSync(user, gId, playerId, status);
      setStatusMessage(result.message);
      // Refresh games so teamsStatusMessage / stale flags stay current.
      await reload();
    } catch (e) {
      setGrid((cur) => ({
        ...cur,
        [gId]: { ...(cur[gId] ?? {}), [playerId]: prev },
      }));
      setError(formatUnknownError(e));
    } finally {
      setSavingKey(null);
    }
  }

  function StatusSelect({
    gameId: gId,
    player,
    compact,
  }: {
    gameId: string;
    player: Player;
    compact?: boolean;
  }) {
    const status = cellStatus(gId, player.id);
    const key = `${gId}_${player.id}`;
    const busy = savingKey === key;
    const game = games.find((g) => g.id === gId);
    const locked =
      !game || !canEditAttendanceOnGame(game, profile?.role ?? "admin");

    return (
      <select
        aria-label={`${player.displayName} attendance`}
        className={`attendance-status ${statusClass(status)} ${
          compact ? "attendance-status-compact" : "attendance-status-row"
        }${locked ? " attendance-badge-locked" : ""}`}
        value={status}
        disabled={busy || locked}
        onChange={(e) =>
          changeStatus(gId, player.id, e.target.value as AttendanceStatus)
        }
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {compact ? o.short : o.label}
          </option>
        ))}
      </select>
    );
  }

  if (!loaded) {
    return (
      <>
        <AppNav />
        <p className="text-slate-400">{error || "Loading…"}</p>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <Link href="/admin/games" className="text-sm text-blue-400 hover:underline">
        ← Manage Games
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Attendance</h2>
          <p className="text-sm text-slate-400">
            Players × games — same workflow as the team sheet.
          </p>
        </div>
        {selectedGame && (
          <Link
            href={`/admin/games/${selectedGame.id}/teams`}
            className="btn btn-primary"
          >
            Open Team Builder
          </Link>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {statusMessage && (
        <p className="mt-2 text-sm text-green-400">{statusMessage}</p>
      )}
      {selectedGame?.teamsStatusMessage && (
        <p className="mt-1 text-sm text-slate-300">
          {selectedGame.teamsStatusMessage}
          {selectedGame.lastAttendanceChange
            ? ` (${selectedGame.lastAttendanceChange.displayName}: ${
                selectedGame.lastAttendanceChange.previousStatus ?? "—"
              } → ${selectedGame.lastAttendanceChange.nextStatus})`
            : ""}
        </p>
      )}
      {selectedGame?.teamsMayBeStale && (
        <p className="mt-1 text-sm text-amber-300">
          Attendance changed. Teams need update — open Team Builder to regenerate.
        </p>
      )}

      {games.length === 0 ? (
        <p className="card mt-4 text-slate-400">
          No scheduled games yet. Create games first, then mark attendance here.
        </p>
      ) : (
        <>
          {/* Mobile: one game at a time */}
          <div className="mt-4 md:hidden">
            <div className="card space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-3"
                  disabled={selectedIndex <= 0}
                  onClick={() => goRelative(-1)}
                  aria-label="Previous game"
                >
                  ‹
                </button>
                <label className="sr-only" htmlFor="mobile-game-select">
                  Select game
                </label>
                <select
                  id="mobile-game-select"
                  className="input flex-1 text-center font-semibold"
                  value={selectedGameId ?? ""}
                  onChange={(e) => selectGame(e.target.value)}
                >
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {formatShortDate(g.date)} · {formatDisplayTime(g.startTime)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary px-3"
                  disabled={
                    selectedIndex < 0 || selectedIndex >= games.length - 1
                  }
                  onClick={() => goRelative(1)}
                  aria-label="Next game"
                >
                  ›
                </button>
              </div>

              {selectedGame && (
                <p className="text-center text-xs text-slate-400">
                  {formatDisplayDate(selectedGame.date)} ·{" "}
                  {selectedGame.location}
                  {selectedGame.teamsMayBeStale
                    ? " · teams may be stale"
                    : ""}
                </p>
              )}
            </div>

            {selectedGame && (
              <ul className="mt-3 divide-y divide-slate-700 rounded-lg border border-slate-700 bg-slate-900">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-3 py-3"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {p.displayName}
                    </span>
                    <div className="w-[9.5rem] shrink-0">
                      <StatusSelect
                        gameId={selectedGame.id}
                        player={p}
                        compact={false}
                      />
                    </div>
                  </li>
                ))}
                {players.length === 0 && (
                  <li className="px-3 py-4 text-sm text-slate-500">
                    No active players.
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Desktop: spreadsheet matrix */}
          <div className="mt-4 hidden md:block">
            <div className="attendance-sheet overflow-x-auto rounded-lg border border-slate-700">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-950">
                    <th className="attendance-corner sticky left-0 z-20 border-b border-r border-slate-700 px-3 py-2 text-left font-semibold text-slate-300">
                      Player
                    </th>
                    {games.map((g) => (
                      <th
                        key={g.id}
                        className={`border-b border-slate-700 px-2 py-2 text-center font-semibold ${
                          g.id === selectedGameId
                            ? "bg-blue-600/20 text-blue-100"
                            : "text-slate-300"
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full min-w-[5.5rem] hover:text-white"
                          onClick={() => selectGame(g.id)}
                          title={`${formatDisplayDate(g.date)} · ${formatDisplayTime(g.startTime)} · ${g.location}`}
                        >
                          {formatAttendanceColumnDate(
                            g.date,
                            games.map((x) => x.date)
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.id} className="odd:bg-slate-900/40">
                      <th className="attendance-player sticky left-0 z-10 border-b border-r border-slate-700 px-3 py-1.5 text-left font-medium text-slate-100">
                        {p.displayName}
                      </th>
                      {games.map((g) => (
                        <td
                          key={g.id}
                          className="border-b border-slate-800 px-1.5 py-1.5 text-center"
                        >
                          <StatusSelect
                            gameId={g.id}
                            player={p}
                            compact
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {players.length === 0 && (
                    <tr>
                      <td
                        colSpan={games.length + 1}
                        className="px-3 py-6 text-center text-slate-500"
                      >
                        No active players.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Tip: each cell is a dropdown — Playing (green), Not playing (red),
              No response (neutral). Scroll horizontally for more dates.
            </p>
          </div>
        </>
      )}
    </>
  );
}

export default function AdminAttendancePage() {
  return (
    <RequireAuth adminOnly>
      <AttendanceContent />
    </RequireAuth>
  );
}
