import { doc, getDoc, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { getClientDb } from "./client";
import { COLLECTIONS } from "./data";
import type { Player, UserProfile } from "../types";
import {
  ONBOARDING_USER_MESSAGE,
  planSelfRegistration,
  playerIdForAuthUid,
} from "../auth/onboarding";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Client fallback: users + player only.
 * Evaluations stay Admin-SDK-only (isolation) — created via /api/auth/provision.
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
 * Falls back to client user+player writes if API is unreachable, then retries API once.
 */
export async function provisionTeamSplitAccount(
  user: User,
  displayName?: string | null
): Promise<UserProfile> {
  const name =
    displayName?.trim() || user.displayName?.trim() || undefined;

  async function callProvision(): Promise<UserProfile | null> {
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
    if (!res.ok || !data.ok) return null;
    const snap = await getDoc(doc(getClientDb(), COLLECTIONS.users, user.uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  }

  try {
    const fromApi = await callProvision();
    if (fromApi) return fromApi;
  } catch {
    /* fall through */
  }

  // Ensure user+player exist, then retry API for evaluation backfill
  await completeOnboardingClient(user, name);
  try {
    const retry = await callProvision();
    if (retry) return retry;
  } catch {
    /* ignore */
  }

  const snap = await getDoc(doc(getClientDb(), COLLECTIONS.users, user.uid));
  if (snap.exists()) return snap.data() as UserProfile;
  throw new Error(ONBOARDING_USER_MESSAGE);
}

export { playerIdForAuthUid };
