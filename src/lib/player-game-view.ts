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

export type TeamSide = "A" | "B";
export type TeamDisplayName = "Team Black" | "Team White";
export type ThreeTeamSide = "A" | "B" | "C";
export type MyTeamLabel = TeamDisplayName | "Team Red";

/** User-facing name. Side A is Team Black; side B is Team White. */
export function teamDisplayName(side: TeamSide): TeamDisplayName {
  return side === "A" ? "Team Black" : "Team White";
}

/**
 * Display name for a side. Two-team and three-team games both use
 * Team Black and Team White. The third side is Team Red.
 */
export function rosterTeamLabel(side: ThreeTeamSide): MyTeamLabel {
  if (side === "A") return "Team Black";
  if (side === "B") return "Team White";
  return "Team Red";
}

export function visibleTeamColumns(view: {
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  teamC: TeamMemberPublic[];
}): { side: ThreeTeamSide; title: MyTeamLabel; members: TeamMemberPublic[] }[] {
  const threeTeams = view.teamC.length > 0;
  const columns: {
    side: ThreeTeamSide;
    title: MyTeamLabel;
    members: TeamMemberPublic[];
  }[] = [
    { side: "A", title: rosterTeamLabel("A"), members: view.teamA },
    { side: "B", title: rosterTeamLabel("B"), members: view.teamB },
  ];
  if (threeTeams) {
    columns.push({
      side: "C",
      title: rosterTeamLabel("C"),
      members: view.teamC,
    });
  }
  return columns;
}

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
  myTeamLabel: MyTeamLabel | null;
  showTeamLists: boolean;
  showProgress: boolean;
  includeMaybePlayers: boolean;
  teamA: TeamMemberPublic[];
  teamB: TeamMemberPublic[];
  teamC: TeamMemberPublic[];
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
): MyTeamLabel | null {
  if (!playerId) return null;
  if (teams.teamA.some((m) => m.playerId === playerId)) {
    return rosterTeamLabel("A");
  }
  if (teams.teamB.some((m) => m.playerId === playerId)) {
    return rosterTeamLabel("B");
  }
  if (teams.teamC?.some((m) => m.playerId === playerId)) {
    return rosterTeamLabel("C");
  }
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
      teamC: [],
      stale: false,
    };
  }

  if (playingCount < minPlaying) {
    return {
      ...base,
      teamsPhase: "insufficient",
      teamsMessage: insufficientMessage(minPlaying),
      myTeamLabel: null,
      showTeamLists: false,
      showProgress: false,
      teamA: [],
      teamB: [],
      teamC: [],
      stale: false,
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
      teamC: [],
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
      teamC: teams.teamC ?? [],
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
    teamC: teams.teamC ?? [],
    stale: false,
  };
}
