"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MobileChrome } from "./MobileChrome";
import { MobileGameSelector } from "./MobileGameSelector";
import { MobileAttendanceTable } from "./MobileAttendanceTable";
import { MobileTouchTeamColumns } from "./MobileTouchTeamColumns";
import {
  useNearestGameSession,
  useSwipeFrames,
} from "@/hooks/useNearestGameSession";
import {
  adjacentTeamBuilderFrame,
  defaultAdminMobileTab,
  defaultTeamBuilderFrame,
  type AdminMobileTab,
  type TeamBuilderFrame,
} from "@/lib/mobile-nav";
import { useAuth } from "@/lib/firebase/auth-context";

export function MobileAdminApp({
  initialTab = defaultAdminMobileTab(),
  gamesContent,
  playersContent,
  notificationsContent,
  profileContent,
}: {
  initialTab?: AdminMobileTab;
  /** Full Manage Games body (injected from page to avoid circular imports). */
  gamesContent?: ReactNode;
  /** Full Players admin body (injected from page). */
  playersContent?: ReactNode;
  notificationsContent?: ReactNode;
  profileContent?: ReactNode;
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
    if (id === "notifications" && !notificationsContent) {
      router.push("/admin/notifications");
      return;
    }
    if (id === "profile" && !profileContent) {
      router.push("/profile");
      return;
    }
    if (id === "team-builder") {
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        router.push("/");
      }
    }
  }

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    router.replace("/sign-in");
  }

  const title =
    tab === "team-builder"
      ? "Game"
      : tab === "manage-games"
        ? "Games"
        : tab === "players"
          ? "Players"
          : tab === "notifications"
            ? "Notifications"
            : "Profile";

  return (
    <div className="m-app m-app-admin">
      <MobileChrome
        title={title}
        onOpenMenu={() => setMenuOpen((v) => !v)}
        menu={
          menuOpen ? (
            <nav className="m-menu" aria-label="Admin menu">
              <button
                type="button"
                className={`m-menu-item${tab === "manage-games" ? " m-menu-on" : ""}`}
                onClick={() => goTab("manage-games")}
              >
                Games
              </button>
              <button
                type="button"
                className={`m-menu-item${tab === "players" ? " m-menu-on" : ""}`}
                onClick={() => goTab("players")}
              >
                Players
              </button>
              <button
                type="button"
                className={`m-menu-item${tab === "notifications" ? " m-menu-on" : ""}`}
                onClick={() => goTab("notifications")}
              >
                Notifications
              </button>
              <button
                type="button"
                className={`m-menu-item${tab === "profile" ? " m-menu-on" : ""}`}
                onClick={() => goTab("profile")}
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

      {tab === "team-builder" && <MobileAdminTeamBuilder />}
      {tab === "manage-games" && (
        <section className="m-pane m-pane-scroll">
          {gamesContent ?? (
            <p className="m-muted">
              Opening Games… <Link href="/admin/games">Continue</Link>
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
      {tab === "notifications" && (
        <section className="m-pane m-pane-scroll">
          {notificationsContent ?? (
            <p className="m-muted">
              Opening Notifications…{" "}
              <Link href="/admin/notifications">Continue</Link>
            </p>
          )}
        </section>
      )}
      {tab === "profile" && (
        <section className="m-pane m-pane-scroll">
          {profileContent ?? (
            <p className="m-muted">
              Opening Profile… <Link href="/profile">Continue</Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function MobileAdminTeamBuilder() {
  const session = useNearestGameSession();
  const [frame, setFrame] = useState<TeamBuilderFrame>(
    defaultTeamBuilderFrame()
  );
  const dragActiveRef = useRef(false);
  const swipe = useSwipeFrames({
    enabled: true,
    dragActiveRef,
    onPrev: () => setFrame((f) => adjacentTeamBuilderFrame(f, -1)),
    onNext: () => setFrame((f) => adjacentTeamBuilderFrame(f, 1)),
  });

  const game = session.selectedGame;
  const locked = game ? !session.canEditAttendanceOnGame(game) : true;

  return (
    <div {...swipe}>
      {session.error && <p className="m-error">{session.error}</p>}
      <div className="m-seg">
        <button
          type="button"
          className={frame === "teams" ? "active" : ""}
          onClick={() => setFrame("teams")}
        >
          Teams
        </button>
        <button
          type="button"
          className={frame === "participants" ? "active" : ""}
          onClick={() => setFrame("participants")}
        >
          Participants
        </button>
      </div>

      {!session.loaded || !game ? (
        <p className="m-muted m-pane">No upcoming game.</p>
      ) : (
        <section className="m-pane">
          <MobileGameSelector
            games={session.games}
            selectedGameId={session.selectedGameId}
            onSelect={session.selectGame}
            showNoGameToggle={session.showAdminUI}
            onToggleNoGame={session.toggleNoGame}
          />

          {frame === "teams" ? (
            <>
              <p className="m-muted">{session.teamsView?.confirmedLabel}</p>
              {session.showAdminUI && (
                <label className="m-setting-row">
                  <span>Include Maybe</span>
                  <input
                    type="checkbox"
                    checked={session.includeMaybe}
                    disabled={Boolean(session.updatingTeams)}
                    onChange={(e) =>
                      session.toggleIncludeMaybe(e.target.checked)
                    }
                  />
                </label>
              )}
              {session.showAdminUI ? (
                <div className="m-teams-actions">
                  <button
                    type="button"
                    className="btn btn-primary m-full"
                    disabled={
                      session.updatingTeams ||
                      session.teamsView?.teamsPhase === "insufficient"
                    }
                    onClick={() => session.generateTeams()}
                  >
                    {session.updatingTeams ? "Working…" : "Generate Teams"}
                  </button>
                </div>
              ) : null}
              {session.teamsView?.teamsPhase === "stale" ? (
                <p className="m-error">{session.teamsView.teamsMessage}</p>
              ) : session.teamsView?.teamsMessage ? (
                <p className="m-muted">{session.teamsView.teamsMessage}</p>
              ) : null}
              {session.teamsView?.showTeamLists ? (
                <MobileTouchTeamColumns
                  teamA={session.teamsView.teamA}
                  teamB={session.teamsView.teamB}
                  editable={session.showAdminUI}
                  dragActiveRef={dragActiveRef}
                  onChange={(a, b) => session.persistManualTeams(a, b)}
                />
              ) : null}
              <p className="m-swipe-hint">Swipe for Participants →</p>
            </>
          ) : (
            <>
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
              <p className="m-swipe-hint">← Teams</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
