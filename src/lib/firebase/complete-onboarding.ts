import { doc, getDoc, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { getClientDb } from "./client";
import { COLLECTIONS } from "./data";
import type { Player, UserProfile } from "../types";
import {
  DUPLICATE_DISPLAY_NAME_MESSAGE,
  ONBOARDING_USER_MESSAGE,
  planSelfRegistration,
  playerIdForAuthUid,
} from "../auth/onboarding";

function nowIso() {
  return new Date().toISOString();
}

function isDuplicateNameError(message: string): boolean {
  return (
    message === DUPLICATE_DISPLAY_NAME_MESSAGE || /already taken/i.test(message)
  );
}

/**
 * Client fallback: users + player only.
 * Evaluations stay Admin-SDK-only — created via /api/auth/provision.
 */
export async function completeOnboardingClient(
  user: User,
  displayName?: string | null
): Promise<UserProfile> {
  const db = getClientDb();
  const uid = user.uid;
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) {
    throw new Error("Your account needs an email address to use TeamSplit.");
  }

  const userRef = doc(db, COLLECTIONS.users, uid);
  const existing = await getDoc(userRef);
  if (existing.exists()) {
    return existing.data() as UserProfile;
  }

  const plan = planSelfRegistration({
    uid,
    email,
    displayName:
      displayName?.trim() ||
      user.displayName?.trim() ||
      email.split("@")[0] ||
      "Player",
    nowIso: nowIso(),
  });
  if (!plan.ok) {
    throw new Error(plan.error);
  }

  const playerRef = doc(db, COLLECTIONS.players, plan.playerId);
  const playerSnap = await getDoc(playerRef);
  if (playerSnap.exists()) {
    const prev = playerSnap.data() as Player;
    if (prev.linkedUid && prev.linkedUid !== uid) {
      throw new Error(ONBOARDING_USER_MESSAGE);
    }
    await setDoc(
      playerRef,
      {
        ...prev,
        ...plan.player,
        createdAt: prev.createdAt || plan.player.createdAt,
        linkedUid: uid,
        active: true,
        updatedAt: nowIso(),
      },
      { merge: true }
    );
  } else {
    await setDoc(playerRef, plan.player);
  }

  await setDoc(userRef, plan.profile);
  const written = await getDoc(userRef);
  if (!written.exists()) {
    throw new Error(ONBOARDING_USER_MESSAGE);
  }
  return written.data() as UserProfile;
}

/**
 * Always hits provision API (creates/backfills evaluation via Admin SDK).
 * Duplicate display name (409) is never bypassed by the client fallback.
 */
export async function provisionTeamSplitAccount(
  user: User,
  displayName?: string | null
): Promise<UserProfile> {
  const name =
    displayName?.trim() || user.displayName?.trim() || undefined;

  async function callProvision(): Promise<UserProfile> {
    const token = await user.getIdToken();
    const res = await fetch("/api/auth/provision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ displayName: name }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      const err = new Error(
        data.error || `Provisioning failed (${res.status})`
      );
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    const snap = await getDoc(doc(getClientDb(), COLLECTIONS.users, user.uid));
    if (!snap.exists()) {
      throw new Error(ONBOARDING_USER_MESSAGE);
    }
    return snap.data() as UserProfile;
  }

  try {
    return await callProvision();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: unknown }).status)
        : 0;
    if (status === 409 || isDuplicateNameError(msg)) {
      throw new Error(DUPLICATE_DISPLAY_NAME_MESSAGE);
    }
    // Network / 5xx — try client user+player, then retry provision for eval
  }

  await completeOnboardingClient(user, name);
  try {
    return await callProvision();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: unknown }).status)
        : 0;
    if (status === 409 || isDuplicateNameError(msg)) {
      throw new Error(DUPLICATE_DISPLAY_NAME_MESSAGE);
    }
  }

  const snap = await getDoc(doc(getClientDb(), COLLECTIONS.users, user.uid));
  if (snap.exists()) return snap.data() as UserProfile;
  throw new Error(ONBOARDING_USER_MESSAGE);
}

export { playerIdForAuthUid };
