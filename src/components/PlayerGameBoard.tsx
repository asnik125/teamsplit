"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import {
  getAppSettings,
  getGameTeams,
  listAttendanceForGame,
  listGames,
  listPlayers,
  nextUpcomingGame,
  saveAppSettings,
} from "@/lib/firebase/data";
import {
  ensureTeamsIntegrityApi,
  regenerateTeamsApi,
  saveManualTeamsApi,
  setAttendanceAndSync,
  setGameNoGameApi,
  setIncludeMaybeApi,
} from "@/lib/firebase/attendance-api";
import {
  buildPlayerGameView,
  type PlayerGameViewModel,
} from "@/lib/player-game-view";
import { DEFAULT_MIN_PLAYING_FOR_TEAMS, isIncludedForTeams } from "@/lib/team-sync";
import {
  formatDisplayDate,
  formatDisplayTime,
  formatShortDate,
  formatAttendanceColumnDate,
  compareGamesByDateTime,
} from "@/lib/schedule";
import {
  canEditAttendanceOnGame,
  effectiveAttendanceStatus,
  gameHasNoGame,
  adminTeamsFocusGame,
} from "@/lib/no-game";
import type {
  AttendanceStatus,
  Game,
  GameTeams,
  Player,
  TeamMemberPublic,
  TeamRatingSystem,
} from "@/lib/types";
import { formatUnknownError } from "@/lib/errors";
import { moveMemberKeepingSizeBalance } from "@/lib/balancer";

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

function statusText(status: AttendanceStatus): string {
  if (status === "playing") return "Playing";
  if (status === "maybe") return "Maybe";
  if (status === "not_playing") return "Not playing";
  return "—";
}

type AttendanceGrid = Record<string, Record<string, AttendanceStatus>>;
type MobileTab = "attendance" | "teams";

