"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { PageHeading } from "@/components/PageHeading";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import {
  getEvaluation,
  getPlayer,
  getSimpleEvaluation,
  getUserProfile,
  listEvaluations,
  listPlayers,
  upsertSimpleEvaluation,
} from "@/lib/firebase/data";
import { deletePlayerApi, setUserRoleApi } from "@/lib/firebase/role-api";
import {
  BALANCE_METRIC_HELP,
  averageOpenFieldFactorForActivePlayers,
  computePlayerBalanceMetricsFromEvaluation,
  formatOneDecimal,
  formatSignedOneDecimal,
} from "@/lib/balance-metrics";
import {
  calculateSimpleOverall,
  emptySimpleRatingsDraft,
  isCompleteSimpleRatings,
} from "@/lib/simple-ratings";
import { roleLabel } from "@/lib/roles";
import { LAST_ADMIN_MESSAGE } from "@/lib/role-management";
import { formatUnknownError } from "@/lib/errors";
import type {
  Player,
  PlayerEvaluation,
  SimplePlayerEvaluation,
  SimplePlayerRatings,
  UserProfile,
  UserRole,
} from "@/lib/types";
import {
  RATING_KEYS,
  SIMPLE_RATING_KEYS,
  SIMPLE_RATING_LABELS,
} from "@/lib/types";

