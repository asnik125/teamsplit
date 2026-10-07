"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, type AppViewMode } from "@/lib/firebase/auth-context";
import {
  MOBILE_HOME_EVENT,
  mobileBrandHomeControl,
  shouldNavigateForMobileHome,
} from "@/lib/mobile-nav";

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
  const pathname = usePathname();
  const router = useRouter();
  const home = mobileBrandHomeControl({
    viewMode: isAdmin ? viewMode : "player",
    pageLabel: title,
  });

  function switchView(mode: AppViewMode) {
    if (mode === viewMode) return;
    setViewMode(mode);
  }

  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (shouldNavigateForMobileHome(pathname)) {
      router.push(home.href);
      return;
    }
    window.dispatchEvent(new Event(MOBILE_HOME_EVENT));
  }

  return (
    <header className="m-chrome">
      <div className="m-chrome-row">
        <div className="m-chrome-brand">
          <Link
            href={home.href}
            className="m-chrome-logo"
            aria-label={home.accessibleName}
            onClick={goHome}
          >
            {home.brandText}
          </Link>
          {home.pageLabel ? (
            <span className="m-chrome-title">{home.pageLabel}</span>
          ) : null}
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
