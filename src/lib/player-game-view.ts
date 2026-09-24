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
import {
  areTeamsStale,
  TEAMS_AWAITING_GENERATE_MESSAGE,
  TEAMS_STALE_MESSAGE,
  teamsHaveComposition,
} from "./team-eligibility";

export type PlayerTeamsPhase =
  | "insufficient"
  | "updating"
  | "ready"
  | "stale"
  | "awaiting_generate";

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
  stale: boolean;
  manuallyAdjusted: boolean;
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
  playingCount: number;
  maybeCount: number;
  includedCount: number;
  currentTeams: GameTeams | null;
  minPlaying?: number;
  isUpdating?: boolean;
  includeMaybePlayers?: boolean;
  /** Current eligible ids for stale detection (optional; uses teams.stale if omitted). */
  currentEligibleIds?: string[];
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

  const base = {
    statusLabel: statusLabel(myStatus),
    statusKind: myStatus,
    playingCount,
    maybeCount,
    includedCount,
    minPlaying,
    confirmedLabel,
    includeMaybePlayers,
    manuallyAdjusted: Boolean(currentTeams?.manuallyAdjusted),
  };

  if (isUpdating) {
    return {
      ...base,
      teamsPhase: "updating",
      teamsMessage: "Updating…",
      myTeamLabel: null,
      showTeamLists: false,
      showProgress: true,
      teamA: [],
      teamB: [],
      stale: false,
    };
  }

  if (includedCount < minPlaying) {
    const hasLists = teamsHaveComposition(currentTeams);
    return {
      ...base,
      teamsPhase: "insufficient",
      teamsMessage: insufficientMessage(minPlaying),
      myTeamLabel: null,
      showTeamLists: hasLists,
      showProgress: false,
      teamA: currentTeams?.teamA ?? [],
      teamB: currentTeams?.teamB ?? [],
      stale: hasLists,
    };
  }

  const hasTeams = teamsHaveComposition(currentTeams);
  const isStale =
    hasTeams &&
    (Boolean(currentTeams!.stale) ||
      (input.currentEligibleIds
        ? areTeamsStale({
            teams: currentTeams,
            currentEligibleIds: input.currentEligibleIds,
          })
        : false));

  if (!hasTeams) {
    return {
      ...base,
      teamsPhase: "awaiting_generate",
      teamsMessage: TEAMS_AWAITING_GENERATE_MESSAGE,
      myTeamLabel: null,
      showTeamLists: false,
      showProgress: false,
      teamA: [],
      teamB: [],
      stale: false,
    };
  }

  const teams = currentTeams!;
  const myTeam =
    myStatus === "playing" || (includeMaybePlayers && myStatus === "maybe")
      ? findMyTeam(myPlayerId, teams)
      : null;

  if (isStale) {
    return {
      ...base,
      teamsPhase: "stale",
      teamsMessage: TEAMS_STALE_MESSAGE,
      myTeamLabel: myTeam,
      showTeamLists: true,
      showProgress: false,
      teamA: teams.teamA,
      teamB: teams.teamB,
      stale: true,
    };
  }

  return {
    ...base,
    teamsPhase: "ready",
    teamsMessage: "Teams ready",
    myTeamLabel: myTeam,
    showTeamLists: true,
    showProgress: false,
    teamA: teams.teamA,
    teamB: teams.teamB,
    stale: false,
  };
}
