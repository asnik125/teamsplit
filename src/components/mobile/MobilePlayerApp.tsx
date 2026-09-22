"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { MobileChrome } from "./MobileChrome";
import {
  useNearestGameSession,
  useSwipeFrames,
} from "@/hooks/useNearestGameSession";
import {
  adjacentPlayerFrame,
  defaultPlayerMobileFrame,
  type PlayerMobileFrame,
} from "@/lib/mobile-nav";
import { formatDisplayDate, formatDisplayTime } from "@/lib/schedule";
import { gameHasNoGame } from "@/lib/no-game";
import type { AttendanceStatus } from "@/lib/types";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import { COLLECTIONS, listPlayers } from "@/lib/firebase/data";
import {
  DUPLICATE_DISPLAY_NAME_MESSAGE,
  findDisplayNameConflict,
} from "@/lib/auth/onboarding";
import { formatUnknownError } from "@/lib/errors";

const STATUS_BTN: {
  value: AttendanceStatus;
  label: string;
  className: string;
}[] = [
  { value: "playing", label: "Playing", className: "m-status-playing" },
  { value: "maybe", label: "Maybe", className: "m-status-maybe" },
  { value: "not_playing", label: "Not playing", className: "m-status-not" },
];

function statusLabel(s: AttendanceStatus): string {
  if (s === "playing") return "Playing";
  if (s === "maybe") return "Maybe";
  if (s === "not_playing") return "Not playing";
  return "—";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function MobilePlayerApp({
  initialFrame = defaultPlayerMobileFrame(),
}: {
  initialFrame?: PlayerMobileFrame;
}) {
  const session = useNearestGameSession();
  const { signOut, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const [frame, setFrame] = useState<PlayerMobileFrame>(initialFrame);
  const dragActiveRef = useRef(false);

  useEffect(() => {
    setFrame(initialFrame);
  }, [initialFrame]);

  const swipe = useSwipeFrames({
    enabled: true,
    dragActiveRef,
    onPrev: () => setFrame((f) => adjacentPlayerFrame(f, -1)),
    onNext: () => setFrame((f) => adjacentPlayerFrame(f, 1)),
  });

  const game = session.teamsGame;
  const locked = game ? !session.canEditAttendanceOnGame(game) : true;
  const noGame = game ? gameHasNoGame(game) : false;

  const filterCounts = useMemo(() => {
    if (!game) return { all: 0, playing: 0, maybe: 0, not: 0 };
    let playing = 0;
    let maybe = 0;
    let not = 0;
    for (const p of session.players) {
      const st = session.cellStatus(game.id, p.id);
      if (st === "playing") playing += 1;
      else if (st === "maybe") maybe += 1;
      else if (st === "not_playing") not += 1;
    }
    return { all: session.players.length, playing, maybe, not };
  }, [game, session]);

  const [listFilter, setListFilter] = useState<
    "all" | "playing" | "maybe" | "not"
  >("all");

  const visiblePlayers = session.players.filter((p) => {
    if (!game || listFilter === "all") return true;
    const st = session.cellStatus(game.id, p.id);
    if (listFilter === "playing") return st === "playing";
    if (listFilter === "maybe") return st === "maybe";
    return st === "not_playing";
  });

  return (
    <div className="m-app" {...swipe}>
      <MobileChrome title={frame === "profile" ? "Profile" : "Game"} />
      {session.error && <p className="m-error">{session.error}</p>}

      <div className="m-dots" aria-hidden>
        {(["attendance", "teams", "profile"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`m-dot${frame === f ? " m-dot-on" : ""}`}
            aria-label={f}
            onClick={() => setFrame(f)}
          />
        ))}
      </div>

      {frame === "attendance" && (
        <section className="m-pane">
          {!session.loaded ? (
            <p className="m-muted">Loading…</p>
          ) : !game ? (
            <p className="m-muted">No upcoming game.</p>
          ) : (
            <>
              <div className="m-game-hero">
                <p className="m-game-date">{formatDisplayDate(game.date)}</p>
                <p className="m-game-meta">
                  {formatDisplayTime(game.startTime)}
                  {game.endTime ? ` – ${formatDisplayTime(game.endTime)}` : ""}
                  {game.location ? ` · ${game.location}` : ""}
                </p>
                {noGame && <p className="m-nogame">No Game this week</p>}
              </div>

              {session.myPlayerId && (
                <div className="m-my-status">
                  <p className="m-section-label">My status</p>
                  <div className="m-status-row">
                    {STATUS_BTN.map((b) => (
                      <button
                        key={b.value}
                        type="button"
                        className={`m-status-btn ${b.className}${
                          session.myStatus === b.value ? " m-status-on" : ""
                        }`}
                        disabled={locked || Boolean(session.savingKey)}
                        onClick={() =>
                          session.changeStatus(
                            game.id,
                            session.myPlayerId!,
                            b.value
                          )
                        }
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="m-filters">
                {(
                  [
                    ["all", `All (${filterCounts.all})`],
                    ["playing", `Playing (${filterCounts.playing})`],
                    ["maybe", `Maybe (${filterCounts.maybe})`],
                    ["not", `Not (${filterCounts.not})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`m-filter${listFilter === key ? " m-filter-on" : ""}`}
                    onClick={() => setListFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <ul className="m-player-list">
                {visiblePlayers.map((p) => {
                  const st = session.cellStatus(game.id, p.id);
                  const canEdit = session.canEditPlayer(p.id) && !locked;
                  const isMe = p.id === session.myPlayerId;
                  return (
                    <li
                      key={p.id}
                      className={`m-player-row${isMe ? " m-player-me" : ""}`}
                    >
                      <span className="m-avatar" aria-hidden>
                        {initials(p.displayName)}
                      </span>
                      <div className="m-player-main">
                        <p className="m-player-name">
                          {p.displayName}
                          {isMe ? " (you)" : ""}
                        </p>
                        {canEdit ? (
                          <select
                            className="m-inline-select"
                            value={st === "no_response" ? "" : st}
                            disabled={Boolean(session.savingKey)}
                            onChange={(e) => {
                              const v = e.target.value as AttendanceStatus;
                              if (!v) return;
                              session.changeStatus(game.id, p.id, v);
                            }}
                          >
                            <option value="" disabled>
                              —
                            </option>
                            <option value="playing">Playing</option>
                            <option value="maybe">Maybe</option>
                            <option value="not_playing">Not playing</option>
                          </select>
                        ) : (
                          <span className={`m-status-tag m-tag-${st}`}>
                            {statusLabel(st)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="m-swipe-hint">Swipe for Teams →</p>
            </>
          )}
        </section>
      )}

      {frame === "teams" && (
        <section className="m-pane">
          {!game || !session.teamsView ? (
            <p className="m-muted">No teams yet.</p>
          ) : (
            <>
              <div className="m-game-hero">
                <p className="m-game-date">{formatDisplayDate(game.date)}</p>
                <p className="m-game-meta">
                  {formatDisplayTime(game.startTime)}
                  {game.location ? ` · ${game.location}` : ""}
                </p>
              </div>
              <p className="m-muted">{session.teamsView.confirmedLabel}</p>
              {session.teamsView.showTeamLists ? (
                <div className="m-team-split m-team-split-readonly">
                  <div className="m-team-col m-team-col-a">
                    <p className="m-team-col-title">Team A</p>
                    <ul className="m-team-list">
                      {session.teamsView.teamA.map((m) => (
                        <li key={m.playerId} className="m-team-chip">
                          {m.displayName}
                          {m.maybe ? " (Maybe)" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="m-team-col m-team-col-b">
                    <p className="m-team-col-title">Team B</p>
                    <ul className="m-team-list">
                      {session.teamsView.teamB.map((m) => (
                        <li key={m.playerId} className="m-team-chip">
                          {m.displayName}
                          {m.maybe ? " (Maybe)" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="m-muted">{session.teamsView.teamsMessage}</p>
              )}
              <p className="m-swipe-hint">← Attendance · Profile →</p>
            </>
          )}
        </section>
      )}

      {frame === "profile" && profile && (
        <MobilePlayerProfile
          displayName={profile.displayName}
          email={profile.email}
          emailNotifications={profile.emailNotifications !== false}
          playerId={profile.playerId}
          uid={profile.uid}
          onSaved={refreshProfile}
          onSignOut={async () => {
            await signOut();
            router.replace("/sign-in");
          }}
        />
      )}
    </div>
  );
}

function MobilePlayerProfile(props: {
  displayName: string;
  email: string;
  emailNotifications: boolean;
  playerId: string | null;
  uid: string;
  onSaved: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [name, setName] = useState(props.displayName);
  const [notif, setNotif] = useState(props.emailNotifications);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setMsg(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Display name is required.");
      return;
    }
    try {
      const db = getClientDb();
      const players = await listPlayers(db);
      const conflict = findDisplayNameConflict({
        displayName: trimmed,
        players,
        excludePlayerId: props.playerId,
      });
      if (conflict) {
        setErr(DUPLICATE_DISPLAY_NAME_MESSAGE);
        return;
      }
      const now = new Date().toISOString();
      await updateDoc(doc(db, COLLECTIONS.users, props.uid), {
        displayName: trimmed,
        emailNotifications: notif,
        updatedAt: now,
      });
      if (props.playerId) {
        await updateDoc(doc(db, COLLECTIONS.players, props.playerId), {
          displayName: trimmed,
          updatedAt: now,
        });
      }
      await props.onSaved();
      setMsg("Saved.");
    } catch (e) {
      setErr(formatUnknownError(e));
    }
  }

  return (
    <section className="m-pane m-profile-pane">
      <div className="m-profile-head">
        <span className="m-avatar m-avatar-lg">{initials(props.displayName)}</span>
        <div>
          <p className="m-player-name">{props.displayName}</p>
          <p className="m-muted">{props.email}</p>
        </div>
      </div>
      <label className="m-setting-row">
        <span>Email notifications</span>
        <input
          type="checkbox"
          checked={notif}
          onChange={(e) => setNotif(e.target.checked)}
        />
      </label>
      <label className="m-field">
        <span className="label">Name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="m-field">
        <span className="label">Email</span>
        <input className="input" value={props.email} disabled />
      </label>
      {msg && <p className="m-ok">{msg}</p>}
      {err && <p className="m-error">{err}</p>}
      <button type="button" className="btn btn-primary m-full" onClick={save}>
        Save
      </button>
      <button
        type="button"
        className="btn m-signout"
        onClick={() => props.onSignOut()}
      >
        Sign Out
      </button>
    </section>
  );
}
