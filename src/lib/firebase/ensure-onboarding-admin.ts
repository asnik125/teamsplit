import { getAdminDb } from "./admin";
import type { Player, PlayerEvaluation, UserProfile } from "../types";
import {
  planSelfRegistration,
  playerIdForAuthUid,
} from "../auth/onboarding";
import {
  buildDefaultEvaluation,
  shouldCreateDefaultEvaluation,
} from "../auth/default-evaluation";

function nowIso() {
  return new Date().toISOString();
}

export interface EnsureOnboardingResult {
  profile: UserProfile;
  playerId: string;
  createdUser: boolean;
  createdPlayer: boolean;
  createdEvaluation: boolean;
  activatedPlayer: boolean;
}

/**
 * Idempotent Admin-SDK onboarding for a registered Auth user.
 * - users/{uid} (role player)
 * - players (new or ensure linked + active)
 * - playerEvaluations/{playerId} with all skills = 5 if missing (never overwrite)
 */
export async function ensureRegisteredPlayerOnboarding(input: {
  uid: string;
  email: string;
  displayName: string;
}): Promise<EnsureOnboardingResult> {
  const db = getAdminDb();
  const now = nowIso();
  const email = input.email.trim().toLowerCase();
  const uid = input.uid;

  let createdUser = false;
  let createdPlayer = false;
  let createdEvaluation = false;
  let activatedPlayer = false;

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  let profile: UserProfile;

  if (userSnap.exists) {
    profile = { ...(userSnap.data() as UserProfile), uid };
  } else {
    const plan = planSelfRegistration({
      uid,
      email,
      displayName: input.displayName,
      nowIso: now,
    });
    if (!plan.ok) {
      throw Object.assign(new Error(plan.error), { status: plan.status });
    }
    profile = plan.profile;

    const playerRef = db.collection("players").doc(plan.playerId);
    const playerSnap = await playerRef.get();
    if (playerSnap.exists) {
      const prev = playerSnap.data() as Player;
      if (prev.linkedUid && prev.linkedUid !== uid) {
        throw Object.assign(new Error("Player record conflict"), {
          status: 409,
        });
      }
      await playerRef.set(
        {
          ...prev,
          ...plan.player,
          createdAt: prev.createdAt || plan.player.createdAt,
          linkedUid: uid,
          active: true,
          updatedAt: now,
        },
        { merge: true }
      );
      if (!prev.active) activatedPlayer = true;
    } else {
      await playerRef.set(plan.player);
      createdPlayer = true;
    }

    await userRef.set(profile);
    createdUser = true;
  }

  const playerId = profile.playerId;
  if (!playerId) {
    // Legacy / broken profile — attach deterministic player
    const newId = playerIdForAuthUid(uid);
    const plan = planSelfRegistration({
      uid,
      email: profile.email || email,
      displayName: profile.displayName || input.displayName,
      nowIso: now,
    });
    if (!plan.ok) {
      throw Object.assign(new Error(plan.error), { status: plan.status });
    }
    await db.collection("players").doc(newId).set(
      { ...plan.player, id: newId },
      { merge: true }
    );
    createdPlayer = true;
    profile = { ...profile, playerId: newId, updatedAt: now };
    await userRef.set(profile, { merge: true });
  }

  const linkedPlayerId = profile.playerId!;
  const playerRef = db.collection("players").doc(linkedPlayerId);
  const playerSnap = await playerRef.get();
  if (playerSnap.exists) {
    const prev = playerSnap.data() as Player;
    const patch: Partial<Player> = { updatedAt: now };
    if (prev.linkedUid !== uid) patch.linkedUid = uid;
    if (!prev.active) {
      patch.active = true;
      activatedPlayer = true;
    }
    if (Object.keys(patch).length > 1) {
      await playerRef.update(patch);
    }
  } else {
    const plan = planSelfRegistration({
      uid,
      email: profile.email || email,
      displayName: profile.displayName || input.displayName,
      nowIso: now,
    });
    if (!plan.ok) {
      throw Object.assign(new Error(plan.error), { status: plan.status });
    }
    await playerRef.set({
      ...plan.player,
      id: linkedPlayerId,
    });
    createdPlayer = true;
  }

  const evalRef = db.collection("playerEvaluations").doc(linkedPlayerId);
  const evalSnap = await evalRef.get();
  const existingEval = evalSnap.exists
    ? (evalSnap.data() as PlayerEvaluation)
    : null;
  if (shouldCreateDefaultEvaluation(existingEval)) {
    await evalRef.set(
      buildDefaultEvaluation(linkedPlayerId, now, uid)
    );
    createdEvaluation = true;
  }

  return {
    profile: { ...profile, playerId: linkedPlayerId },
    playerId: linkedPlayerId,
    createdUser,
    createdPlayer,
    createdEvaluation,
    activatedPlayer,
  };
}
