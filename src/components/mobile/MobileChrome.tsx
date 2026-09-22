"use client";

import type { ReactNode } from "react";
import { useAuth, type AppViewMode } from "@/lib/firebase/auth-context";

export function MobileChrome({
  title,
  menu,
  onOpenMenu,
}: {
  title?: string;
  menu?: ReactNode;
  onOpenMenu?: () => void;
}) {
  const { profile, isAdmin, viewMode, setViewMode } = useAuth();

  function switchView(mode: AppViewMode) {
    if (mode === viewMode) return;
    setViewMode(mode);
  }

  return (
    <header className="m-chrome">
      <div className="m-chrome-row">
        <div className="m-chrome-brand">
          <span className="m-chrome-logo">TeamSplit</span>
          {title ? <span className="m-chrome-title">{title}</span> : null}
        </div>
        {isAdmin && (
          <div className="m-chrome-view" role="group" aria-label="View mode">
            <button
              type="button"
              className={`m-chrome-view-btn${viewMode === "admin" ? " m-chrome-view-on" : ""}`}
              onClick={() => switchView("admin")}
              aria-pressed={viewMode === "admin"}
            >
              Admin
            </button>
            <button
              type="button"
              className={`m-chrome-view-btn${viewMode === "player" ? " m-chrome-view-on" : ""}`}
              onClick={() => switchView("player")}
              aria-pressed={viewMode === "player"}
            >
              Player
            </button>
          </div>
        )}
        {onOpenMenu ? (
          <button
            type="button"
            className="m-chrome-menu-btn"
            aria-label="Menu"
            onClick={onOpenMenu}
          >
            ☰
          </button>
        ) : (
          <span className="m-chrome-menu-spacer" />
        )}
      </div>
      {profile ? (
        <p className="m-chrome-meta">{profile.displayName}</p>
      ) : null}
      {menu}
    </header>
  );
}
