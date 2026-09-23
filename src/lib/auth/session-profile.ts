import type { UserProfile, UserRole } from "../types";

const KNOWN_ROLES: ReadonlySet<string> = new Set(["admin", "player"]);

/**
 * Profile is sufficient to enter the app (identity + role + player link).
 * Does NOT require evaluations or other maintenance state.
 */
export function isHealthyUserProfile(
  profile: UserProfile | null | undefined
): profile is UserProfile {
  if (!profile) return false;
  if (profile.active !== true) return false;
  if (typeof profile.uid !== "string" || !profile.uid.trim()) return false;
  if (typeof profile.playerId !== "string" || !profile.playerId.trim()) {
    return false;
  }
  if (typeof profile.role !== "string" || !KNOWN_ROLES.has(profile.role)) {
    return false;
  }
  return true;
}

/** True when login/session must await /api/auth/provision before UI. */
export function needsBlockingProvision(
  profile: UserProfile | null | undefined
): boolean {
  return !isHealthyUserProfile(profile);
}

/**
 * Signup always needs blocking provision (create profile + player link).
 * Login only when the Firestore profile is missing/incomplete.
 */
export function shouldBlockOnProvision(input: {
  mode: "login" | "signup";
  profile: UserProfile | null | undefined;
}): boolean {
  if (input.mode === "signup") return true;
  return needsBlockingProvision(input.profile);
}

/** Observer must not re-run provisioning when this UID is already session-ready. */
export function shouldSkipAuthObserverResolve(input: {
  nextUid: string;
  resolvedUid: string | null;
  sessionHealthy: boolean;
}): boolean {
  return (
    input.sessionHealthy &&
    input.resolvedUid != null &&
    input.resolvedUid === input.nextUid
  );
}

export function roleFromHealthyProfile(
  profile: UserProfile
): UserRole {
  return profile.role === "admin" ? "admin" : "player";
}
