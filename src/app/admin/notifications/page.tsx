"use client";

import { useCallback, useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppNav } from "@/components/AppNav";
import { PageHeading } from "@/components/PageHeading";
import { ViewportGate } from "@/components/viewport/ViewportGate";
import { MobilePlayerApp } from "@/components/mobile/MobilePlayerApp";
import { MobileAdminApp } from "@/components/mobile/MobileAdminApp";
import { useAuth } from "@/lib/firebase/auth-context";
import { getClientDb } from "@/lib/firebase/client";
import { listGames } from "@/lib/firebase/data";
import {
  fetchNotificationAdmin,
  saveNotificationAdmin,
  sendTestNotificationEmail,
  simulateNotification,
  resetNotificationDispatch,
} from "@/lib/notifications/client-api";
import {
  defaultNotificationSettings,
  notificationTypeLabel,
} from "@/lib/notifications/defaults";
import { formatRunSummary } from "@/lib/notifications/format";
import {
  normalizeTimeLocalHHmm,
  notificationTimeSelectOptions,
} from "@/lib/notifications/timezone";
import { formatShortDate } from "@/lib/schedule";
import { formatUnknownError } from "@/lib/errors";
import type {
  Game,
  NotificationRuleSettings,
  NotificationRunLog,
  NotificationSettings,
  NotificationType,
} from "@/lib/types";

