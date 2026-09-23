import type { UserProfile, UserRole } from "../types";

/**
 * Email opt-in for game notifications.
 * - Default ON when the field is missing/undefined (new + legacy docs).
 * - Explicit `false` = opt-out (respected for every role).
 * - Role (admin vs player) never affects eligibility.
 */
export function wantsEmailNotifications(
  profile: Pick<UserProfile, "emailNotifications"> | null | undefined
): boolean {
  if (!profile) return false;
  return profile.emailNotifications !== false;
}

/** Game emails are for linked accounts — Admin is not excluded by role. */
export function roleBlocksGameNotifications(
  role: UserRole | string | null | undefined
): boolean {
  void role;
  return false;
}
