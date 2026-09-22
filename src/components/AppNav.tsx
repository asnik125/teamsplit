"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, type AppViewMode } from "@/lib/firebase/auth-context";
import { roleLabel } from "@/lib/roles";

export function AppNav() {
  const { profile, isAdmin, showAdminUI, viewMode, setViewMode, signOut } =
    useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (!profile) return null;

  function switchView(mode: AppViewMode) {
    if (mode === viewMode) return;
    setViewMode(mode);
    if (mode === "player" && pathname.startsWith("/admin")) {
      router.replace("/");
    } else if (mode === "admin" && !pathname.startsWith("/admin")) {
      router.replace("/admin/games");
    }
  }

  const navLinks = showAdminUI
    ? [
        { href: "/", label: "Game" },
        { href: "/admin/games", label: "Manage Games" },
        { href: "/admin/players", label: "Players" },
        { href: "/admin/notifications", label: "Notifications" },
      ]
    : [
        { href: "/", label: "Game" },
        { href: "/profile", label: "Profile" },
      ];

  return (
    <header className="app-nav">
      <div className="app-nav-brand">
        <h1>TeamSplit</h1>
        <p className="app-nav-meta">
          {profile.displayName} · {roleLabel(profile.role)}
        </p>
      </div>

      <nav className="app-nav-tabs" aria-label="Primary">
        {navLinks.map((l) => {
          const active =
            l.href === "/"
              ? pathname === "/"
              : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`app-nav-tab${active ? " app-nav-tab-active" : ""}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      <div className="app-nav-end">
        {isAdmin && (
          <div
            className="app-nav-view"
            role="group"
            aria-label="View mode"
          >
            <button
              type="button"
              className={`app-nav-view-label${
                viewMode === "admin" ? " app-nav-view-label-active" : ""
              }`}
              onClick={() => switchView("admin")}
              aria-pressed={viewMode === "admin"}
            >
              Admin View
            </button>
            <button
              type="button"
              className={`app-nav-view-switch${
                viewMode === "player" ? " app-nav-view-switch-player" : ""
              }`}
              onClick={() =>
                switchView(viewMode === "admin" ? "player" : "admin")
              }
              aria-label={
                viewMode === "admin"
                  ? "Switch to Player View"
                  : "Switch to Admin View"
              }
            >
              <span className="app-nav-view-knob" aria-hidden />
            </button>
            <button
              type="button"
              className={`app-nav-view-label${
                viewMode === "player" ? " app-nav-view-label-active" : ""
              }`}
              onClick={() => switchView("player")}
              aria-pressed={viewMode === "player"}
            >
              Player View
            </button>
          </div>
        )}

        <button
          type="button"
          className="btn btn-secondary app-nav-signout"
          onClick={() => signOut()}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