function RuleEditor({
  title,
  description,
  value,
  onChange,
  scheduleEditable = true,
}: {
  title: string;
  description: string;
  value: NotificationRuleSettings;
  onChange: (next: NotificationRuleSettings) => void;
  /** When false, only the enabled toggle is shown (fixed automatic timing). */
  scheduleEditable?: boolean;
}) {
  const timeValue = normalizeTimeLocalHHmm(value.timeLocal) ?? value.timeLocal;
  const timeOptions = notificationTimeSelectOptions(timeValue);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-100">{title}</h3>
          <p className="text-xs text-slate-400">{description}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) =>
              onChange({ ...value, enabled: e.target.checked })
            }
          />
          Enabled
        </label>
      </div>
      {scheduleEditable && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Days before game</label>
            <select
              className="input"
              value={value.daysBefore}
              onChange={(e) =>
                onChange({
                  ...value,
                  daysBefore: Number(e.target.value),
                })
              }
            >
              <option value={0}>Game day (0)</option>
              <option value={1}>1 day before</option>
              <option value={2}>2 days before</option>
              <option value={3}>3 days before</option>
            </select>
          </div>
          <div>
            <label className="label">Time (America/Vancouver)</label>
            <select
              className="input"
              value={timeValue}
              onChange={(e) =>
                onChange({
                  ...value,
                  timeLocal:
                    normalizeTimeLocalHHmm(e.target.value) ?? e.target.value,
                })
              }
              aria-label={`Time for ${title}`}
            >
              {timeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
function NotificationsContent() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings>(
    defaultNotificationSettings()
  );
  const [history, setHistory] = useState<NotificationRunLog[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [simGameId, setSimGameId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const simulateEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_ALLOW_NOTIFICATION_SIMULATE === "true";

  const reload = useCallback(async () => {
    if (!user) return;
    const [admin, scheduled] = await Promise.all([
      fetchNotificationAdmin(user),
      listGames(getClientDb()),
    ]);
    setSettings(admin.settings);
    setHistory(admin.history);
    const upcoming = scheduled
      .filter((g) => g.status === "scheduled")
      .sort((a, b) => a.date.localeCompare(b.date));
    setGames(upcoming);
    if (!simGameId && upcoming[0]) setSimGameId(upcoming[0].id);
  }, [user, simGameId]);

  useEffect(() => {
    reload()
      .catch((e) => setError(formatUnknownError(e)))
      .finally(() => setLoading(false));
  }, [reload]);

  async function onSave() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveNotificationAdmin(user, {
        ...settings,
        timezone: "America/Vancouver",
        updatedAt: new Date().toISOString(),
        updatedBy: user.uid,
      });
      setSettings(saved);
      setMessage("Notification settings saved.");
    } catch (e) {
      setError(formatUnknownError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await sendTestNotificationEmail(user);
      setMessage(`${res.message} → ${res.to}`);
    } catch (e) {
      setError(formatUnknownError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSimulate(type: NotificationType) {
    if (!user || !simGameId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = (await simulateNotification(user, simGameId, type)) as {
        runs?: Array<{ subject: string; successCount: number; result: string }>;
      };
      const summary =
        res.runs?.map((r) => `${r.subject}: ${r.result} (${r.successCount})`).join("; ") ||
        "No due slots / nothing sent";
      setMessage(`Simulate ${notificationTypeLabel(type)}: ${summary}`);
      await reload();
    } catch (e) {
      setError(formatUnknownError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onResetDispatch(type: NotificationType) {
    if (!user || !simGameId) return;
    const label = notificationTypeLabel(type);
    const g = games.find((x) => x.id === simGameId);
    const gameLabel = g
      ? `${formatShortDate(g.date)} · ${g.location}`
      : simGameId;
    const ok = window.confirm(
      `TESTING RESET — clear operational dedupe for:\n\n` +
        `Game: ${gameLabel}\n` +
        `Type: ${label}\n\n` +
        `This deletes notificationDispatches + matching notificationSends for this game/type only.\n` +
        `notificationRuns (history) are kept.\n\n` +
        `The next due cron may send this email again via Resend.\n\n` +
        `Continue?`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await resetNotificationDispatch(user, simGameId, type);
      setMessage(
        `Testing reset (${label}): dispatch ${res.deletedDispatch ? "cleared" : "was absent"}, ` +
          `${res.deletedSendCount} send lock(s) removed. History preserved.`
      );
      await reload();
    } catch (e) {
      setError(formatUnknownError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto pb-8">
      <div>
        <PageHeading>Notifications</PageHeading>
        <p className="page-heading-sub">
          Timezone: America/Vancouver (PST/PDT). “Days before” is a calendar
          day (not 24 hours before kickoff). Scheduled sends need an external
          cron hitting{" "}
          <code className="text-slate-300">/api/cron/notifications</code> every
          few minutes — Vercel Hobby cannot run that schedule. Test Email and
          Simulate do not use cron.
        </p>
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="font-semibold">Scheduled email setup</p>
          <p className="mt-1 text-amber-50/90">
            Create a free job at{" "}
            <a
              className="underline"
              href="https://cron-job.org"
              target="_blank"
              rel="noreferrer"
            >
              cron-job.org
            </a>{" "}
            (or similar):{" "}
            <strong>every 5 minutes</strong>, URL{" "}
            <code className="text-amber-50">
              https://YOUR_DOMAIN/api/cron/notifications
            </code>
            , header{" "}
            <code className="text-amber-50">
              Authorization: Bearer CRON_SECRET
            </code>{" "}
            (same value as in Vercel env). Without this, rules above never send
            automatically.
          </p>
        </div>
      </div>

      {message && <p className="text-sm text-green-400">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <RuleEditor
        title="Game reminder"
        description="Default: 1 day before at 7:00 PM — everyone with email notifications on."
        value={settings.gameReminder}
        onChange={(gameReminder) => setSettings({ ...settings, gameReminder })}
      />
      <RuleEditor
        title="Maybe reminder"
        description="Default: game day at 4:00 PM — only players marked Maybe."
        value={settings.maybeReminder}
        onChange={(maybeReminder) => setSettings({ ...settings, maybeReminder })}
      />
      <RuleEditor
        title="Game OFF (2h before kickoff)"
        description="Automatic: exactly 2 hours before kickoff (America/Vancouver). If Playing &lt; minPlayingForTeams, emails Game is OFF once. Maybe and no response do not count. Separate from Game / Maybe reminders. No ON email."
        value={settings.finalStatus}
        onChange={(finalStatus) => setSettings({ ...settings, finalStatus })}
        scheduleEditable={false}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => onSave()}
        >
          Save settings
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => onTest()}
        >
          Send Test Email
        </button>
      </div>

      <div className="card space-y-3 border border-amber-500/30 p-4">
        <h3 className="font-semibold text-amber-100">
          Testing reset — clear dispatch locks
        </h3>
        <p className="text-xs text-slate-400">
          Admin testing only. Removes operational dedupe (
          <code className="text-slate-300">notificationDispatches</code> +{" "}
          <code className="text-slate-300">notificationSends</code>) for one
          game and one reminder type so the{" "}
          <strong className="font-semibold text-slate-300">
            normal scheduled cron
          </strong>{" "}
          can claim and Resend again. Does not delete{" "}
          <code className="text-slate-300">notificationRuns</code> history.
          Production claim logic is unchanged.
        </p>
        <div>
          <label className="label">Game</label>
          <select
            className="input"
            value={simGameId}
            onChange={(e) => setSimGameId(e.target.value)}
          >
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {formatShortDate(g.date)} · {g.location}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              "game_reminder",
              "maybe_reminder",
              "final_status",
            ] as NotificationType[]
          ).map((t) => (
            <button
              key={`reset-${t}`}
              type="button"
              className="btn btn-secondary"
              disabled={busy || !simGameId}
              onClick={() => onResetDispatch(t)}
            >
              Reset {notificationTypeLabel(t)} locks
            </button>
          ))}
        </div>
      </div>

      {simulateEnabled && (
        <div className="card space-y-3 p-4">
          <h3 className="font-semibold">Local simulate (dev)</h3>
          <p className="text-xs text-slate-400">
            Forces evaluation now without waiting for the schedule. Disabled in
            production unless ALLOW_NOTIFICATION_SIMULATE is set on the server.
          </p>
          <div>
            <label className="label">Game</label>
            <select
              className="input"
              value={simGameId}
              onChange={(e) => setSimGameId(e.target.value)}
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {formatShortDate(g.date)} · {g.location}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                "game_reminder",
                "maybe_reminder",
                "final_status",
              ] as NotificationType[]
            ).map((t) => (
              <button
                key={t}
                type="button"
                className="btn btn-secondary"
                disabled={busy || !simGameId}
                onClick={() => onSimulate(t)}
              >
                Simulate {notificationTypeLabel(t)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 font-semibold">Recent history</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No notification runs yet.</p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-300">
            {history.map((h) => (
              <li key={h.id} className="border-b border-slate-800 py-2">
                {new Date(h.at).toLocaleString()} —{" "}
                {formatRunSummary({
                  gameDate: formatShortDate(h.gameDate),
                  type: h.notificationType,
                  successCount: h.successCount,
                  recipientCount: h.recipientCount,
                  detail: h.detail,
                })}
                {h.failureCount > 0 ? ` · ${h.failureCount} failed` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AdminNotificationsPage() {
  return (
    <RequireAuth adminOnly>
      <ViewportGate
        desktop={
          <div className="app-shell">
            <AppNav />
            <main className="app-main">
              <NotificationsContent />
            </main>
          </div>
        }
        mobilePlayer={<MobilePlayerApp />}
        mobileAdmin={
          <MobileAdminApp
            initialTab="notifications"
            notificationsContent={<NotificationsContent />}
          />
        }
      />
    </RequireAuth>
  );
}
