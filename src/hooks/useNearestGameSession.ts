"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, TouchEvent as ReactTouchEvent } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import {
  getAppSettings,
  getGameTeams,
  listAttendanceForGame,
  listGames,
  listPlayers,
  nextUpcomingGame,
} from "@/lib/firebase/data";
import {
  ensureTeamsIntegrityApi,
  saveManualTeamsApi,
  setAttendanceAndSync,
  setGameNoGameApi,
  setIncludeMaybeApi,
} from "@/lib/firebase/attendance-api";
import {
  buildPlayerGameView,
  type PlayerGameViewModel,
} from "@/lib/player-game-view";
import {
  DEFAULT_MIN_PLAYING_FOR_TEAMS,
  isIncludedForTeams,
} from "@/lib/team-sync";
import {
  canEditAttendanceOnGame,
  effectiveAttendanceStatus,
  gameHasNoGame,
} from "@/lib/no-game";
import { compareGamesByDateTime } from "@/lib/schedule";
import { formatUnknownError } from "@/lib/errors";
import { shouldNavigateFromSwipe } from "@/lib/mobile-nav";
import type {
  AttendanceStatus,
  Game,
  GameTeams,
  Player,
  TeamMemberPublic,
} from "@/lib/types";

export type AttendanceGrid = Record<string, Record<string, AttendanceStatus>>;

/**
 * Shared nearest-game session for mobile Player / Admin Team Builder.
 * Does not load evaluations or balance metrics.
 */
export function useNearestGameSession() {
  const { user, profile, isAdmin, showAdminUI } = useAuth();
  const myPlayerId = profile?.playerId ?? null;
  const viewerRole = profile?.role ?? null;

  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [grid, setGrid] = useState<AttendanceGrid>({});
  const [teams, setTeams] = useState<GameTeams | null>(null);
  const [includeMaybe, setIncludeMaybe] = useState(false);
  const [minPlaying, setMinPlaying] = useState(DEFAULT_MIN_PLAYING_FOR_TEAMS);
  const [allowEditOthers, setAllowEditOthers] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [updatingTeams, setUpdatingTeams] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

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

  // Keep selection when possible; otherwise fall back to nearest upcoming.
  useEffect(() => {
    if (games.length === 0) {
      setSelectedGameId(null);
      return;
    }
    if (selectedGameId && games.some((g) => g.id === selectedGameId)) return;
    setSelectedGameId(nextUpcomingGame(games)?.id ?? games[0]?.id ?? null);
  }, [games, selectedGameId]);

  const selectedGame = useMemo(
    () => games.find((g) => g.id === selectedGameId) ?? null,
    [games, selectedGameId]
  );
  const teamsGame = selectedGame;
  const teamsGameId = selectedGame?.id ?? null;

  function selectGame(gameId: string) {
    if (!games.some((g) => g.id === gameId)) return;
    setSelectedGameId(gameId);
  }

  useEffect(() => {
    if (!teamsGameId) {
      setTeams(null);
      setIncludeMaybe(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (user) await ensureTeamsIntegrityApi(user);
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

  function cellStatus(gId: string, playerId: string): AttendanceStatus {
    const g = games.find((x) => x.id === gId);
    const stored = grid[gId]?.[playerId];
    if (g) return effectiveAttendanceStatus(g, stored);
    return stored ?? "no_response";
  }

  async function changeStatus(
    gId: string,
    playerId: string,
    status: AttendanceStatus
  ) {
    if (!user || !canEditPlayer(playerId)) return;
    const game = games.find((g) => g.id === gId);
    if (!game || !canEditAttendanceOnGame(game, viewerRole)) return;
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

  async function generateTeams() {
    if (!user || !teamsGameId || !showAdminUI) return;
    setError(null);
    setUpdatingTeams(true);
    try {
      const { regenerateTeamsApi } = await import(
        "@/lib/firebase/attendance-api"
      );
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
          ? { ...cur, teamA, teamB, manuallyAdjusted: true }
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

  const includedCount = teamsGameId
    ? players.filter((p) =>
        isIncludedForTeams(cellStatus(teamsGameId, p.id), includeMaybe)
      ).length
    : 0;
  const playingCount = teamsGameId
    ? players.filter((p) => cellStatus(teamsGameId, p.id) === "playing").length
    : 0;
  const maybeCount = teamsGameId
    ? players.filter((p) => cellStatus(teamsGameId, p.id) === "maybe").length
    : 0;

  const myStatus =
    teamsGameId && myPlayerId
      ? cellStatus(teamsGameId, myPlayerId)
      : ("no_response" as AttendanceStatus);

  const teamsView: PlayerGameViewModel | null = teamsGame
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

  return {
    user,
    myPlayerId,
    isAdmin,
    showAdminUI,
    games,
    players,
    grid,
    teams,
    /** Currently selected game (mobile date dropdown). */
    selectedGame,
    selectedGameId: teamsGameId,
    selectGame,
    /** @deprecated alias — same as selectedGame */
    teamsGame,
    teamsGameId,
    teamsView,
    includeMaybe,
    minPlaying,
    allowEditOthers,
    loaded,
    error,
    setError,
    savingKey,
    updatingTeams,
    myStatus,
    canEditPlayer,
    cellStatus,
    changeStatus,
    toggleIncludeMaybe,
    generateTeams,
    persistManualTeams,
    toggleNoGame,
    reload,
    gameHasNoGame,
    canEditAttendanceOnGame: (game: Game) =>
      canEditAttendanceOnGame(game, viewerRole),
  };
}

export type NearestGameSession = ReturnType<typeof useNearestGameSession>;

/** Stable empty deps helper for touch swipe (avoids fighting vertical scroll). */
export function useSwipeFrames(input: {
  enabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  dragActiveRef?: MutableRefObject<boolean>;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const onPrev = useRef(input.onPrev);
  const onNext = useRef(input.onNext);
  onPrev.current = input.onPrev;
  onNext.current = input.onNext;

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      if (!input.enabled) return;
      const t = e.touches[0];
      if (!t) return;
      start.current = { x: t.clientX, y: t.clientY };
    },
    [input.enabled]
  );

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      if (!input.enabled || !start.current) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      start.current = null;
      const nav = shouldNavigateFromSwipe({
        dx,
        dy,
        dragActive: Boolean(input.dragActiveRef?.current),
      });
      if (nav === "next") onNext.current();
      if (nav === "prev") onPrev.current();
    },
    [input.enabled, input.dragActiveRef]
  );

  return { onTouchStart, onTouchEnd };
}
