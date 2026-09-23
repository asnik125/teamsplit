import type {
  AttendanceStatus,
  GameTeams,
  TeamMemberPublic,
} from "./types";
import {
  confirmedAttendanceLabel,
  DEFAULT_MIN_PLAYING_FOR_TEAMS,
  insufficientMessage,
} from "./team-sync";

export type PlayerTeamsPhase = "insufficient" | "updating" | "ready";

export interface PlayerGameViewModel {
  statusLabel: string;
  statusKind: AttendanceStatus;
  playingCount: number;
  maybeCount: number;
  includedCount: number;
  minPlaying: number;
  confirmedLabel: string;
  teamsPhase: PlayerTeamsPhase;
  teamsMessage: string;
  myTeamLabel: "Team A" | "Team B" | null;
  showTeamLists: boolean;
  showProgress: boolean;
  includeMaybePlayers: boolean;
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
}

function statusLabel(status: AttendanceStatus): string {
  if (status === "playing") return "PLAYING ✓";
  if (status === "maybe") return "MAYBE";
  if (status === "not_playing") return "NOT PLAYING";
  return "NO RESPONSE";
}

function findMyTeam(
  playerId: string | null | undefined,
  teams: GameTeams
): "Team A" | "Team B" | null {
  if (!playerId) return null;
  if (teams.teamA.some((m) => m.playerId === playerId)) return "Team A";
  if (teams.teamB.some((m) => m.playerId === playerId)) return "Team B";
  return null;
}

export function buildPlayerGameView(input: {
  myStatus: AttendanceStatus;
  myPlayerId: string | null | undefined;
  /** Playing attendance count (display). */
  playingCount: number;
  /** Maybe attendance count (display). */
  maybeCount: number;
  /** Count included in team generation (Playing, + Maybe if toggled). */
  includedCount: number;
  currentTeams: GameTeams | null;
  minPlaying?: number;
  isUpdating?: boolean;
  includeMaybePlayers?: boolean;
}): PlayerGameViewModel {
  const minPlaying = Math.max(
    2,
    Math.floor(input.minPlaying ?? DEFAULT_MIN_PLAYING_FOR_TEAMS)
  );
  const includeMaybePlayers = Boolean(
    input.includeMaybePlayers ?? input.currentTeams?.includeMaybePlayers
  );
  const {
    myStatus,
    myPlayerId,
    playingCount,
    maybeCount,
    includedCount,
    currentTeams,
    isUpdating,
  } = input;

  const confirmedLabel = confirmedAttendanceLabel({
    playingCount,
    maybeCount,
  });

  if (isUpdating) {
    return {
      statusLabel: statusLabel(myStatus),
      statusKind: myStatus,
      playingCount,
      maybeCount,
      includedCount,
      minPlaying,
      confirmedLabel,
      teamsPhase: "updating",
      teamsMessage: "Updating teams…",
      myTeamLabel: null,
      showTeamLists: false,
      showProgress: true,
      includeMaybePlayers,
      teamA: [],
      teamB: [],
    };
  }

  if (includedCount < minPlaying) {
    return {
      statusLabel: statusLabel(myStatus),
      statusKind: myStatus,
      playingCount,
      maybeCount,
      includedCount,
      minPlaying,
      confirmedLabel,
      teamsPhase: "insufficient",
      teamsMessage: insufficientMessage(minPlaying),
      myTeamLabel: null,
      showTeamLists: false,
      showProgress: false,
      includeMaybePlayers,
      teamA: [],
      teamB: [],
    };
  }

  const hasTeams =
    Boolean(currentTeams) &&
    currentTeams!.teamA.length + currentTeams!.teamB.length > 0;

  if (!hasTeams) {
    return {
      statusLabel: statusLabel(myStatus),
      statusKind: myStatus,
      playingCount,
      maybeCount,
      includedCount,
      minPlaying,
      confirmedLabel,
      teamsPhase: "updating",
      teamsMessage: "Updating teams…",
      myTeamLabel: null,
      showTeamLists: false,
      showProgress: true,
      includeMaybePlayers,
      teamA: [],
      teamB: [],
    };
  }

  const teams = currentTeams!;
  const myTeam =
    myStatus === "playing" || (includeMaybePlayers && myStatus === "maybe")
      ? findMyTeam(myPlayerId, teams)
      : null;

  return {
    statusLabel: statusLabel(myStatus),
    statusKind: myStatus,
    playingCount,
    maybeCount,
    includedCount,
    minPlaying,
    confirmedLabel,
    teamsPhase: "ready",
    teamsMessage: "Teams ready",
    myTeamLabel: myTeam,
    showTeamLists: true,
    showProgress: false,
    includeMaybePlayers,
    teamA: teams.teamA,
    teamB: teams.teamB,
  };
}