export function PlayerGameBoard() {
  const { user, profile, isAdmin, showAdminUI } = useAuth();
  const myPlayerId = profile?.playerId ?? null;

  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [grid, setGrid] = useState<AttendanceGrid>({});
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [teams, setTeams] = useState<GameTeams | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("attendance");
  const [minPlaying, setMinPlaying] = useState(DEFAULT_MIN_PLAYING_FOR_TEAMS);
  const [allowEditOthers, setAllowEditOthers] = useState(true);
  const [updatingTeams, setUpdatingTeams] = useState(false);
  const [includeMaybe, setIncludeMaybe] = useState(false);
  const [teamRatingSystem, setTeamRatingSystem] =
    useState<TeamRatingSystem>("classic");

  const canEditPlayer = useCallback(
    (playerId: string) => {
      if (isAdmin) return true;
      if (!myPlayerId) return false;
      if (playerId === myPlayerId) return true;
      return allowEditOthers;
    },
    [isAdmin, myPlayerId, allowEditOthers]
  );

  const reload = useCallback(async () => {
    const db = getClientDb();
    const [allGames, allPlayers, settings] = await Promise.all([
      listGames(db),
      listPlayers(db),
      getAppSettings(db),
    ]);
    setMinPlaying(settings.minPlayingForTeams);
    setAllowEditOthers(settings.allowPlayersEditOthersAttendance);
    setTeamRatingSystem(settings.teamRatingSystem);

    const scheduled = allGames
      .filter((g) => g.status === "scheduled")
      .sort(compareGamesByDateTime);

    const activePlayers = allPlayers
      .filter((p) => p.active)
      .sort((a, b) => {
        if (myPlayerId && a.id === myPlayerId) return -1;
        if (myPlayerId && b.id === myPlayerId) return 1;
        return a.displayName.localeCompare(b.displayName);
      });

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
  }, [myPlayerId]);

  useEffect(() => {
    reload().catch((e) => setError(formatUnknownError(e)));
  }, [reload]);

  useEffect(() => {
    if (!loaded || games.length === 0) return;
    setSelectedGameId((prev) => {
      if (prev && games.some((g) => g.id === prev)) return prev;
      return nextUpcomingGame(games)?.id ?? games[0]?.id ?? null;
    });
  }, [loaded, games]);

  const teamsGame = useMemo(
    () =>
      showAdminUI ? adminTeamsFocusGame(games) : nextUpcomingGame(games),
    [games, showAdminUI]
  );
  const teamsGameId = teamsGame?.id ?? null;

  // Teams always load for the nearest upcoming game — not the attendance column selection.
  // Ensure server-side integrity first so ghost inactive/deleted members are repaired in Firestore.
  useEffect(() => {
    if (!teamsGameId) {
      setTeams(null);
      setIncludeMaybe(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (user) {
          await ensureTeamsIntegrityApi(user);
        }
        const t = await getGameTeams(getClientDb(), teamsGameId);
        if (cancelled) return;
        setTeams(t);
        setIncludeMaybe(Boolean(t?.includeMaybePlayers));
      } catch (e) {
        if (!cancelled) setError(formatUnknownError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamsGameId, grid, user]);

  const selectedGame = useMemo(
    () => games.find((g) => g.id === selectedGameId) ?? null,
    [games, selectedGameId]
  );

  const selectedIndex = useMemo(() => {
    if (!selectedGameId) return -1;
    return games.findIndex((g) => g.id === selectedGameId);
  }, [games, selectedGameId]);

  function cellStatus(gId: string, playerId: string): AttendanceStatus {
    const g = games.find((x) => x.id === gId);
    const stored = grid[gId]?.[playerId];
    if (g) return effectiveAttendanceStatus(g, stored);
    return stored ?? "no_response";
  }

  function countIncluded(gId: string, withMaybe: boolean): number {
    const g = games.find((x) => x.id === gId);
    if (g && gameHasNoGame(g)) return 0;
    const byPlayer = grid[gId] ?? {};
    let n = 0;
    for (const p of players) {
      const st = byPlayer[p.id] ?? "no_response";
      if (isIncludedForTeams(st, withMaybe)) n += 1;
    }
    return n;
  }

  async function changeStatus(
    gId: string,
    playerId: string,
    status: AttendanceStatus
  ) {
    if (!user || !canEditPlayer(playerId)) return;
    const game = games.find((g) => g.id === gId);
    if (!game || !canEditAttendanceOnGame(game, profile?.role ?? null)) return;
    const prev = cellStatus(gId, playerId);
    if (prev === status) return;

    const key = `${gId}_${playerId}`;
    setError(null);
    setSavingKey(key);
    setGrid((cur) => ({
      ...cur,
      [gId]: { ...(cur[gId] ?? {}), [playerId]: status },
    }));

    try {
      await setAttendanceAndSync(user, gId, playerId, status);
      await reload();
      if (gId === teamsGameId && teamsGameId) {
        const t = await getGameTeams(getClientDb(), teamsGameId);
        setTeams(t);
        setIncludeMaybe(Boolean(t?.includeMaybePlayers));
      }
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

  async function toggleIncludeMaybe(next: boolean) {
    if (!user || !teamsGameId || !showAdminUI) return;
    setIncludeMaybe(next);
    setError(null);
    try {
      await setIncludeMaybeApi(user, teamsGameId, next);
      const t = await getGameTeams(getClientDb(), teamsGameId);
      setTeams(t);
      setIncludeMaybe(Boolean(t?.includeMaybePlayers));
    } catch (e) {
      setIncludeMaybe(!next);
      setError(formatUnknownError(e));
    }
  }

  async function changeTeamRatingSystem(next: TeamRatingSystem) {
    if (!user || !showAdminUI) return;
    const prev = teamRatingSystem;
    setTeamRatingSystem(next);
    setError(null);
    try {
      await saveAppSettings(getClientDb(), {
        minPlayingForTeams: minPlaying,
        allowPlayersEditOthersAttendance: allowEditOthers,
        teamRatingSystem: next,
        updatedAt: new Date().toISOString(),
        updatedBy: user.uid,
      });
    } catch (e) {
      setTeamRatingSystem(prev);
      setError(formatUnknownError(e));
    }
  }

  async function generateTeams() {
    if (!user || !teamsGameId || !showAdminUI) return;
    setError(null);
    setUpdatingTeams(true);
    try {
      await regenerateTeamsApi(user, teamsGameId);
      const t = await getGameTeams(getClientDb(), teamsGameId);
      setTeams(t);
      setIncludeMaybe(Boolean(t?.includeMaybePlayers));
    } catch (e) {
      setError(formatUnknownError(e));
    } finally {
      setUpdatingTeams(false);
    }
  }

  async function persistManualTeams(
    teamA: TeamMemberPublic[],
    teamB: TeamMemberPublic[]
  ) {
    if (!user || !teamsGameId || !showAdminUI) return;
    setError(null);
    try {
      await saveManualTeamsApi(user, teamsGameId, teamA, teamB);
      setTeams((cur) =>
        cur
          ? {
              ...cur,
              teamA,
              teamB,
              manuallyAdjusted: true,
            }
          : cur
      );
    } catch (e) {
      setError(formatUnknownError(e));
      const t = await getGameTeams(getClientDb(), teamsGameId);
      setTeams(t);
    }
  }

  async function toggleNoGame(gameId: string, noGame: boolean) {
    if (!user || !showAdminUI) return;
    setError(null);
    // Optimistic: mark column + clear local attendance when enabling
    setGames((cur) =>
      cur.map((g) =>
        g.id === gameId
          ? {
              ...g,
              noGame,
              teamsStatusMessage: noGame ? "No game this week" : null,
            }
          : g
      )
    );
    if (noGame) {
      setGrid((cur) => ({ ...cur, [gameId]: {} }));
    }
    try {
      await setGameNoGameApi(user, gameId, noGame);
      await reload();
    } catch (e) {
      setError(formatUnknownError(e));
      await reload();
    }
  }

  function goRelative(delta: number) {
    if (selectedIndex < 0) return;
    const next = games[selectedIndex + delta];
    if (next) setSelectedGameId(next.id);
  }

  const includedCount = teamsGameId
    ? countIncluded(teamsGameId, includeMaybe)
    : 0;
  const playingCount = teamsGameId ? countIncluded(teamsGameId, false) : 0;
  const maybeCount = teamsGameId
    ? players.filter((p) => cellStatus(teamsGameId, p.id) === "maybe").length
    : 0;

  const myStatus =
    teamsGameId && myPlayerId
      ? cellStatus(teamsGameId, myPlayerId)
      : "no_response";

  const teamsView = teamsGame
    ? buildPlayerGameView({
        myStatus,
        myPlayerId,
        playingCount,
        maybeCount,
        includedCount,
        currentTeams: teams,
        minPlaying,
        includeMaybePlayers: includeMaybe,
        isUpdating: updatingTeams,
      })
    : null;

  if (!loaded) {
    return (
      <div className="player-board">
        <p className="text-sm text-slate-400">{error || "Loading…"}</p>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="player-board">
        <div className="panel">
          <div className="panel-body panel-body-pad text-slate-400">
            No scheduled games yet.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="player-board">
      {error && (
        <p className="mb-1 shrink-0 text-xs text-red-400">{error}</p>
      )}

      <div className="player-split hidden md:grid">
        <section className="panel" aria-label="Attendance">
          <div className="panel-header">
            <h2 className="panel-title">Attendance</h2>
          </div>
          <div className="panel-body attendance-grid">
            <AttendanceTable
              games={games}
              players={players}
              selectedGameId={selectedGameId}
              myPlayerId={myPlayerId}
              savingKey={savingKey}
              isAdmin={showAdminUI}
              viewerRole={profile?.role ?? null}
              cellStatus={cellStatus}
              canEditPlayer={canEditPlayer}
              onSelectGame={setSelectedGameId}
              onChangeStatus={changeStatus}
              onToggleNoGame={toggleNoGame}
            />
          </div>
        </section>

        <section className="panel" aria-label="Teams">
          <div className="panel-header">
            <h2 className="panel-title">
              Teams
              {teamsGame ? ` — ${formatShortDate(teamsGame.date)}` : ""}
            </h2>
          </div>
          <div className="panel-body panel-body-pad">
            {teamsGame && teamsView ? (
              <TeamsBody
                game={teamsGame}
                view={teamsView}
                myPlayerId={myPlayerId}
                includeMaybe={includeMaybe}
                isAdmin={showAdminUI}
                showTeamRatingSystem={showAdminUI}
                teamRatingSystem={teamRatingSystem}
                onTeamRatingSystemChange={changeTeamRatingSystem}
                onToggleIncludeMaybe={toggleIncludeMaybe}
                onManualTeams={persistManualTeams}
                onGenerate={generateTeams}
                generating={updatingTeams}
              />
            ) : (
              <p className="teams-note text-slate-400">
                No upcoming game yet.
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 md:hidden">
        <div className="mobile-seg" role="tablist">
          <button
            type="button"
            className={mobileTab === "attendance" ? "active" : ""}
            onClick={() => setMobileTab("attendance")}
          >
            Attendance
          </button>
          <button
            type="button"
            className={mobileTab === "teams" ? "active" : ""}
            onClick={() => setMobileTab("teams")}
          >
            Teams
          </button>
        </div>

        {mobileTab === "attendance" ? (
          <div className="mobile-pane">
            <div className="mobile-date-bar">
              <button
                type="button"
                className="btn btn-secondary px-3"
                disabled={selectedIndex <= 0}
                onClick={() => goRelative(-1)}
              >
                ‹
              </button>
              <div className="center">
                <strong>
                  {selectedGame ? formatShortDate(selectedGame.date) : "—"}
                </strong>
                {selectedGame &&
                  !gameHasNoGame(selectedGame) && (
                    <span>
                      {formatDisplayTime(selectedGame.startTime)} ·{" "}
                      {selectedGame.location}
                    </span>
                  )}
                {selectedGame &&
                  gameHasNoGame(selectedGame) &&
                  !showAdminUI && (
                    <span className="attendance-no-game-label">No Game</span>
                  )}
                {selectedGame && showAdminUI && (
                  <label className="attendance-no-game-control attendance-no-game-control-mobile">
                    <input
                      type="checkbox"
                      checked={gameHasNoGame(selectedGame)}
                      onChange={(e) =>
                        toggleNoGame(selectedGame.id, e.target.checked)
                      }
                    />
                    No Game
                  </label>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary px-3"
                disabled={
                  selectedIndex < 0 || selectedIndex >= games.length - 1
                }
                onClick={() => goRelative(1)}
              >
                ›
              </button>
            </div>
            {selectedGame && (
              <div className="mobile-list">
                {players.map((p) => {
                  const isMe = p.id === myPlayerId;
                  const status = cellStatus(selectedGame.id, p.id);
                  const locked = !canEditAttendanceOnGame(
                    selectedGame,
                    profile?.role ?? null
                  );
                  const editable = canEditPlayer(p.id) && !locked;
                  const busy = savingKey === `${selectedGame.id}_${p.id}`;
                  return (
                    <div
                      key={p.id}
                      className={`mobile-row${isMe ? " mobile-row-me" : ""}`}
                    >
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${
                          isMe ? "font-bold text-white" : "font-medium"
                        }`}
                      >
                        {p.displayName}
                        {isMe ? " (you)" : ""}
                      </span>
                      {editable ? (
                        <select
                          className={`attendance-status attendance-status-row ${statusClass(status)}`}
                          value={status}
                          disabled={busy}
                          onChange={(e) =>
                            changeStatus(
                              selectedGame.id,
                              p.id,
                              e.target.value as AttendanceStatus
                            )
                          }
                        >
                          {STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`attendance-badge ${statusClass(status)}${
                            locked ? " attendance-badge-locked" : ""
                          }`}
                        >
                          {statusText(status)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="mobile-pane">
            <section className="panel flex-1">
              <div className="panel-header">
                <h2 className="panel-title">
                  Teams
                  {teamsGame
                    ? ` — ${formatShortDate(teamsGame.date)}`
                    : ""}
                </h2>
              </div>
              <div className="panel-body panel-body-pad">
                {teamsGame && teamsView ? (
                  <TeamsBody
                    game={teamsGame}
                    view={teamsView}
                    myPlayerId={myPlayerId}
                    includeMaybe={includeMaybe}
                    isAdmin={showAdminUI}
                    showTeamRatingSystem={false}
                    teamRatingSystem={teamRatingSystem}
                    onTeamRatingSystemChange={changeTeamRatingSystem}
                    onToggleIncludeMaybe={toggleIncludeMaybe}
                    onManualTeams={persistManualTeams}
                    onGenerate={generateTeams}
                    generating={updatingTeams}
                  />
                ) : (
                  <p className="teams-note text-slate-400">
                    No upcoming game yet.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function AttendanceTable({
  games,
  players,
  selectedGameId,
  myPlayerId,
  savingKey,
  isAdmin,
  viewerRole,
  cellStatus,
  canEditPlayer,
  onSelectGame,
  onChangeStatus,
  onToggleNoGame,
}: {
  games: Game[];
  players: Player[];
  selectedGameId: string | null;
  myPlayerId: string | null;
  savingKey: string | null;
  isAdmin: boolean;
  viewerRole: string | null;
  cellStatus: (gId: string, playerId: string) => AttendanceStatus;
  canEditPlayer: (playerId: string) => boolean;
  onSelectGame: (id: string) => void;
  onChangeStatus: (
    gId: string,
    playerId: string,
    status: AttendanceStatus
  ) => void;
  onToggleNoGame: (gameId: string, noGame: boolean) => void;
}) {
  return (
    <table className="attendance-sheet">
      <thead>
        <tr>
          <th className="attendance-corner">Player</th>
          {games.map((g) => {
            const noGame = gameHasNoGame(g);
            return (
              <th
                key={g.id}
                className={`${
                  g.id === selectedGameId ? "attendance-date-selected" : ""
                }${noGame ? " attendance-date-no-game" : ""}`}
              >
                <button
                  type="button"
                  className="attendance-date-btn"
                  onClick={() => onSelectGame(g.id)}
                  title={
                    noGame
                      ? `${formatDisplayDate(g.date)} · No Game`
                      : `${formatDisplayDate(g.date)} · ${formatDisplayTime(g.startTime)} · ${g.location}`
                  }
                >
                  {formatAttendanceColumnDate(
                    g.date,
                    games.map((x) => x.date)
                  )}
                </button>
                {isAdmin ? (
                  <label
                    className="attendance-no-game-control"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={noGame}
                      onChange={(e) => onToggleNoGame(g.id, e.target.checked)}
                      aria-label={`No Game ${formatShortDate(g.date)}`}
                    />
                    No Game
                  </label>
                ) : noGame ? (
                  <span className="attendance-no-game-label">No Game</span>
                ) : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {players.map((p, rowIdx) => {
          const isMe = p.id === myPlayerId;
          const rowBg =
            isMe
              ? undefined
              : rowIdx % 2 === 1
                ? "attendance-row-alt"
                : undefined;
          return (
            <tr
              key={p.id}
              className={`${isMe ? "attendance-row-me" : ""} ${rowBg ?? ""}`}
            >
              <th
                className={`attendance-player${isMe ? " attendance-player-me" : ""}`}
              >
                {p.displayName}
                {isMe ? " (you)" : ""}
              </th>
              {games.map((g) => {
                const status = cellStatus(g.id, p.id);
                const busy = savingKey === `${g.id}_${p.id}`;
                const locked = !canEditAttendanceOnGame(g, viewerRole);
                const editable = canEditPlayer(p.id) && !locked;
                return (
                  <td
                    key={g.id}
                    className={`attendance-cell${
                      g.id === selectedGameId ? " attendance-cell-selected" : ""
                    }${locked ? " attendance-cell-locked" : ""}`}
                  >
                    {editable ? (
                      <select
                        aria-label={`${p.displayName} · ${formatShortDate(g.date)}`}
                        className={`attendance-status attendance-status-compact ${statusClass(status)}`}
                        value={status}
                        disabled={busy}
                        onChange={(e) =>
                          onChangeStatus(
                            g.id,
                            p.id,
                            e.target.value as AttendanceStatus
                          )
                        }
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.short}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`attendance-badge ${statusClass(status)}${
                          locked ? " attendance-badge-locked" : ""
                        }`}
                      >
                        {statusText(status)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TeamsBody({
  game,
  view,
  myPlayerId,
  includeMaybe,
  isAdmin,
  showTeamRatingSystem,
  teamRatingSystem,
  onTeamRatingSystemChange,
  onToggleIncludeMaybe,
  onManualTeams,
  onGenerate,
  generating,
}: {
  game: Game;
  view: PlayerGameViewModel;
  myPlayerId: string | null;
  includeMaybe: boolean;
  isAdmin: boolean;
  showTeamRatingSystem: boolean;
  teamRatingSystem: TeamRatingSystem;
  onTeamRatingSystemChange: (next: TeamRatingSystem) => void;
  onToggleIncludeMaybe: (next: boolean) => void;
  onManualTeams: (
    teamA: TeamMemberPublic[],
    teamB: TeamMemberPublic[]
  ) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  function onDropTo(side: "A" | "B") {
    if (!isAdmin || !dragId || !view.showTeamLists) return;
    const fromA = view.teamA.find((m) => m.playerId === dragId);
    const fromB = view.teamB.find((m) => m.playerId === dragId);
    if (!fromA && !fromB) return;
    if (side === "A" && fromA) return;
    if (side === "B" && fromB) return;

    const { teamA, teamB } = moveMemberKeepingSizeBalance(
      view.teamA,
      view.teamB,
      dragId,
      side
    );
    setDragId(null);
    onManualTeams(teamA, teamB);
  }

  return (
    <>
      <p className="teams-meta">
        {formatDisplayDate(game.date)} · {formatDisplayTime(game.startTime)}
        {game.endTime ? ` – ${formatDisplayTime(game.endTime)}` : ""} ·{" "}
        {game.location}
      </p>

      {isAdmin ? (
        <label className="teams-include-maybe">
          <input
            type="checkbox"
            checked={includeMaybe}
            disabled={generating}
            onChange={(e) => onToggleIncludeMaybe(e.target.checked)}
          />
          Include Maybe players
        </label>
      ) : null}

      {isAdmin && showTeamRatingSystem ? (
        <label className="teams-include-maybe">
          <span className="mr-2">Team rating system</span>
          <select
            className="input"
            value={teamRatingSystem}
            disabled={generating}
            onChange={(e) =>
              onTeamRatingSystemChange(
                e.target.value === "simple" ? "simple" : "classic"
              )
            }
          >
            <option value="classic">Classic</option>
            <option value="simple">Simple</option>
          </select>
        </label>
      ) : null}

      <p className="teams-count">{view.confirmedLabel}</p>

      {isAdmin ? (
        <div className="teams-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={generating || view.teamsPhase === "insufficient"}
            onClick={() => onGenerate()}
          >
            {generating ? "Working…" : "Generate Teams"}
          </button>
        </div>
      ) : null}

      {view.teamsPhase === "stale" ? (
        <p className="teams-note teams-note-stale">{view.teamsMessage}</p>
      ) : view.showProgress ? (
        <div className="teams-progress" aria-live="polite">
          <p className="teams-note">{view.teamsMessage}</p>
          <div className="teams-progress-track">
            <div className="teams-progress-bar" />
          </div>
        </div>
      ) : view.teamsMessage ? (
        <p className="teams-note">{view.teamsMessage}</p>
      ) : null}

      {view.myTeamLabel && !view.stale ? (
        <p className="teams-you">
          You are playing for {view.myTeamLabel.toUpperCase()}
        </p>
      ) : null}
      {view.showTeamLists && (
        <div className="teams-columns">
          {(["A", "B"] as const).map((side) => {
            const list = side === "A" ? view.teamA : view.teamB;
            return (
              <div
                key={side}
                className={`teams-drop${isAdmin ? " teams-drop-admin" : ""}`}
                onDragOver={(e) => {
                  if (isAdmin) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDropTo(side);
                }}
              >
                <p
                  className={`teams-col-title ${
                    side === "A" ? "teams-col-a" : "teams-col-b"
                  }`}
                >
                  Team {side}
                  {isAdmin ? (
                    <span className="teams-dnd-hint"> · drag players</span>
                  ) : null}
                </p>
                <ul className="teams-list">
                  {list.map((m) => (
                    <li
                      key={m.playerId}
                      className={`teams-list-item${
                        m.playerId === myPlayerId ? " teams-list-you" : ""
                      }${isAdmin ? " teams-list-draggable" : ""}${
                        dragId === m.playerId ? " teams-list-dragging" : ""
                      }`}
                      draggable={isAdmin}
                      onDragStart={() => {
                        if (isAdmin) setDragId(m.playerId);
                      }}
                      onDragEnd={() => setDragId(null)}
                    >
                      {isAdmin ? (
                        <span className="teams-grip" aria-hidden="true">
                          ⋮⋮
                        </span>
                      ) : null}
                      <span className="teams-list-name">
                        {m.displayName}
                        {m.maybe ? " (Maybe)" : ""}
                        {m.playerId === myPlayerId ? " (you)" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
