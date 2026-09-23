"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { MobileChrome } from "./MobileChrome";
import { MobileGameSelector } from "./MobileGameSelector";
import { MobileAttendanceTable } from "./MobileAttendanceTable";
import {
  useNearestGameSession,
  useSwipeFrames,
} from "@/hooks/useNearestGameSession";
import {
  adjacentPlayerFrame,
  defaultPlayerMobileFrame,
  type PlayerMobileFrame,
} from "@/lib/mobile-nav";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const dragActiveRef = useRef(false);

  useEffect(() => {
    setFrame(initialFrame);
  }, [initialFrame]);

  const swipe = useSwipeFrames({
    enabled: frame !== "profile",
    dragActiveRef,
    onPrev: () => setFrame((f) => adjacentPlayerFrame(f, -1)),
    onNext: () => setFrame((f) => adjacentPlayerFrame(f, 1)),
  });

  const game = session.selectedGame;
  const locked = game ? !session.canEditAttendanceOnGame(game) : true;

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    router.replace("/sign-in");
  }

  return (
    <div className="m-app" {...swipe}>
      <MobileChrome
        title={frame === "profile" ? "Profile" : "Game"}
        onOpenMenu={() => setMenuOpen((v) => !v)}
        menu={
          menuOpen ? (
            <nav className="m-menu" aria-label="Player menu">
              <button
                type="button"
                className={`m-menu-item${frame === "profile" ? " m-menu-on" : ""}`}
                onClick={() => {
                  setFrame("profile");
                  setMenuOpen(false);
                }}
              >
                Profile
              </button>
              <button
                type="button"
                className="m-menu-item"
                onClick={() => handleSignOut()}
              >
                Sign out
              </button>
            </nav>
          ) : null
        }
      />
      {session.error && <p className="m-error">{session.error}</p>}

      {frame !== "profile" && (
        <div className="m-dots" aria-hidden>
          {(["attendance", "teams"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`m-dot${frame === f ? " m-dot-on" : ""}`}
              aria-label={f}
              onClick={() => setFrame(f)}
            />
          ))}
        </div>
      )}

      {frame === "attendance" && (
        <section className="m-pane">
          {!session.loaded ? (
            <p className="m-muted">Loading…</p>
          ) : !game ? (
            <p className="m-muted">No upcoming game.</p>
          ) : (
            <>
              <MobileGameSelector
                games={session.games}
                selectedGameId={session.selectedGameId}
                onSelect={session.selectGame}
                showNoGameBanner
              />

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

              <MobileAttendanceTable
                game={game}
                players={session.players}
                myPlayerId={session.myPlayerId}
                cellStatus={session.cellStatus}
                canEditPlayer={session.canEditPlayer}
                attendanceLocked={locked}
                savingKey={session.savingKey}
                onChangeStatus={session.changeStatus}
                showFilters
              />
              <p className="m-swipe-hint">Swipe for Teams →</p>
            </>
          )}
        </section>
      )}

      {frame === "teams" && (
        <section className="m-pane">
          {!session.loaded ? (
            <p className="m-muted">Loading…</p>
          ) : !game || !session.teamsView ? (
            <p className="m-muted">No teams yet.</p>
          ) : (
            <>
              <MobileGameSelector
                games={session.games}
                selectedGameId={session.selectedGameId}
                onSelect={session.selectGame}
                showNoGameBanner
              />
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
              <p className="m-swipe-hint">← Attendance</p>
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
    </section>
  );
}
