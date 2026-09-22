"use client";

/**
 * Neutral TeamSplit loading shell used while auth, profile, or viewport resolve.
 * Must look the same everywhere to avoid multi-screen flashes.
 */
export function AppLoadingShell({
  label = "Loading…",
}: {
  label?: string;
}) {
  return (
    <div
      className="app-loading-shell"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="app-loading-shell"
    >
      <p className="app-loading-brand">TeamSplit</p>
      <p className="app-loading-label">{label}</p>
    </div>
  );
}
