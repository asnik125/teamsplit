"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { PageHeading } from "@/components/PageHeading";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import {
  emptyRatings,
  listEvaluations,
  listPlayers,
  upsertEvaluation,
  upsertPlayer,
} from "@/lib/firebase/data";
import {
  ADMIN_PLAYERS_METRIC_COLUMNS,
  BALANCE_METRIC_HELP,
  averageOpenFieldFactorForActivePlayers,
  buildAdminPlayersMetricRow,
  computePlayerBalanceMetrics,
  computePlayerBalanceMetricsFromEvaluation,
  formatOneDecimal,
  ratingsFromEvaluation,
} from "@/lib/balance-metrics";
import { calculateOverall } from "@/lib/balancer";
import type { Player, PlayerEvaluation, PlayerRatings } from "@/lib/types";
import { RATING_KEYS } from "@/lib/types";
import { formatUnknownError } from "@/lib/errors";
import { setPlayerActiveApi } from "@/lib/firebase/role-api";

function PlayersAdminContent() {
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [evals, setEvals] = useState<Record<string, PlayerEvaluation>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ratings, setRatings] = useState<PlayerRatings>(emptyRatings());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    const db = getClientDb();
    const [p, e] = await Promise.all([listPlayers(db), listEvaluations(db)]);
    setPlayers(p.sort((a, b) => a.displayName.localeCompare(b.displayName)));
    setEvals(Object.fromEntries(e.map((x) => [x.playerId, x])));
  }

  useEffect(() => {
    reload().catch((err) => setError(formatUnknownError(err)));
  }, []);

  const populationAverage = useMemo(
    () => averageOpenFieldFactorForActivePlayers(players, evals),
    [players, evals]
  );

  const rows = useMemo(
    () =>
      players.map((p) => {
        const metrics = computePlayerBalanceMetricsFromEvaluation(
          evals[p.id],
          populationAverage
        );
        return {
          player: p,
          metrics,
          row: buildAdminPlayersMetricRow({
            displayName: p.displayName,
            active: p.active,
            metrics,
          }),
        };
      }),
    [players, evals, populationAverage]
  );

  function startCreate() {
    setEditing("new");
    setName("");
    setEmail("");
    setRatings(emptyRatings());
    setMessage(null);
  }

  function startEdit(p: Player) {
    setEditing(p.id);
    setName(p.displayName);
    setEmail(p.email ?? "");
    const ev = evals[p.id];
    const fromEval = ratingsFromEvaluation(ev);
    setRatings(fromEval ?? emptyRatings());
    setMessage(null);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const db = getClientDb();
    const trimmedEmail = email.trim().toLowerCase() || null;

    if (trimmedEmail) {
      const dup = players.find(
        (p) =>
          p.email?.toLowerCase() === trimmedEmail &&
          p.id !== editing &&
          editing !== "new"
      );
      const dupNew =
        editing === "new" &&
        players.some((p) => p.email?.toLowerCase() === trimmedEmail);
      if (dup || dupNew) {
        setError(
          "Warning: another player already uses this email. Save cancelled."
        );
        return;
      }
    }

    const id = editing === "new" ? `p_${Date.now()}` : editing!;
    const existing = players.find((p) => p.id === id);
    const now = new Date().toISOString();
    const player: Player = {
      id,
      displayName: name.trim(),
      email: trimmedEmail,
      active: existing?.active ?? true,
      linkedUid: existing?.linkedUid ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      await upsertPlayer(db, player);
      await upsertEvaluation(db, id, ratings, user?.uid ?? null);
      setMessage("Saved.");
      setEditing(null);
      await reload();
    } catch (err) {
      setError(formatUnknownError(err));
    }
  }

  async function toggleActive(p: Player) {
    if (!user) return;
    setError(null);
    setMessage(null);
    try {
      const result = await setPlayerActiveApi(user, p.id, !p.active);
      setMessage(
        result.active
          ? `Activated. Upcoming attendance reset to — (${result.clearedAttendance} cleared). Teams recalculated.`
          : "Deactivated. Removed from Attendance and current Teams recalculated."
      );
      await reload();
    } catch (err) {
      setError(formatUnknownError(err));
    }
  }

  const draftMetrics = useMemo(() => {
    if (!editing) return null;
    return computePlayerBalanceMetrics(ratings, populationAverage);
  }, [editing, ratings, populationAverage]);

  return (
    <>
      <AppNav />
      <PageHeading
        actions={
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            + Add player
          </button>
        }
      >
        Players
      </PageHeading>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {message && <p className="mb-2 text-sm text-green-400">{message}</p>}

      {editing && (
        <form onSubmit={onSave} className="card mb-6 space-y-4">
          <h3 className="font-semibold">
            {editing === "new" ? "New player" : "Edit player"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Email (optional)</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RATING_KEYS.map((key) => (
              <label key={key} className="text-sm">
                <span className="label capitalize">{key}</span>
                <select
                  className="input"
                  value={ratings[key]}
                  onChange={(e) =>
                    setRatings((r) => ({
                      ...r,
                      [key]: Number(e.target.value),
                    }))
                  }
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="text-sm text-slate-400" title={BALANCE_METRIC_HELP.overall}>
            Overall: <strong>{calculateOverall(ratings)}</strong>
            {draftMetrics && (
              <>
                {" · "}
                Balance:{" "}
                <strong>{formatOneDecimal(draftMetrics.balanceRating)}</strong>
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">
              Save
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <p className="mb-2 text-xs text-slate-500">
        Calculated Balance / Indoor / Open Field are read-only.{" "}
        <span title={BALANCE_METRIC_HELP.balanceRating}>Balance</span>
        {" · "}
        <span title={BALANCE_METRIC_HELP.indoor}>Indoor</span>
        {" · "}
        <span title={BALANCE_METRIC_HELP.openField}>Open Field</span>
      </p>

      <div className="ratings-metrics-scroll">
        <table className="ratings-metrics-table">
          <thead>
            <tr>
              {ADMIN_PLAYERS_METRIC_COLUMNS.map((col) => (
                <th
                  key={col}
                  className={col === "Player" ? "text-left" : "text-right"}
                  title={
                    col === "Overall"
                      ? BALANCE_METRIC_HELP.overall
                      : col === "Balance"
                        ? BALANCE_METRIC_HELP.balanceRating
                        : col === "Indoor"
                          ? BALANCE_METRIC_HELP.indoor
                          : col === "Open Field"
                            ? BALANCE_METRIC_HELP.openField
                            : undefined
                  }
                >
                  {col}
                </th>
              ))}
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player: p, row }) => (
              <tr key={p.id} className={!p.active ? "opacity-60" : undefined}>
                <td className="ratings-metrics-player">
                  <Link
                    href={`/admin/players/${p.id}`}
                    className="font-semibold text-slate-100 hover:underline"
                  >
                    {p.displayName}
                  </Link>
                  {!p.active && (
                    <span className="ml-1 text-xs text-amber-400">(inactive)</span>
                  )}
                  <div className="text-xs text-slate-500">
                    {p.email || "No email"}
                  </div>
                </td>
                <td className="text-right tabular-nums">{row.overall}</td>
                <td className="text-right tabular-nums font-semibold">
                  {row.balance}
                </td>
                <td className="text-right tabular-nums">{row.indoor}</td>
                <td className="text-right tabular-nums">{row.openField}</td>
                <td className="text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => startEdit(p)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => toggleActive(p)}
                    >
                      {p.active ? "Deactivate" : "Activate"}
                    </button>
                    <Link
                      href={`/admin/players/${p.id}`}
                      className="btn btn-secondary"
                    >
                      Details
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function AdminPlayersPage() {
  return (
    <RequireAuth adminOnly>
      <PlayersAdminContent />
    </RequireAuth>
  );
}
