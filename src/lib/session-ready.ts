/**
 * Pure readiness helpers for auth / viewport / role UI gating.
 * Keeps one stable loading shell until each gate is actually ready.
 */

export type SessionSurface =
  | "loading"
  | "sign-in"
  | "app"
  | "blocked";

/** Sign-in form must wait until Firebase Auth has resolved to "no user". */
export function shouldShowSignInForm(input: {
  authResolved: boolean;
  loading: boolean;
  userPresent: boolean;
  /** Local submit in progress (password sent; waiting for session). */
  authActionPending?: boolean;
}): boolean {
  if (!input.authResolved) return false;
  if (input.loading) return false;
  if (input.authActionPending) return false;
  if (input.userPresent) return false;
  return true;
}

/** Desktop/mobile content waits until viewport width is measured. */
export function shouldRenderViewportContent(input: {
  viewportReady: boolean;
}): boolean {
  return input.viewportReady === true;
}

/**
 * Which mobile shell to show once auth + profile are known.
 * Returns null while role/profile is unresolved (caller shows loading).
 */
export function selectAuthenticatedMobileSurface(input: {
  authResolved: boolean;
  loading: boolean;
  profileReady: boolean;
  showAdminUI: boolean;
  hasMobileAdmin: boolean;
}): "loading" | "admin" | "player" {
  if (!input.authResolved || input.loading || !input.profileReady) {
    return "loading";
  }
  if (input.showAdminUI && input.hasMobileAdmin) return "admin";
  return "player";
}

/** Top-level surface after logout / cold start / login. */
export function selectSessionSurface(input: {
  authResolved: boolean;
  loading: boolean;
  userPresent: boolean;
  profileReady: boolean;
  authActionPending?: boolean;
}): SessionSurface {
  if (!input.authResolved || input.loading || input.authActionPending) {
    return "loading";
  }
  if (!input.userPresent) return "sign-in";
  if (!input.profileReady) return "loading";
  return "app";
}

/** Prefer keeping loading when switching users until profile matches uid. */
export function shouldKeepAuthLoading(input: {
  nextUid: string | null;
  currentProfileUid: string | null;
  profileFetchInFlight: boolean;
}): boolean {
  if (input.profileFetchInFlight) return true;
  if (!input.nextUid) return false;
  return input.currentProfileUid !== input.nextUid;
}