function PlayerDetailContent() {
  const { playerId: rawId } = useParams<{ playerId: string }>();
  const playerId = Array.isArray(rawId) ? rawId[0]! : rawId;
  const router = useRouter();
  const { user, refreshProfile } = useAuth();
  const [player, setPlayer] = useState<Player | null>(null);
  const [evaluation, setEvaluation] = useState<PlayerEvaluation | null>(null);
  const [simpleEvaluation, setSimpleEvaluation] =
    useState<SimplePlayerEvaluation | null>(null);
  const [ratingsMode, setRatingsMode] = useState<"classic" | "simple">(
    "classic"
  );
  const [simpleDraft, setSimpleDraft] = useState<SimplePlayerRatings>(
    emptySimpleRatingsDraft()
  );
  const [simpleBusy, setSimpleBusy] = useState(false);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [allEvals, setAllEvals] = useState<
    Record<string, PlayerEvaluation | null>
  >({});
  const [linkedProfile, setLinkedProfile] = useState<UserProfile | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function reload() {
    const db = getClientDb();
    const [p, e, s, players, evals] = await Promise.all([
      getPlayer(db, playerId),
      getEvaluation(db, playerId),
      getSimpleEvaluation(db, playerId),
      listPlayers(db),
      listEvaluations(db),
    ]);
    if (!p) {
      setNotFound(true);
      setPlayer(null);
      return;
    }
    setNotFound(false);
    setPlayer(p);
    setEvaluation(e);
    setSimpleEvaluation(s);
    if (s && isCompleteSimpleRatings(s)) {
      setSimpleDraft(
        Object.fromEntries(
          SIMPLE_RATING_KEYS.map((k) => [k, s[k]])
        ) as SimplePlayerRatings
      );
    } else {
      setSimpleDraft(emptySimpleRatingsDraft());
    }
    setAllPlayers(players);
    setAllEvals(Object.fromEntries(evals.map((x) => [x.playerId, x])));
    if (p.linkedUid) {
      setLinkedProfile(await getUserProfile(db, p.linkedUid));
    } else {
      setLinkedProfile(null);
    }
  }

  useEffect(() => {
    if (!playerId) return;
    reload().catch((err) => setRoleError(formatUnknownError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on playerId only
  }, [playerId]);

  const populationAverage = useMemo(
    () => averageOpenFieldFactorForActivePlayers(allPlayers, allEvals),
    [allPlayers, allEvals]
  );

  const metrics = useMemo(
    () =>
      computePlayerBalanceMetricsFromEvaluation(evaluation, populationAverage),
    [evaluation, populationAverage]
  );

  async function setRole(next: UserRole) {
    if (!user || !linkedProfile || !player?.linkedUid) return;
    setRoleBusy(true);
    setRoleError(null);
    setRoleMessage(null);
    try {
      await setUserRoleApi(user, {
        uid: linkedProfile.uid,
        role: next,
        playerId: player.id,
      });
      await reload();
      if (linkedProfile.uid === user.uid) {
        await refreshProfile();
      }
      setRoleMessage(
        next === "admin"
          ? "Promoted to Admin."
          : "Admin role removed — now Player."
      );
    } catch (err) {
      const msg = formatUnknownError(err);
      setRoleError(
        msg.includes("at least one Admin") ? LAST_ADMIN_MESSAGE : msg
      );
    } finally {
      setRoleBusy(false);
    }
  }

  async function onDeletePlayer() {
    if (!user || !player) return;
    setDeleteBusy(true);
    setRoleError(null);
    setRoleMessage(null);
    try {
      await deletePlayerApi(user, player.id);
      if (player.linkedUid && player.linkedUid === user.uid) {
        await refreshProfile();
      }
      router.replace("/admin/players");
    } catch (err) {
      const msg = formatUnknownError(err);
      setRoleError(
        msg.includes("at least one Admin") ? LAST_ADMIN_MESSAGE : msg
      );
      setConfirmDelete(false);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function onSaveSimple(e: FormEvent) {
    e.preventDefault();
    if (!user || !player) return;
    setSimpleBusy(true);
    setRoleError(null);
    setRoleMessage(null);
    try {
      await upsertSimpleEvaluation(
        getClientDb(),
        player.id,
        simpleDraft,
        user.uid
      );
      setRoleMessage("Simple ratings saved.");
      await reload();
    } catch (err) {
      setRoleError(formatUnknownError(err));
    } finally {
      setSimpleBusy(false);
    }
  }

  if (notFound) {
    return (
      <>
        <AppNav />
        <Link href="/admin/players" className="text-sm text-blue-400 hover:underline">
          ← Players
        </Link>
        <p className="mt-4 text-slate-400">Player not found.</p>
      </>
    );
  }

  if (!player) {
    return (
      <>
        <AppNav />
        <p className="text-slate-400">Loading…</p>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <Link href="/admin/players" className="text-sm text-blue-400 hover:underline">
        ← Players
      </Link>
      <PageHeading>Player — {player.displayName}</PageHeading>
      <p className="page-heading-sub">{player.email || "No email"}</p>

      {/* Desktop-only: view/edit which rating system is shown. Mobile keeps Classic. */}
      <label className="mt-4 hidden flex-wrap items-center gap-2 text-sm md:flex">
        <span className="text-slate-400">View/Edit ratings</span>
        <select
          className="input w-auto"
          value={ratingsMode}
          onChange={(e) =>
            setRatingsMode(e.target.value === "simple" ? "simple" : "classic")
          }
        >
          <option value="classic">Classic</option>
          <option value="simple">Simple</option>
        </select>
      </label>

      {linkedProfile ? (
        <div className="card mt-4 space-y-3">
          <p className="font-semibold">
            Role: {roleLabel(linkedProfile.role)}
          </p>
          {roleMessage && <p className="text-sm text-green-400">{roleMessage}</p>}
          {roleError && <p className="text-sm text-red-400">{roleError}</p>}
          <div className="flex flex-wrap gap-2">
            {linkedProfile.role !== "admin" && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={roleBusy || deleteBusy}
                onClick={() => setRole("admin")}
              >
                Make Admin
              </button>
            )}
            {linkedProfile.role === "admin" && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={roleBusy || deleteBusy}
                onClick={() => setRole("player")}
              >
                Remove Admin role
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="card mt-4 space-y-2">
          <p className="text-sm text-slate-500">No linked account</p>
          {roleError && <p className="text-sm text-red-400">{roleError}</p>}
        </div>
      )}

      {/* Classic block: always on mobile; on desktop when Classic selected */}
      <div className={ratingsMode === "simple" ? "md:hidden" : undefined}>
      {evaluation && metrics ? (
        <>
          <div className="card mt-4">
            <h3 className="mb-1 font-semibold">Calculated Ratings</h3>
            <p className="mb-3 text-xs text-slate-500">
              Read-only. Derived from the 11 source ratings below.
            </p>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div title={BALANCE_METRIC_HELP.overall}>
                <dt className="text-slate-400">Overall</dt>
                <dd className="text-lg font-bold tabular-nums">
                  {formatOneDecimal(metrics.overall)}
                </dd>
              </div>
              <div title={BALANCE_METRIC_HELP.balanceRating}>
                <dt className="text-slate-400">Balance Rating</dt>
                <dd className="text-lg font-bold tabular-nums">
                  {formatOneDecimal(metrics.balanceRating)}
                </dd>
              </div>
              <div title={BALANCE_METRIC_HELP.physical}>
                <dt className="text-slate-400">Physical</dt>
                <dd className="font-semibold tabular-nums">
                  {formatOneDecimal(metrics.physical)}
                </dd>
              </div>
              <div title={BALANCE_METRIC_HELP.football}>
                <dt className="text-slate-400">Football</dt>
                <dd className="font-semibold tabular-nums">
                  {formatOneDecimal(metrics.football)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Attack</dt>
                <dd className="font-semibold tabular-nums">{metrics.attack}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Defense</dt>
                <dd className="font-semibold tabular-nums">{metrics.defense}</dd>
              </div>
            </dl>
          </div>

          <div className="card mt-4">
            <h3 className="mb-1 font-semibold">Environment</h3>
            <p className="mb-3 text-xs text-slate-500">
              Informational only — not used for Teams yet.
            </p>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div title={BALANCE_METRIC_HELP.indoor}>
                <dt className="text-slate-400">Indoor</dt>
                <dd className="text-lg font-bold tabular-nums">
                  {formatOneDecimal(metrics.indoorRating)}
                </dd>
              </div>
              <div title={BALANCE_METRIC_HELP.openField}>
                <dt className="text-slate-400">Open Field</dt>
                <dd className="text-lg font-bold tabular-nums">
                  {formatOneDecimal(metrics.openFieldRating)}{" "}
                  <span className="text-sm font-medium text-slate-400">
                    ({formatSignedOneDecimal(metrics.openFieldAdjustment)})
                  </span>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-400">Open Field adjustment</dt>
                <dd className="font-semibold tabular-nums">
                  {formatSignedOneDecimal(metrics.openFieldAdjustment)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="card mt-4">
            <h3 className="mb-3 font-semibold">Source ratings</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {RATING_KEYS.map((k) => (
                <div key={k}>
                  <dt className="capitalize text-slate-400">{k}</dt>
                  <dd className="font-semibold">{evaluation[k]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      ) : (
        <p className="mt-4 text-slate-400">
          No evaluation yet — calculated ratings are not shown until ratings
          exist (missing data is not filled with defaults).
        </p>
      )}
      </div>

      {/* Simple editor: desktop only */}
      {ratingsMode === "simple" ? (
        <form
          onSubmit={onSaveSimple}
          className="card mt-4 hidden space-y-4 md:block"
        >
          <h3 className="font-semibold">Simple ratings (1–5)</h3>
          <p className="text-xs text-slate-500">
            Independent of Classic. Missing Simple ratings block Generate when
            Team rating system is Simple.
          </p>
          {!simpleEvaluation ? (
            <p className="text-sm text-amber-300">
              No Simple evaluation yet — enter values and save.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SIMPLE_RATING_KEYS.map((key) => (
              <label key={key} className="text-sm">
                <span className="label">{SIMPLE_RATING_LABELS[key]}</span>
                <select
                  className="input"
                  value={simpleDraft[key]}
                  onChange={(e) =>
                    setSimpleDraft((r) => ({
                      ...r,
                      [key]: Number(e.target.value),
                    }))
                  }
                >
                  {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="text-sm text-slate-400">
            Simple Overall:{" "}
            <strong>{calculateSimpleOverall(simpleDraft).toFixed(1)}</strong>
          </p>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={simpleBusy}
          >
            {simpleBusy ? "Saving…" : "Save Simple ratings"}
          </button>
        </form>
      ) : null}

      <div className="card mt-4 space-y-3 border border-red-900/50">
        <p className="font-semibold text-red-300">Danger zone</p>
        {!confirmDelete ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={deleteBusy || roleBusy}
            onClick={() => {
              setConfirmDelete(true);
              setRoleError(null);
            }}
          >
            Delete Player
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              Delete <strong>{player.displayName}</strong>? This removes the
              player from TeamSplit and cannot be undone.
            </p>
            <p className="text-xs text-slate-500">
              Permanently removes the roster entry, evaluation, this
              player&apos;s attendance, the linked TeamSplit user profile (if
              any), and the Firebase Auth account. Past team lists keep their
              names. This cannot be undone
              {player.linkedUid
                ? "; deleted credentials cannot sign in again."
                : "."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={deleteBusy}
                onClick={() => onDeletePlayer()}
              >
                {deleteBusy ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deleteBusy}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function AdminPlayerDetailPage() {
  return (
    <RequireAuth adminOnly>
      <PlayerDetailContent />
    </RequireAuth>
  );
}
