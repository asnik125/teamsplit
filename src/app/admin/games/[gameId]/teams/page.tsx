"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import {
  getGame,
  getGameTeams,
  listAttendanceForGame,
  listEvaluations,
  listPlayers,
  saveGameTeams,
  upsertGame,
} from "@/lib/firebase/data";
import { regenerateTeamsApi } from "@/lib/firebase/attendance-api";
import {
  assertNoDuplicatePlayers,
  autoRebalanceAfterMove,
  calculateOverall,
  generateSnakeDraftTeams,
  movePlayerBetweenTeams,
  teamStrength,
  toPublicMembers,
} from "@/lib/balancer";
import type {
  Game,
  GameTeams,
  Player,
  PlayerEvaluation,
  PlayerRatings,
  RatedPlayer,
} from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";
import { formatUnknownError } from "@/lib/errors";
import { insufficientMessage, DEFAULT_MIN_PLAYING_FOR_TEAMS } from "@/lib/team-sync";

function toRated(
  player: Player,
  evaluation: PlayerEvaluation | undefined
): RatedPlayer | null {
  if (!evaluation) return null;
  const ratings = Object.fromEntries(
    RATING_KEYS.map((k) => [k, evaluation[k]])
  ) as PlayerRatings;
  return {
    ...player,
    ...ratings,
    overall: calculateOverall(ratings),
  };
}

