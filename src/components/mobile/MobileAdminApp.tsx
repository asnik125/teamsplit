"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MobileChrome } from "./MobileChrome";
import { MobileTouchTeamColumns } from "./MobileTouchTeamColumns";
import {
  useNearestGameSession,
  useSwipeFrames,
} from "@/hooks/useNearestGameSession";
import {
  adjacentTeamBuilderFrame,
  defaultAdminMobileTab,
  type AdminMobileTab,
  type TeamBuilderFrame,
} from "@/lib/mobile-nav";
import { formatDisplayDate, formatDisplayTime } from "@/lib/schedule";
import { gameHasNoGame } from "@/lib/no-game";
import { useAuth } from "@/lib/firebase/auth-context";
import type { AttendanceStatus } from "@/lib/types";

function statusLabel(s: AttendanceStatus): string {
  if (s === "playing") return "Playing";
  if (s === "maybe") return "Maybe";
  if (s === "not_playing") return "Not playing";
  return "—";
}

export function MobileAdminApp({
  initialTab = defaultAdminMobileTab(),
  gamesContent,
  playersContent,
}: {
  initialTab?: AdminMobileTab;
  /** Full Manage Games body (injected from page to avoid circular imports). */
  gamesContent?: ReactNode;
  /** Full Players admin body (injected from page). */
  playersContent?: ReactNode;
}) {
  const [tab, setTab] = useState<AdminMobileTab>(initialTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut, showAdminUI } = useAuth();
  const router = useRouter();

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // Real players never see this shell (RequireAuth adminOnly + showAdminUI).
  if (!showAdminUI) return null;

  function goTab(id: AdminMobileTab) {
    setTab(id);
    setMenuOpen(false);
    if (id === "manage-games" && !gamesContent) {
      router.push("/admin/games");
      return;
    }
    if (id === "players" && !playersContent) {
      router.push("/admin/players");
      return;
    }
    if (id === "team-builder") {
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        router.push("/");
      }
    }
  }

  return (
    <div className="m-app m-app-admin">
      <MobileChrome
        title={
          tab === "team-builder"
            ? "Team Builder"
            : tab === "manage-games"
              ? "Manage Games"
              : tab === "players"
                ? "Players"
                : "Settings"
        }
        onOpenMenu={() => setMenuOpen((v) => !v)}
        menu={
          menuOpen ? (
            <nav className="m-menu" aria-label="Admin mobile">
              {(
                [
                  ["team-builder", "Team Builder"],
                  ["manage-games", "Manage Games"],
                  ["players", "Players"],
                  ["settings", "Settings"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`m-menu-item${tab === id ? " m-menu-on" : ""}`}
                  onClick={() => goTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
          ) : null
        }
      />

      <nav className="m-admin-tabs" aria-label="Primary">
        {(
          [
            ["team-builder", "Builder"],
            ["manage-games", "Games"],
            ["players", "Players"],
            ["settings", "More"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`m-admin-tab${tab === id ? " m-admin-tab-on" : ""}`}
            onClick={() => goTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "team-builder" && <MobileAdminTeamBuilder />}
      {tab === "manage-games" && (
        <section className="m-pane m-pane-scroll">
          {gamesContent ?? (
            <p className="m-muted">
              Opening Manage Games…{" "}
              <Link href="/admin/games">Continue</Link>
            </p>
          )}
        </section>
      )}
      {tab === "players" && (
        <section className="m-pane m-pane-scroll">
          {playersContent ?? (
            <p className="m-muted">
              Opening Players… <Link href="/admin/players">Continue</Link>
            </p>
          )}
        </section>
      )}
      {tab === "settings" && (
        <section className="m-pane">
          <Link href="/admin/notifications" className="m-setting-link">
            Notifications
          </Link>
          <Link href="/profile" className="m-setting-link">
            Profile
          </Link>
          <button
            type="button"
            className="btn m-signout"
            onClick={async () => {
              await signOut();
              router.replace("/sign-in");
            }}
          >
            Sign Out
          </button>
        </section>
      )}
    </div>
  );
}

function MobileAdminTeamBuilder() {
  const session = useNearestGameSession();
  const [frame, setFrame] = useState<TeamBuilderFrame>("participants");
  const dragActiveRef = useRef(false);
  const swipe = useSwipeFrames({
    enabled: true,
    dragActiveRef,
    onPrev: () => setFrame((f) => adjacentTeamBuilderFrame(f, -1)),
    onNext: () => setFrame((f) => adjacentTeamBuilderFrame(f, 1)),
  });

  const game = session.teamsGame;

  return (
    <div {...swipe}>
      {session.error && <p className="m-error">{session.error}</p>}
      <div className="m-seg">
        <button
          type="button"
          className={frame === "participants" ? "active" : ""}
          onClick={() => setFrame("participants")}
        >
          Participants
        </button>
        <button
          type="button"
          className={frame === "teams" ? "active" : ""}
          onClick={() => setFrame("teams")}
        >
          Teams
        </button>
      </div>

      {!session.loaded || !game ? (
        <p className="m-muted m-pane">No upcoming game.</p>
      ) : frame === "participants" ? (
        <section className="m-pane">
          <div className="m-game-hero">
            <p className="m-game-date">{formatDisplayDate(game.date)}</p>
            <p className="m-game-meta">
              {formatDisplayTime(game.startTime)}
              {game.location ? ` · ${game.location}` : ""}
            </p>
            {session.showAdminUI && (
              <label className="m-nogame-toggle">
                <input
                  type="checkbox"
                  checked={gameHasNoGame(game)}
                  onChange={(e) =>
                    session.toggleNoGame(game.id, e.target.checked)
                  }
                />
                No Game
              </label>
            )}
          </div>
          <ul className="m-player-list">
            {session.players.map((p) => {
              const st = session.cellStatus(game.id, p.id);
              const locked = !session.canEditAttendanceOnGame(game);
              return (
                <li key={p.id} className="m-player-row">
                  <div className="m-player-main">
                    <p className="m-player-name">{p.displayName}</p>
                    <select
                      className="m-inline-select"
                      value={st === "no_response" ? "" : st}
                      disabled={locked || Boolean(session.savingKey)}
                      onChange={(e) => {
                        const v = e.target.value as AttendanceStatus;
                        if (!v) return;
                        session.changeStatus(game.id, p.id, v);
                      }}
                    >
                      <option value="">—</option>
                      <option value="playing">Playing</option>
                      <option value="maybe">Maybe</option>
                      <option value="not_playing">Not playing</option>
                    </select>
                  </div>
                  <span className={`m-status-tag m-tag-${st}`}>
                    {statusLabel(st)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="m-swipe-hint">Swipe for Teams →</p>
        </section>
      ) : (
        <section className="m-pane">
          <div className="m-game-hero">
            <p className="m-game-date">{formatDisplayDate(game.date)}</p>
            <p className="m-muted">{session.teamsView?.confirmedLabel}</p>
          </div>
          {session.showAdminUI && (
            <label className="m-setting-row">
              <span>Include Maybe</span>
              <input
                type="checkbox"
                checked={session.includeMaybe}
                disabled={Boolean(session.teamsView?.showProgress)}
                onChange={(e) => session.toggleIncludeMaybe(e.target.checked)}
              />
            </label>
          )}
          {session.teamsView?.showTeamLists ? (
            <MobileTouchTeamColumns
              teamA={session.teamsView.teamA}
              teamB={session.teamsView.teamB}
              editable={session.showAdminUI}
              dragActiveRef={dragActiveRef}
              onChange={(a, b) => session.persistManualTeams(a, b)}
            />
          ) : (
            <p className="m-muted">{session.teamsView?.teamsMessage}</p>
          )}
          <p className="m-swipe-hint">← Participants</p>
        </section>
      )}
    </div>
  );
}
