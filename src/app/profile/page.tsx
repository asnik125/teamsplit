"use client";

import { FormEvent, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { PageHeading } from "@/components/PageHeading";
import { ViewportGate } from "@/components/viewport/ViewportGate";
import { MobilePlayerApp } from "@/components/mobile/MobilePlayerApp";
import { MobileAdminApp } from "@/components/mobile/MobileAdminApp";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import { COLLECTIONS, listPlayers } from "@/lib/firebase/data";
import {
  DUPLICATE_DISPLAY_NAME_MESSAGE,
  findDisplayNameConflict,
} from "@/lib/auth/onboarding";
import { formatUnknownError } from "@/lib/errors";
import { roleLabel } from "@/lib/roles";

function ProfileForm() {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [emailNotifications, setEmailNotifications] = useState(
    profile?.emailNotifications !== false
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    setMessage(null);
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError("Display name is required.");
      return;
    }
    try {
      const db = getClientDb();
      const players = await listPlayers(db);
      const conflict = findDisplayNameConflict({
        displayName: trimmed,
        players,
        excludePlayerId: profile.playerId,
      });
      if (conflict) {
        setError(DUPLICATE_DISPLAY_NAME_MESSAGE);
        return;
      }
      const now = new Date().toISOString();
      await updateDoc(doc(db, COLLECTIONS.users, profile.uid), {
        displayName: trimmed,
        emailNotifications,
        updatedAt: now,
      });
      if (profile.playerId) {
        await updateDoc(doc(db, COLLECTIONS.players, profile.playerId), {
          displayName: trimmed,
          updatedAt: now,
        });
      }
      await refreshProfile();
      setMessage("Profile updated.");
    } catch (err) {
      setError(formatUnknownError(err));
    }
  }

  if (!profile) return null;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <PageHeading>Profile</PageHeading>
      <form onSubmit={onSubmit} className="card max-w-md space-y-4">
        <div>
          <label className="label">Display name</label>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={profile.email} disabled />
          <p className="mt-1 text-xs text-slate-500">
            Email change, phone, and avatar coming later.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailNotifications}
            onChange={(e) => setEmailNotifications(e.target.checked)}
          />
          Email notifications
        </label>
        <p className="text-xs text-slate-500">
          When enabled, you receive game reminders and status emails. New
          accounts default to ON; turn off anytime.
        </p>
        <p className="text-xs text-slate-500">
          Role: {roleLabel(profile.role)}. Evaluation data is never shown here.
        </p>
        {message && <p className="text-sm text-green-400">{message}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </form>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ViewportGate
        desktop={
          <div className="player-shell">
            <AppNav />
            <ProfileForm />
          </div>
        }
        mobilePlayer={<MobilePlayerApp initialFrame="profile" />}
        mobileAdmin={<MobileAdminApp initialTab="settings" />}
      />
    </RequireAuth>
  );
}