function TeamBuilderContent() {
  const { gameId } = useParams<{ gameId: string }>();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [evals, setEvals] = useState<Record<string, PlayerEvaluation>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [teamA, setTeamA] = useState<RatedPlayer[]>([]);
  const [teamB, setTeamB] = useState<RatedPlayer[]>([]);
  const [published, setPublished] = useState(false);
  const [manuallyAdjusted, setManuallyAdjusted] = useState(false);
  const [includeMaybePlayers, setIncludeMaybePlayers] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsRepublish, setNeedsRepublish] = useState(false);
  const [busy, setBusy] = useState(false);

  const reloadMeta = useCallback(async () => {
    const db = getClientDb();
    const [g, p, e, attendance, teams] = await Promise.all([
      getGame(db, gameId),
      listPlayers(db),
      listEvaluations(db),
      listAttendanceForGame(db, gameId),
      getGameTeams(db, gameId),
    ]);
    setGame(g);
    const active = p.filter((x) => x.active);
    setPlayers(active);
    setEvals(Object.fromEntries(e.map((x) => [x.playerId, x])));

    const playingIds = new Set(
      attendance.filter((a) => a.status === "playing").map((a) => a.playerId)
    );
    setSelected(
      new Set([...playingIds].filter((id) => active.some((pl) => pl.id === id)))
    );

    if (teams) {
      const evalMap = Object.fromEntries(e.map((x) => [x.playerId, x]));
      const hydrate = (members: { playerId: string }[]) =>
        members
          .map((m) => {
            const pl = active.find((x) => x.id === m.playerId);
            return pl ? toRated(pl, evalMap[pl.id]) : null;
          })
          .filter(Boolean) as RatedPlayer[];
      setTeamA(hydrate(teams.teamA));
      setTeamB(hydrate(teams.teamB));
      setPublished(teams.published);
      setManuallyAdjusted(Boolean(teams.manuallyAdjusted));
      setIncludeMaybePlayers(Boolean(teams.includeMaybePlayers));
    } else {
      setTeamA([]);
      setTeamB([]);
      setPublished(false);
      setManuallyAdjusted(false);
      setIncludeMaybePlayers(false);
    }
  }, [gameId]);

  useEffect(() => {
    reloadMeta().catch((e) => setError(formatUnknownError(e)));
  }, [reloadMeta]);

  const ratedPool = useMemo(() => {
    return players
      .map((p) => toRated(p, evals[p.id]))
      .filter(Boolean) as RatedPlayer[];
  }, [players, evals]);

  const playingCount = selected.size;

  function togglePlayer(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function generate() {
    setError(null);
    setMessage(null);
    const pool = ratedPool.filter((p) => selected.has(p.id));
    if (pool.length < 2) {
      setError("Select at least 2 Playing participants to generate teams.");
      return;
    }
    const missingEval = players.filter(
      (p) => selected.has(p.id) && !evals[p.id]
    );
    if (missingEval.length) {
      setError(
        `Missing evaluations for: ${missingEval.map((p) => p.displayName).join(", ")}`
      );
      return;
    }
    try {
      const { teamA: a, teamB: b } = generateSnakeDraftTeams(pool);
      assertNoDuplicatePlayers(a, b);
      setTeamA(a);
      setTeamB(b);
      setManuallyAdjusted(true);
      setMessage("Teams generated (draft). Publish when ready.");
      if (published) setNeedsRepublish(true);
    } catch (e) {
      setError(formatUnknownError(e));
    }
  }

  function moveTo(playerId: string, to: "A" | "B", withRebalance: boolean) {
    setError(null);
    try {
      let next = movePlayerBetweenTeams(teamA, teamB, playerId, to);
      if (withRebalance) {
        next = autoRebalanceAfterMove(next.teamA, next.teamB, playerId, to);
      }
      assertNoDuplicatePlayers(next.teamA, next.teamB);
      setTeamA(next.teamA);
      setTeamB(next.teamB);
      setManuallyAdjusted(true);
      if (published) setNeedsRepublish(true);
    } catch (e) {
      setError(formatUnknownError(e));
    }
  }

  async function persist(publish: boolean) {
    if (!user || !game) return;
    if (teamA.length + teamB.length < 2) {
      setError("Nothing to save.");
      return;
    }
    setError(null);
    const now = new Date().toISOString();
    const payload: GameTeams = {
      gameId,
      teamA: toPublicMembers(teamA),
      teamB: toPublicMembers(teamB),
      published: publish,
      publishedAt: publish ? now : null,
      updatedAt: now,
      updatedBy: user.uid,
      manuallyAdjusted: true,
      includeMaybePlayers,
    };
    try {
      const db = getClientDb();
      await saveGameTeams(db, payload);
      await upsertGame(db, {
        ...game,
        teamsMayBeStale: false,
        teamsStatusMessage: publish
          ? "Teams are published."
          : "Draft teams saved (manual).",
        updatedAt: now,
      });
      setPublished(publish);
      setManuallyAdjusted(true);
      setNeedsRepublish(false);
      setMessage(
        publish
          ? "Teams published. Players can now see assignments."
          : "Draft teams saved (unpublished)."
      );
      setGame({
        ...game,
        teamsMayBeStale: false,
        teamsStatusMessage: publish
          ? "Teams are published."
          : "Draft teams saved (manual).",
      });
    } catch (e) {
      setError(formatUnknownError(e));
    }
  }

  async function unpublish() {
    if (!user || !game) return;
    const now = new Date().toISOString();
    const payload: GameTeams = {
      gameId,
      teamA: toPublicMembers(teamA),
      teamB: toPublicMembers(teamB),
      published: false,
      publishedAt: null,
      updatedAt: now,
      updatedBy: user.uid,
      manuallyAdjusted,
      includeMaybePlayers,
    };
    await saveGameTeams(getClientDb(), payload);
    setPublished(false);
    setMessage("Teams unpublished.");
  }

  async function regenerateFromAttendance() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await regenerateTeamsApi(user, gameId);
      setMessage(result.message);
      await reloadMeta();
    } catch (e) {
      setError(formatUnknownError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!game) {
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
      <Link
        href={`/admin/games/${gameId}/attendance`}
        className="text-sm text-blue-400 hover:underline"
      >
        ← Attendance
      </Link>
      <h2 className="mt-2 text-2xl font-bold">Team Builder</h2>
      <p className="text-slate-400">
        {game.date} · {game.startTime} · {game.location}
      </p>
      <p className="mt-1 text-sm">
        Status:{" "}
        <strong className={published ? "text-green-400" : "text-amber-300"}>
          {published ? "Published" : "Draft / unpublished"}
        </strong>
        {manuallyAdjusted && !published && (
          <span className="ml-2 text-slate-400">· Manually adjusted</span>
        )}
        {needsRepublish && (
          <span className="ml-2 text-amber-300">
            · Changes need re-publish
          </span>
        )}
      </p>

      {game.teamsStatusMessage && (
        <p className="mt-2 text-sm text-slate-300">{game.teamsStatusMessage}</p>
      )}
      {game.teamsMayBeStale && (
        <div className="card mt-3 border border-amber-500/40 bg-amber-500/10">
          <p className="font-semibold text-amber-200">
            Attendance changed · Teams need update
          </p>
          {game.lastAttendanceChange && (
            <p className="mt-1 text-sm text-amber-100/90">
              {game.lastAttendanceChange.displayName}:{" "}
              {game.lastAttendanceChange.previousStatus ?? "—"} →{" "}
              {game.lastAttendanceChange.nextStatus}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary mt-3"
            disabled={busy}
            onClick={() => regenerateFromAttendance()}
          >
            Regenerate teams
          </button>
        </div>
      )}

      {playingCount < 6 && teamA.length + teamB.length === 0 && (
        <p className="mt-3 text-sm text-amber-300">
          {insufficientMessage(DEFAULT_MIN_PLAYING_FOR_TEAMS)}
        </p>
      )}

      <div className="card mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Participants ({selected.size})</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelected(new Set(players.map((p) => p.id)))}
            >
              Select all active
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Defaults to players marked Playing. Admins can add/remove exceptions.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ratedPool.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => togglePlayer(p.id)}
              />
              <span>
                {p.displayName}{" "}
                <span className="text-slate-400">({p.overall})</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={generate}>
            Balance teams (snake draft)
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => regenerateFromAttendance()}
          >
            Regenerate from attendance
          </button>
        </div>
      </div>

      {(teamA.length > 0 || teamB.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TeamColumn
            title="Team A"
            color="text-blue-400"
            players={teamA}
            strength={teamStrength(teamA)}
            onMove={(id) => moveTo(id, "B", false)}
            onMoveRebalance={(id) => moveTo(id, "B", true)}
            moveLabel="→ B"
          />
          <TeamColumn
            title="Team B"
            color="text-purple-400"
            players={teamB}
            strength={teamStrength(teamB)}
            onMove={(id) => moveTo(id, "A", false)}
            onMoveRebalance={(id) => moveTo(id, "A", true)}
            moveLabel="→ A"
          />
        </div>
      )}

      {message && <p className="mt-3 text-sm text-green-400">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {(teamA.length > 0 || teamB.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => persist(false)}
          >
            Save draft
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => persist(true)}
          >
            {published || needsRepublish ? "Publish / update" : "Publish teams"}
          </button>
          {published && (
            <button type="button" className="btn btn-danger" onClick={unpublish}>
              Unpublish
            </button>
          )}
        </div>
      )}
    </>
  );
}

function TeamColumn({
  title,
  color,
  players,
  strength,
  onMove,
  onMoveRebalance,
  moveLabel,
}: {
  title: string;
  color: string;
  players: RatedPlayer[];
  strength: number;
  onMove: (id: string) => void;
  onMoveRebalance: (id: string) => void;
  moveLabel: string;
}) {
  return (
    <div className="card min-h-[200px]">
      <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
        <h3 className={`text-lg font-bold ${color}`}>{title}</h3>
        <span className="text-sm text-slate-400">
          {players.length} · <strong className="text-white">{strength}</strong> pts
        </span>
      </div>
      <ul className="space-y-2">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex flex-col gap-2 rounded-md border border-slate-700 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-semibold">{p.displayName}</p>
              <p className="text-xs text-slate-400">
                {p.overall} · Def {p.defend} · Att {p.attack}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onMove(p.id)}
              >
                Move {moveLabel}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onMoveRebalance(p.id)}
              >
                Move + auto-swap
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TeamBuilderPage() {
  return (
    <RequireAuth adminOnly>
      <TeamBuilderContent />
    </RequireAuth>
  );
}
