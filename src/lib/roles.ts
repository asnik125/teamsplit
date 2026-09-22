import type { UserRole } from "./types";

/** Admin is the only staff role in MVP. */
export function isStaffRole(role: UserRole | string | null | undefined): boolean {
  return role === "admin";
}

export function roleLabel(role: UserRole | string): string {
  if (role === "admin") return "Admin";
  return "Player";
}
