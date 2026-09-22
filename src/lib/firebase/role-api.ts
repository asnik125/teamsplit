import type { User } from "firebase/auth";
import type { UserRole } from "../types";

export async function setUserRoleApi(
  user: User,
  input: { uid: string; role: UserRole; playerId?: string | null }
): Promise<{ previousRole: UserRole; nextRole: UserRole }> {
  const token = await user.getIdToken();
  const res = await fetch("/api/admin/users/role", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      uid: input.uid,
      role: input.role,
      playerId: input.playerId ?? null,
    }),
  });
  const data = (await res.json()) as {
    ok?: true;
    previousRole?: UserRole;
    nextRole?: UserRole;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Role update failed (${res.status})`);
  }
  return {
    previousRole: data.previousRole ?? "player",
    nextRole: data.nextRole ?? input.role,
  };
}

export async function deletePlayerApi(
  user: User,
  playerId: string
): Promise<{
  playerId: string;
  deletedAttendance: number;
  deletedEvaluation: boolean;
  deletedUserProfile: boolean;
  authDeleted: boolean;
  authAlreadyMissing: boolean;
}> {
  const token = await user.getIdToken();
  const res = await fetch("/api/admin/players/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ playerId }),
  });
  const data = (await res.json()) as {
    ok?: true;
    playerId?: string;
    deletedAttendance?: number;
    deletedEvaluation?: boolean;
    deletedUserProfile?: boolean;
    authDeleted?: boolean;
    authAlreadyMissing?: boolean;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Delete failed (${res.status})`);
  }
  return {
    playerId: data.playerId ?? playerId,
    deletedAttendance: data.deletedAttendance ?? 0,
    deletedEvaluation: Boolean(data.deletedEvaluation),
    deletedUserProfile: Boolean(data.deletedUserProfile),
    authDeleted: Boolean(data.authDeleted),
    authAlreadyMissing: Boolean(data.authAlreadyMissing),
  };
}

export async function setPlayerActiveApi(
  user: User,
  playerId: string,
  active: boolean
): Promise<{
  playerId: string;
  active: boolean;
  clearedAttendance: number;
}> {
  const token = await user.getIdToken();
  const res = await fetch("/api/admin/players/set-active", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ playerId, active }),
  });
  const data = (await res.json()) as {
    ok?: true;
    playerId?: string;
    active?: boolean;
    clearedAttendance?: number;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Active update failed (${res.status})`);
  }
  return {
    playerId: data.playerId ?? playerId,
    active: Boolean(data.active),
    clearedAttendance: data.clearedAttendance ?? 0,
  };
}
