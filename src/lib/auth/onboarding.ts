import type { Player, UserProfile, UserRole } from "../types";

/** Deterministic player id for a self-registered Auth uid — makes retries idempotent. */
export function playerIdForAuthUid(uid: string): string {
  return `p_${uid}`;
}

export const ONBOARDING_USER_MESSAGE =
  "We couldn't finish setting up your TeamSplit account. Please try signing in again. If this keeps happening, contact an Admin.";

export const DUPLICATE_DISPLAY_NAME_MESSAGE =
  "That player name is already taken. Please choose a different name.";

/** Case-insensitive, trimmed, collapsed whitespace — for uniqueness only. */
export function normalizeDisplayNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Find another player with the same display name (case-insensitive).
 * Inactive players still occupy a name so the Attendance/Players list stays clear.
 */
export function findDisplayNameConflict(input: {
  displayName: string;
  players: Pick<Player, "id" | "displayName">[];
  excludePlayerId?: string | null;
}): Pick<Player, "id" | "displayName"> | null {
  const key = normalizeDisplayNameKey(input.displayName);
  if (!key) return null;
  for (const p of input.players) {
    if (input.excludePlayerId && p.id === input.excludePlayerId) continue;
    if (normalizeDisplayNameKey(p.displayName) === key) return p;
  }
  return null;
}

export interface OnboardingInput {
  uid: string;
  email: string;
  displayName: string;
  /** Rejected if anything other than player / omitted */
  requestedRole?: string | null;
  nowIso: string;
}

export type OnboardingPlan =
  | {
      ok: true;
      playerId: string;
      player: Player;
      profile: UserProfile;
    }
  | { ok: false; error: string; status: 400 | 403 };

/**
 * Build the Player + UserProfile for a new self-registration.
 * Always creates a NEW player owned by this uid (never claims seeded players by name/email).
 * Role is always player.
 * Display-name uniqueness is enforced separately (ensureRegisteredPlayerOnboarding).
 */
export function planSelfRegistration(input: OnboardingInput): OnboardingPlan {
  const email = input.email.trim().toLowerCase();
  const uid = input.uid.trim();
  if (!uid) {
    return { ok: false, error: "Missing account id", status: 400 };
  }
  if (!email) {
    return { ok: false, error: "Email is required", status: 400 };
  }
  if (input.requestedRole != null && input.requestedRole !== "player") {
    return {
      ok: false,
      error: "Registration can only create Player accounts",
      status: 403,
    };
  }

  const displayName =
    input.displayName.trim() || email.split("@")[0] || "Player";
  if (!normalizeDisplayNameKey(displayName)) {
    return { ok: false, error: "Display name is required", status: 400 };
  }

  const playerId = playerIdForAuthUid(uid);
  const role: UserRole = "player";

  const player: Player = {
    id: playerId,
    displayName,
    email,
    active: true,
    linkedUid: uid,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };

  const profile: UserProfile = {
    uid,
    playerId,
    displayName,
    email,
    role,
    emailNotifications: true,
    active: true,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };

  return { ok: true, playerId, player, profile };
}

/** Password reset is Auth-only — TeamSplit role/linkage must stay unchanged. */
export function passwordResetTouchesTeamSplitRole(): boolean {
  return false;
}
