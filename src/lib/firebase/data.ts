import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  type Firestore,
} from "firebase/firestore";
import type {
  AttendanceRecord,
  AttendanceStatus,
  Game,
  GameTeams,
  Player,
  PlayerEvaluation,
  PlayerRatings,
  SimplePlayerEvaluation,
  SimplePlayerRatings,
  UserProfile,
  AppSettings,
} from "../types";
import {
  RATING_KEYS,
  sanitizeTeamMembers,
  parseTeamRatingSystem,
} from "../types";
import { DEFAULT_MIN_PLAYING_FOR_TEAMS } from "../team-sync";
import {
  nextUpcomingGame as nextUpcomingGameFromSchedule,
  gameHasNotStarted,
  gameStartMs,
} from "../schedule";

export const COLLECTIONS = {
  users: "users",
  players: "players",
  playerEvaluations: "playerEvaluations",
  playerEvaluationsSimple: "playerEvaluationsSimple",
  games: "games",
  gameTeams: "gameTeams",
  settings: "settings",
} as const;

export const APP_SETTINGS_DOC = "app";

export function defaultAppSettings(): AppSettings {
  return {
    minPlayingForTeams: DEFAULT_MIN_PLAYING_FOR_TEAMS,
    allowPlayersEditOthersAttendance: true,
    teamRatingSystem: "classic",
    updatedAt: new Date(0).toISOString(),
    updatedBy: null,
  };
}

export async function getAppSettings(db: Firestore): Promise<AppSettings> {
  const snap = await getDoc(doc(db, COLLECTIONS.settings, APP_SETTINGS_DOC));
  if (!snap.exists()) return defaultAppSettings();
  const data = snap.data() as Partial<AppSettings>;
  const min = Number(data.minPlayingForTeams);
  return {
    minPlayingForTeams:
      Number.isFinite(min) && min >= 2
        ? Math.floor(min)
        : DEFAULT_MIN_PLAYING_FOR_TEAMS,
    allowPlayersEditOthersAttendance:
      data.allowPlayersEditOthersAttendance !== false,
    teamRatingSystem: parseTeamRatingSystem(data.teamRatingSystem),
    updatedAt: data.updatedAt ?? defaultAppSettings().updatedAt,
    updatedBy: data.updatedBy ?? null,
  };
}

export async function saveAppSettings(
  db: Firestore,
  settings: AppSettings
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.settings, APP_SETTINGS_DOC), settings);
}

function nowIso() {
  return new Date().toISOString();
}

export async function getUserProfile(
  db: Firestore,
  uid: string
): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

export async function listPlayers(db: Firestore): Promise<Player[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.players));
  return snap.docs.map((d) => d.data() as Player);
}

export async function getPlayer(
  db: Firestore,
  playerId: string
): Promise<Player | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.players, playerId));
  if (!snap.exists()) return null;
  return snap.data() as Player;
}

export async function upsertPlayer(
  db: Firestore,
  player: Player
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.players, player.id), player);
}

export async function getEvaluation(
  db: Firestore,
  playerId: string
): Promise<PlayerEvaluation | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.playerEvaluations, playerId));
  if (!snap.exists()) return null;
  return snap.data() as PlayerEvaluation;
}

export async function listEvaluations(
  db: Firestore
): Promise<PlayerEvaluation[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.playerEvaluations));
  return snap.docs.map((d) => d.data() as PlayerEvaluation);
}

export async function upsertEvaluation(
  db: Firestore,
  playerId: string,
  ratings: PlayerRatings,
  updatedBy: string | null
): Promise<void> {
  const payload: PlayerEvaluation = {
    playerId,
    ...ratings,
    updatedAt: nowIso(),
    updatedBy,
  };
  await setDoc(doc(db, COLLECTIONS.playerEvaluations, playerId), payload);
}

export function emptyRatings(defaultValue = 6): PlayerRatings {
  return Object.fromEntries(
    RATING_KEYS.map((k) => [k, defaultValue])
  ) as PlayerRatings;
}

export async function getSimpleEvaluation(
  db: Firestore,
  playerId: string
): Promise<SimplePlayerEvaluation | null> {
  const snap = await getDoc(
    doc(db, COLLECTIONS.playerEvaluationsSimple, playerId)
  );
  if (!snap.exists()) return null;
  return snap.data() as SimplePlayerEvaluation;
}

