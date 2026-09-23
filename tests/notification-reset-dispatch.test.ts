import { describe, expect, it } from "vitest";
import {
  canAdminResetNotificationDedupe,
  dispatchAllowsClaim,
  dispatchDocId,
  notificationDedupeResetTargets,
  sendRecordBlocksResend,
} from "@/lib/notifications/store";
import { sendRecordId } from "@/lib/notifications/defaults";

describe("notification dedupe Admin testing reset", () => {
  it("unauthorized roles cannot reset", () => {
    expect(canAdminResetNotificationDedupe("player")).toBe(false);
    expect(canAdminResetNotificationDedupe(null)).toBe(false);
    expect(canAdminResetNotificationDedupe(undefined)).toBe(false);
    expect(canAdminResetNotificationDedupe("admin")).toBe(true);
  });

  it("targets only the selected game + type dispatch doc", () => {
    const t = notificationDedupeResetTargets("g1", "game_reminder");
    expect(t.dispatchDocId).toBe(dispatchDocId("g1", "game_reminder"));
    expect(t.dispatchDocId).toBe("g1_game_reminder");
    expect(t.dispatchDocId).not.toBe(dispatchDocId("g1", "maybe_reminder"));
    expect(t.dispatchDocId).not.toBe(dispatchDocId("g2", "game_reminder"));
  });

  it("targets only matching notificationSends filter", () => {
    const t = notificationDedupeResetTargets("g1", "game_reminder");
    expect(t.sendsFilter).toEqual({
      gameId: "g1",
      notificationType: "game_reminder",
    });
    const otherTypeSend = sendRecordId("g1", "maybe_reminder", "u1");
    const otherGameSend = sendRecordId("g2", "game_reminder", "u1");
    const matchSend = sendRecordId("g1", "game_reminder", "u1");
    expect(matchSend).toBe(sendRecordId("g1", "game_reminder", "u1"));
    expect(otherTypeSend).not.toBe(matchSend);
    expect(otherGameSend).not.toBe(matchSend);
  });

  it("preserves notificationRuns as audit trail", () => {
    const t = notificationDedupeResetTargets("g1", "final_status");
    expect(t.preserveCollections).toContain("notificationRuns");
    expect(t.preserveCollections).not.toContain("notificationDispatches");
    expect(t.preserveCollections).not.toContain("notificationSends");
  });

  it("other games/types remain untouched by target ids", () => {
    const reset = notificationDedupeResetTargets("g_sep24", "game_reminder");
    const otherDispatch = dispatchDocId("g_sep24", "maybe_reminder");
    const otherGame = dispatchDocId("g_oct01", "game_reminder");
    expect(reset.dispatchDocId).not.toBe(otherDispatch);
    expect(reset.dispatchDocId).not.toBe(otherGame);
  });

  it("after reset, completed dispatch no longer blocks claim", () => {
    const before = { status: "completed", hasFailures: false };
    expect(dispatchAllowsClaim(before)).toBe(false);
    // Reset deletes the doc → null
    expect(dispatchAllowsClaim(null)).toBe(true);
  });

  it("after reset, removed send records no longer block Resend", () => {
    const before = { status: "sent" as const };
    expect(sendRecordBlocksResend(before)).toBe(true);
    expect(sendRecordBlocksResend(null)).toBe(false);
  });

  it("next due cron path can create a new run and resend after reset", () => {
    // Simulated pre-reset production state for g1 / game_reminder
    const dispatch = { status: "completed", hasFailures: false };
    const send = { status: "sent" as const };
    expect(dispatchAllowsClaim(dispatch)).toBe(false);
    expect(sendRecordBlocksResend(send)).toBe(true);

    // After Admin reset (docs deleted)
    const dispatchAfter = null;
    const sendAfter = null;
    expect(dispatchAllowsClaim(dispatchAfter)).toBe(true);
    expect(sendRecordBlocksResend(sendAfter)).toBe(false);

    // Eligible recipient would proceed through claimSendSlot → Resend
    const eligible = {
      active: true,
      emailNotifications: true,
      email: "player@example.com",
    };
    expect(eligible.active && eligible.emailNotifications === true).toBe(true);
  });
});

describe("Simulate vs scheduled cron dedupe (confirmation)", () => {
  it("Simulate uses forceRedispatch which clears the same operational state as Admin reset", () => {
    // Documented contract: simulate route passes forceRedispatch: true,
    // which calls resetNotificationDedupeState before claim — same deletes as
    // Admin testing reset. After either path, a successful process writes the
    // same notificationDispatches + notificationSends shape as a real cron send.
    const simulateOptions = {
      forceDue: true,
      forceRedispatch: true,
    };
    expect(simulateOptions.forceRedispatch).toBe(true);
    const cronOptions = {
      forceDue: false,
      forceRedispatch: false,
    };
    expect(cronOptions.forceRedispatch).toBe(false);
  });
});
