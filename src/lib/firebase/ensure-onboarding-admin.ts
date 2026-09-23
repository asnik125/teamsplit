import { getAdminDb } from "./admin";
import type { Player, PlayerEvaluation, UserProfile } from "../types";
import {
  DUPLICATE_DISPLAY_NAME_MESSAGE,
  findDisplayNameConflict,
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

async function assertDisplayNameAvailable(input: {
  displayName: string;
  excludePlayerId?: string | null;
}): Promise<void> {
  const snap = await getAdminDb().collection("players").get();
  const players = snap.docs.map((d) => {
    const data = d.data() as Player;
    return { id: data.id || d.id, displayName: data.displayName };
  });
  const conflict = findDisplayNameConflict({
    displayName: input.displayName,
    players,
    excludePlayerId: input.excludePlayerId,
  });
  if (conflict) {
    throw Object.assign(new Error(DUPLICATE_DISPLAY_NAME_MESSAGE), {
      status: 409,
    });
  }
}

/**
 * Idempotent Admin-SDK onboarding for a registered Auth user.
 * - users/{uid} (role player)
 * - players (new or ensure linked + active)
 * - playerEvaluations/{playerId} with all skills = 5 if missing (never overwrite)
 * - rejects a display name already used by another player
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
    // Legacy profiles missing the field default to ON (explicit false stays opted out).
    if (profile.emailNotifications === undefined) {
      profile = {
        ...profile,
        emailNotifications: true,
        updatedAt: now,
      };
      await userRef.set(
        { emailNotifications: true, updatedAt: now },
        { merge: true }
      );
    }
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
      await assertDisplayNameAvailable({
        displayName: plan.player.displayName,
        excludePlayerId: plan.playerId,
      });
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
      await assertDisplayNameAvailable({
        displayName: plan.player.displayName,
        excludePlayerId: plan.playerId,
      });
      await playerRef.set(plan.player);
      createdPlayer = true;
    }

    await userRef.set(profile);
    createdUser = true;
  }

  const playerId = profile.playerId;
  if (!playerId) {
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
    await assertDisplayNameAvailable({
      displayName: plan.player.displayName,
      excludePlayerId: newId,
    });
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
    await assertDisplayNameAvailable({
      displayName: plan.player.displayName,
      excludePlayerId: linkedPlayerId,
    });
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
    await evalRef.set(buildDefaultEvaluation(linkedPlayerId, now, uid));
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