export async function listSimpleEvaluations(
  db: Firestore
): Promise<SimplePlayerEvaluation[]> {
  const snap = await getDocs(
    collection(db, COLLECTIONS.playerEvaluationsSimple)
  );
  return snap.docs.map((d) => d.data() as SimplePlayerEvaluation);
}

export async function upsertSimpleEvaluation(
  db: Firestore,
  playerId: string,
  ratings: SimplePlayerRatings,
  updatedBy: string | null
): Promise<void> {
  const payload: SimplePlayerEvaluation = {
    playerId,
    ...ratings,
    updatedAt: nowIso(),
    updatedBy,
  };
  await setDoc(
    doc(db, COLLECTIONS.playerEvaluationsSimple, playerId),
    payload
  );
}

function normalizeGame(id: string, data: Partial<Game>): Game {
  return {
    ...(data as Game),
    id,
    noGame: Boolean(data.noGame),
    teamsMayBeStale: Boolean(data.teamsMayBeStale),
    teamsStatusMessage: data.teamsStatusMessage ?? null,
    lastAttendanceChange: data.lastAttendanceChange ?? null,
  };
}

export async function listGames(db: Firestore): Promise<Game[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.games), orderBy("date", "asc"))
  );
  return snap.docs.map((d) => normalizeGame(d.id, d.data() as Partial<Game>));
}

export async function getGame(
  db: Firestore,
  gameId: string
): Promise<Game | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.games, gameId));
  if (!snap.exists()) return null;
  return normalizeGame(gameId, snap.data() as Partial<Game>);
}

export async function upsertGame(db: Firestore, game: Game): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.games, game.id), game);
}

export async function upsertGames(db: Firestore, games: Game[]): Promise<void> {
  await Promise.all(games.map((g) => upsertGame(db, g)));
}

export async function cancelGame(db: Firestore, gameId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.games, gameId), {
    status: "cancelled",
    updatedAt: nowIso(),
  });
}

export async function deleteGame(db: Firestore, gameId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.games, gameId));
}

export function attendanceDocId(gameId: string, playerId: string) {
  return `${gameId}_${playerId}`;
}

export async function listAttendanceForGame(
  db: Firestore,
  gameId: string
): Promise<AttendanceRecord[]> {
  const snap = await getDocs(
    query(collection(db, "attendance"), where("gameId", "==", gameId))
  );
  return snap.docs.map((d) => d.data() as AttendanceRecord);
}

export async function setAttendance(
  db: Firestore,
  gameId: string,
  playerId: string,
  status: AttendanceStatus,
  updatedBy: string | null
): Promise<void> {
  const record: AttendanceRecord = {
    gameId,
    playerId,
    status,
    updatedAt: nowIso(),
    updatedBy,
  };
  await setDoc(doc(db, "attendance", attendanceDocId(gameId, playerId)), record);
}

export async function markTeamsStale(
  db: Firestore,
  gameId: string
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.games, gameId), {
    teamsMayBeStale: true,
    updatedAt: nowIso(),
  });
}

export async function getGameTeams(
  db: Firestore,
  gameId: string
): Promise<GameTeams | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.gameTeams, gameId));
  if (!snap.exists()) return null;
  const data = snap.data() as GameTeams;
  return {
    ...data,
    teamA: sanitizeTeamMembers(data.teamA),
    teamB: sanitizeTeamMembers(data.teamB),
    manuallyAdjusted: Boolean(data.manuallyAdjusted),
    includeMaybePlayers: Boolean(data.includeMaybePlayers),
    stale: Boolean(data.stale),
    eligibleFingerprint: data.eligibleFingerprint ?? null,
  };
}

export async function saveGameTeams(
  db: Firestore,
  teams: GameTeams
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.gameTeams, teams.gameId), teams);
}

export async function deleteGameTeams(
  db: Firestore,
  gameId: string
): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.gameTeams, gameId));
}

export function nextUpcomingGame(games: Game[], now = new Date()): Game | null {
  return nextUpcomingGameFromSchedule(games, now);
}

export { gameHasNotStarted, gameStartMs };
