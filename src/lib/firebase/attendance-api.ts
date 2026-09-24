import type { User } from "firebase/auth";
import type { AttendanceStatus, TeamMemberPublic } from "../types";

export interface AttendanceSyncApiResult {
  ok: true;
  message: string;
  action: string;
  playingCount: number;
  includedCount?: number;
  markStale: boolean;
  previousStatus: AttendanceStatus | null;
  nextStatus: AttendanceStatus;
  displayName: string;
}

export async function setAttendanceAndSync(
  user: User,
  gameId: string,
  playerId: string,
  status: AttendanceStatus
): Promise<AttendanceSyncApiResult> {
  const token = await user.getIdToken();
  const res = await fetch("/api/attendance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ gameId, playerId, status }),
  });
  const data = (await res.json()) as AttendanceSyncApiResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Attendance sync failed (${res.status})`);
  }
  return data;
}

export async function setIncludeMaybeApi(
  user: User,
  gameId: string,
  includeMaybePlayers: boolean
): Promise<{ ok: true; message: string; includedCount: number }> {
  const token = await user.getIdToken();
  const res = await fetch("/api/teams/include-maybe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ gameId, includeMaybePlayers }),
  });
  const data = (await res.json()) as {
    ok?: true;
    message?: string;
    includedCount?: number;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Failed (${res.status})`);
  }
  return {
    ok: true,
    message: data.message ?? "Teams ready",
    includedCount: data.includedCount ?? 0,
  };
}

export async function saveManualTeamsApi(
  user: User,
  gameId: string,
  teamA: TeamMemberPublic[],
  teamB: TeamMemberPublic[]
): Promise<void> {
  const token = await user.getIdToken();
  const res = await fetch("/api/teams/manual", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ gameId, teamA, teamB }),
  });
  const data = (await res.json()) as { ok?: true; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Save failed (${res.status})`);
  }
}

export async function regenerateTeamsApi(
  user: User,
  gameId: string
): Promise<{
  ok: true;
  message: string;
  action: string;
  playingCount: number;
}> {
  const token = await user.getIdToken();
  const res = await fetch("/api/teams/regenerate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ gameId }),
  });
  const data = (await res.json()) as {
    ok?: true;
    message?: string;
    action?: string;
    playingCount?: number;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Generate failed (${res.status})`);
  }
  return {
    ok: true,
    message: data.message ?? "Teams generated.",
    action: data.action ?? "created",
    playingCount: data.playingCount ?? 0,
  };
}

export async function ensureTeamsIntegrityApi(
  user: User
): Promise<{ ok: true; gameId: string | null; repaired: boolean }> {
  const token = await user.getIdToken();
  const res = await fetch("/api/teams/ensure-integrity", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  const data = (await res.json()) as {
    ok?: true;
    gameId?: string | null;
    repaired?: boolean;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Ensure integrity failed (${res.status})`);
  }
  return {
    ok: true,
    gameId: data.gameId ?? null,
    repaired: Boolean(data.repaired),
  };
}

export async function setGameNoGameApi(
  user: User,
  gameId: string,
  noGame: boolean
): Promise<{ ok: true; noGame: boolean; clearedAttendance: number }> {
  const token = await user.getIdToken();
  const res = await fetch("/api/games/no-game", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ gameId, noGame }),
  });
  const data = (await res.json()) as {
    ok?: true;
    noGame?: boolean;
    clearedAttendance?: number;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `No Game update failed (${res.status})`);
  }
  return {
    ok: true,
    noGame: Boolean(data.noGame),
    clearedAttendance: data.clearedAttendance ?? 0,
  };
}
