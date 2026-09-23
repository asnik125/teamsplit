import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  formatTimeLocal12,
  normalizeTimeLocalHHmm,
  notificationTimeSelectOptions,
  vancouverLocalToUtc,
  zonedCalendarDate,
} from "@/lib/notifications/timezone";
import {
  buildDueSlots,
  computeGameOffThresholdDueAt,
  computeNotificationDueAt,
  dueAtForNotificationType,
  isNotificationDue,
  shouldSendGameOffThreshold,
} from "@/lib/notifications/schedule";
import { defaultNotificationSettings, sendRecordId } from "@/lib/notifications/defaults";
import {
  countPlaying,
  resolveRecipients,
} from "@/lib/notifications/recipients";
import { buildFinalStatusEmail } from "@/lib/notifications/templates";
import {
  dispatchAllowsClaim,
  dispatchDocId,
  sendRecordBlocksResend,
} from "@/lib/notifications/store";
import type {
  AttendanceRecord,
  Game,
  NotificationSettings,
  Player,
  UserProfile,
} from "@/lib/types";

function game(partial: Partial<Game> & Pick<Game, "id" | "date" | "startTime">): Game {
  return {
    endTime: null,
    location: "Gym",
    status: "scheduled",
    noGame: false,
    seasonId: "2026-2027",
    createdBy: "t",
    createdAt: "",
    updatedAt: "",
    teamsMayBeStale: false,
    teamsStatusMessage: null,
    lastAttendanceChange: null,
    ...partial,
  };
}

function user(
  uid: string,
  opts: Partial<UserProfile> & { email?: string } = {}
): UserProfile {
  return {
    uid,
    playerId: opts.playerId ?? uid,
    displayName: opts.displayName ?? uid,
    email: opts.email ?? `${uid}@example.com`,
    role: "player",
    emailNotifications: opts.emailNotifications ?? true,
    active: opts.active ?? true,
    createdAt: "",
    updatedAt: "",
  };
}

describe("Vancouver timezone scheduling", () => {
  it("maps Vancouver winter local time to the correct UTC offset (PST)", () => {
    // 2026-01-15 19:00 America/Vancouver = UTC 03:00 next day (UTC-8)
    const d = vancouverLocalToUtc("2026-01-15", "19:00");
    expect(d.toISOString()).toBe("2026-01-16T03:00:00.000Z");
  });

  it("maps Vancouver summer local time to PDT (UTC-7)", () => {
    // 2026-07-15 19:00 America/Vancouver = UTC 02:00 next day
    const d = vancouverLocalToUtc("2026-07-15", "19:00");
    expect(d.toISOString()).toBe("2026-07-16T02:00:00.000Z");
  });

  it("day-before calculation uses calendar day before game.date", () => {
    const g = game({ id: "g1", date: "2026-09-24", startTime: "19:30" });
    const settings = defaultNotificationSettings();
    const due = computeNotificationDueAt(g, settings.gameReminder);
    // 1 day before Sep 24 = Sep 23 19:00 Vancouver = Sep 24 02:00 UTC (PDT)
    expect(zonedCalendarDate(due)).toBe("2026-09-23");
    expect(due.toISOString()).toBe("2026-09-24T02:00:00.000Z");
  });

  it("game-day Maybe uses game.date; Game OFF uses start − 2h", () => {
    const g = game({ id: "g1", date: "2026-09-24", startTime: "19:30" });
    const settings = defaultNotificationSettings();
    const maybeDue = computeNotificationDueAt(g, settings.maybeReminder);
    expect(zonedCalendarDate(maybeDue)).toBe("2026-09-24");
    expect(maybeDue.toISOString()).toBe("2026-09-24T23:00:00.000Z"); // 16:00 PDT

    const offDue = dueAtForNotificationType(
      g,
      "final_status",
      settings.finalStatus
    );
    // Sep 24 19:30 PDT − 2h = Sep 24 17:30 PDT = Sep 25 00:30 UTC
    expect(offDue.toISOString()).toBe("2026-09-25T00:30:00.000Z");
  });

  it("respects custom Admin time", () => {
    const g = game({ id: "g1", date: "2026-09-24", startTime: "19:30" });
    const due = computeNotificationDueAt(g, {
      enabled: true,
      daysBefore: 1,
      timeLocal: "20:00",
    });
    expect(due.toISOString()).toBe("2026-09-24T03:00:00.000Z"); // Sep 23 20:00 PDT
  });

  it("addCalendarDays handles month boundaries", () => {
    expect(addCalendarDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("isNotificationDue rejects past games and future slots", () => {
    const g = game({ id: "g1", date: "2026-09-24", startTime: "19:30" });
    const dueAt = vancouverLocalToUtc("2026-09-23", "19:00");
    expect(
      isNotificationDue({
        dueAt,
        now: vancouverLocalToUtc("2026-09-23", "18:59"),
        game: g,
      })
    ).toBe(false);
    expect(
      isNotificationDue({
        dueAt,
        now: vancouverLocalToUtc("2026-09-23", "19:05"),
        game: g,
      })
    ).toBe(true);
    expect(
      isNotificationDue({
        dueAt,
        now: vancouverLocalToUtc("2026-09-24", "20:00"),
        game: g,
      })
    ).toBe(false); // after game start
  });

  it("cancelled games never due", () => {
    const g = game({
      id: "g1",
      date: "2026-09-24",
      startTime: "19:30",
      status: "cancelled",
    });
    const dueAt = vancouverLocalToUtc("2026-09-23", "19:00");
    expect(
      isNotificationDue({
        dueAt,
        now: vancouverLocalToUtc("2026-09-23", "19:05"),
        game: g,
      })
    ).toBe(false);
  });
});

describe("recipients", () => {
  const players: Player[] = [
    {
      id: "p1",
      displayName: "A",
      email: null,
      active: true,
      linkedUid: "u1",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "p2",
      displayName: "B",
      email: null,
      active: true,
      linkedUid: "u2",
      createdAt: "",
      updatedAt: "",
    },
  ];

  it("Everyone includes only active + emailNotifications true + valid email", () => {
    const users = [
      user("u1", { playerId: "p1", emailNotifications: true }),
      user("u2", { playerId: "p2", emailNotifications: false }),
      user("u3", { playerId: "p3", active: false }),
      user("u4", { playerId: "p4", email: "bad" }),
    ];
    const { recipients, skipped } = resolveRecipients({
      type: "game_reminder",
      users,
      players,
      attendance: [],
    });
    expect(recipients.map((r) => r.userId)).toEqual(["u1"]);
    expect(skipped.some((s) => s.reason === "emailNotifications_off")).toBe(
      true
    );
    expect(skipped.some((s) => s.reason === "inactive")).toBe(true);
    expect(skipped.some((s) => s.reason === "missing_email")).toBe(true);
  });

  it("Admin role does not exclude; unset emailNotifications defaults ON", () => {
    const adminOn = user("admin1", {
      playerId: "p1",
      role: "admin",
      emailNotifications: true,
    });
    const adminLegacy = user("admin2", {
      playerId: "p_admin2",
      role: "admin",
    });
    delete (adminLegacy as { emailNotifications?: boolean }).emailNotifications;
    const adminOptOut = user("admin_out", {
      playerId: "p_out",
      role: "admin",
      emailNotifications: false,
    });

    const { recipients, skipped } = resolveRecipients({
      type: "game_reminder",
      users: [adminOn, adminLegacy, adminOptOut],
      players,
      attendance: [],
    });
    expect(recipients.map((r) => r.userId).sort()).toEqual([
      "admin1",
      "admin2",
    ]);
    expect(skipped.find((s) => s.userId === "admin_out")?.reason).toBe(
      "emailNotifications_off"
    );
  });

  it("Maybe only includes Maybe attendance", () => {
    const users = [
      user("u1", { playerId: "p1" }),
      user("u2", { playerId: "p2" }),
    ];
    const attendance: AttendanceRecord[] = [
      {
        gameId: "g",
        playerId: "p1",
        status: "maybe",
        updatedAt: "",
        updatedBy: null,
      },
      {
        gameId: "g",
        playerId: "p2",
        status: "playing",
        updatedAt: "",
        updatedBy: null,
      },
    ];
    const { recipients } = resolveRecipients({
      type: "maybe_reminder",
      users,
      players,
      attendance,
    });
    expect(recipients.map((r) => r.userId)).toEqual(["u1"]);
  });
});

describe("automatic Game OFF (final_status)", () => {
  function mkAttendance(
    nPlaying: number,
    nMaybe = 0,
    nNoResponse = 0
  ): AttendanceRecord[] {
    const rows: AttendanceRecord[] = [];
    for (let i = 0; i < nPlaying; i++) {
      rows.push({
        gameId: "g",
        playerId: `p${i}`,
        status: "playing",
        updatedAt: "",
        updatedBy: null,
      });
    }
    for (let i = 0; i < nMaybe; i++) {
      rows.push({
        gameId: "g",
        playerId: `m${i}`,
        status: "maybe",
        updatedAt: "",
        updatedBy: null,
      });
    }
    for (let i = 0; i < nNoResponse; i++) {
      rows.push({
        gameId: "g",
        playerId: `n${i}`,
        status: "no_response",
        updatedAt: "",
        updatedBy: null,
      });
    }
    return rows;
  }

  it("dueAt is exactly game start − 2 hours in America/Vancouver (PDT)", () => {
    const g = game({ id: "g1", date: "2026-09-24", startTime: "19:30" });
    const due = computeGameOffThresholdDueAt(g);
    // Kickoff 19:30 PDT = 02:30 UTC next day; check 17:30 PDT = 00:30 UTC
    expect(due.toISOString()).toBe("2026-09-25T00:30:00.000Z");
    expect(
      dueAtForNotificationType(
        g,
        "final_status",
        defaultNotificationSettings().finalStatus
      ).toISOString()
    ).toBe(due.toISOString());
  });

  it("dueAt respects PST (winter) DST offset", () => {
    const g = game({ id: "g1", date: "2026-01-15", startTime: "19:30" });
    const due = computeGameOffThresholdDueAt(g);
    // Kickoff 19:30 PST = 03:30 UTC next day; check 17:30 PST = 01:30 UTC
    expect(due.toISOString()).toBe("2026-01-16T01:30:00.000Z");
  });

  it("5 Playing → OFF should send; 6 Playing → no OFF", () => {
    expect(
      shouldSendGameOffThreshold({ playingCount: 5, minPlaying: 6 })
    ).toBe(true);
    expect(
      shouldSendGameOffThreshold({ playingCount: 6, minPlaying: 6 })
    ).toBe(false);
    expect(
      shouldSendGameOffThreshold({ playingCount: 7, minPlaying: 6 })
    ).toBe(false);
  });

  it("Maybe and no_response do not count toward minimum", () => {
    expect(countPlaying(mkAttendance(5, 10, 10))).toBe(5);
    expect(
      shouldSendGameOffThreshold({
        playingCount: countPlaying(mkAttendance(5, 10, 10)),
        minPlaying: 6,
      })
    ).toBe(true);
    expect(
      shouldSendGameOffThreshold({
        playingCount: countPlaying(mkAttendance(6, 0, 0)),
        minPlaying: 6,
      })
    ).toBe(false);
  });

  it("OFF email subject and body include date, count, minimum, and reason", () => {
    const g = game({ id: "g", date: "2026-09-24", startTime: "19:30" });
    const email = buildFinalStatusEmail({
      game: g,
      playingCount: 5,
      minPlaying: 6,
      appUrl: "http://localhost:3000",
    });
    expect(email.subject).toBe("TeamSplit — Game is OFF");
    expect(email.text).toContain("Game is OFF — not enough confirmed players.");
    expect(email.text).toContain("5 confirmed Playing (minimum required: 6)");
    expect(email.text).toMatch(/Sep|September|2026-09-24|09\/24/i);
    expect(email.text).toMatch(/7:30|19:30/i);
  });

  it("Admin+Player is included when email notifications opted in", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "Admin Player",
        email: null,
        active: true,
        linkedUid: "admin1",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const users = [
      user("admin1", {
        playerId: "p1",
        role: "admin",
        emailNotifications: true,
        email: "admin@example.com",
      }),
    ];
    const { recipients } = resolveRecipients({
      type: "final_status",
      users,
      players,
      attendance: [],
    });
    expect(recipients.map((r) => r.userId)).toEqual(["admin1"]);
  });

  it("explicit email opt-out is respected for Game OFF", () => {
    const players: Player[] = [
      {
        id: "p1",
        displayName: "A",
        email: null,
        active: true,
        linkedUid: "u1",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const users = [
      user("u1", {
        playerId: "p1",
        emailNotifications: false,
        email: "a@example.com",
      }),
    ];
    const { recipients, skipped } = resolveRecipients({
      type: "final_status",
      users,
      players,
      attendance: [],
    });
    expect(recipients).toHaveLength(0);
    expect(skipped.some((s) => s.reason === "emailNotifications_off")).toBe(
      true
    );
  });

  it("No Game dates do not trigger Game OFF slot", () => {
    const settings = defaultNotificationSettings();
    const games = [
      game({
        id: "g1",
        date: "2026-09-24",
        startTime: "19:30",
        noGame: true,
      }),
    ];
    const now = vancouverLocalToUtc("2026-09-24", "17:35");
    const slots = buildDueSlots({
      games,
      settings,
      now,
      onlyType: "final_status",
    });
    expect(slots).toHaveLength(0);
    expect(
      isNotificationDue({
        dueAt: computeGameOffThresholdDueAt(games[0]),
        now,
        game: games[0],
      })
    ).toBe(false);
  });

  it("buildDueSlots includes final_status at start − 2h, not at old 18:00 clock", () => {
    const settings = {
      ...defaultNotificationSettings(),
      gameReminder: { enabled: false, daysBefore: 1, timeLocal: "19:00" },
      maybeReminder: { enabled: false, daysBefore: 0, timeLocal: "16:00" },
    };
    const g = game({ id: "g1", date: "2026-09-24", startTime: "19:30" });
    // At 17:35 Vancouver — past 17:30 check, before kickoff
    const atCheck = buildDueSlots({
      games: [g],
      settings,
      now: vancouverLocalToUtc("2026-09-24", "17:35"),
      onlyType: "final_status",
    });
    expect(atCheck).toHaveLength(1);
    expect(atCheck[0].dueAt.toISOString()).toBe("2026-09-25T00:30:00.000Z");

    // At old final 18:00 local — still due (within lookback until start)
    const atOldFinal = buildDueSlots({
      games: [g],
      settings,
      now: vancouverLocalToUtc("2026-09-24", "18:00"),
      onlyType: "final_status",
    });
    expect(atOldFinal).toHaveLength(1);

    // Before check window
    const tooEarly = buildDueSlots({
      games: [g],
      settings,
      now: vancouverLocalToUtc("2026-09-24", "17:00"),
      onlyType: "final_status",
    });
    expect(tooEarly).toHaveLength(0);
  });

  it("duplicate cron calls do not resend (same final_status dedupe keys)", () => {
    const dispatchId = dispatchDocId("g1", "final_status");
    expect(dispatchId).toBe("g1_final_status");
    expect(dispatchAllowsClaim({ status: "completed", hasFailures: false })).toBe(
      false
    );
    expect(dispatchAllowsClaim(null)).toBe(true);

    const sendId = sendRecordId("g1", "final_status", "u1");
    expect(sendId).toBe("g1_final_status_u1");
    expect(sendRecordBlocksResend({ status: "sent" })).toBe(true);
    expect(sendRecordBlocksResend(null)).toBe(false);
  });
});

describe("final status Playing count", () => {
  it("Maybe does not count; 5 OFF, 6/7 would be ON template only", () => {
    const mk = (nPlaying: number, nMaybe = 2): AttendanceRecord[] => {
      const rows: AttendanceRecord[] = [];
      for (let i = 0; i < nPlaying; i++) {
        rows.push({
          gameId: "g",
          playerId: `p${i}`,
          status: "playing",
          updatedAt: "",
          updatedBy: null,
        });
      }
      for (let i = 0; i < nMaybe; i++) {
        rows.push({
          gameId: "g",
          playerId: `m${i}`,
          status: "maybe",
          updatedAt: "",
          updatedBy: null,
        });
      }
      return rows;
    };
    expect(countPlaying(mk(5))).toBe(5);
    expect(countPlaying(mk(6))).toBe(6);
    expect(countPlaying(mk(7))).toBe(7);

    const g = game({ id: "g", date: "2026-09-24", startTime: "19:30" });
    expect(
      buildFinalStatusEmail({
        game: g,
        playingCount: 5,
        appUrl: "http://localhost:3000",
      }).subject
    ).toContain("OFF");
    expect(
      buildFinalStatusEmail({
        game: g,
        playingCount: 6,
        appUrl: "http://localhost:3000",
      }).subject
    ).toContain("ON");
    expect(
      buildFinalStatusEmail({
        game: g,
        playingCount: 7,
        appUrl: "http://localhost:3000",
      }).subject
    ).toContain("ON");
  });
});

describe("idempotency keys", () => {
  it("sendRecordId is unique per game+type+user", async () => {
    const { sendRecordId } = await import("@/lib/notifications/defaults");
    expect(sendRecordId("g1", "game_reminder", "u1")).toBe(
      "g1_game_reminder_u1"
    );
    expect(sendRecordId("g1", "game_reminder", "u1")).not.toBe(
      sendRecordId("g1", "maybe_reminder", "u1")
    );
  });
});

describe("due slots / game changes", () => {
  it("changed date recalculates unsent schedule", () => {
    const settings = defaultNotificationSettings();
    const original = game({ id: "g1", date: "2026-09-24", startTime: "19:30" });
    const moved = game({ id: "g1", date: "2026-10-01", startTime: "19:30" });
    const due1 = computeNotificationDueAt(original, settings.gameReminder);
    const due2 = computeNotificationDueAt(moved, settings.gameReminder);
    expect(due1.toISOString()).not.toBe(due2.toISOString());
    expect(zonedCalendarDate(due2)).toBe("2026-09-30");
  });

  it("buildDueSlots skips cancelled and uses settings times", () => {
    const settings: NotificationSettings = {
      ...defaultNotificationSettings(),
      maybeReminder: { enabled: false, daysBefore: 0, timeLocal: "16:00" },
    };
    const games = [
      game({ id: "g1", date: "2026-09-24", startTime: "19:30" }),
      game({
        id: "g2",
        date: "2026-09-24",
        startTime: "19:30",
        status: "cancelled",
      }),
    ];
    const now = vancouverLocalToUtc("2026-09-23", "19:05");
    const slots = buildDueSlots({ games, settings, now });
    expect(slots.every((s) => s.gameId === "g1")).toBe(true);
    expect(slots.some((s) => s.notificationType === "maybe_reminder")).toBe(
      false
    );
    expect(slots.some((s) => s.notificationType === "game_reminder")).toBe(
      true
    );
  });
});

describe("notification time dropdown (15-minute options)", () => {
  it("builds 96 options on a 15-minute grid with HH:mm values", () => {
    const options = notificationTimeSelectOptions();
    expect(options).toHaveLength(96);
    expect(options[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(options.find((o) => o.value === "16:00")).toEqual({
      value: "16:00",
      label: "04:00 PM",
    });
    expect(options.find((o) => o.value === "18:00")).toEqual({
      value: "18:00",
      label: "06:00 PM",
    });
    expect(options.find((o) => o.value === "19:00")).toEqual({
      value: "19:00",
      label: "07:00 PM",
    });
    expect(options.at(-1)).toEqual({ value: "23:45", label: "11:45 PM" });
    // Every option stores canonical HH:mm (not 12-hour text)
    for (const o of options) {
      expect(o.value).toMatch(/^\d{2}:\d{2}$/);
      expect(o.label).toMatch(/^\d{2}:\d{2} (AM|PM)$/);
      expect(normalizeTimeLocalHHmm(o.value)).toBe(o.value);
    }
  });

  it("keeps existing saved HH:mm selected even off the 15-minute grid", () => {
    const options = notificationTimeSelectOptions("19:07");
    expect(options.some((o) => o.value === "19:07")).toBe(true);
    expect(options.find((o) => o.value === "19:07")?.label).toBe("07:07 PM");
  });

  it("normalizes H:mm to HH:mm for storage compatibility", () => {
    expect(normalizeTimeLocalHHmm("9:00")).toBe("09:00");
    expect(normalizeTimeLocalHHmm("16:00")).toBe("16:00");
    expect(formatTimeLocal12("16:00")).toBe("04:00 PM");
    expect(formatTimeLocal12("19:00")).toBe("07:00 PM");
  });

  it("selecting a dropdown option still feeds HH:mm into due-at logic", () => {
    const selected = notificationTimeSelectOptions().find(
      (o) => o.label === "07:00 PM"
    );
    expect(selected?.value).toBe("19:00");
    const g = game({ id: "g1", date: "2026-09-24", startTime: "19:30" });
    const due = computeNotificationDueAt(g, {
      enabled: true,
      daysBefore: 1,
      timeLocal: selected!.value,
    });
    expect(due.toISOString()).toBe(
      computeNotificationDueAt(g, {
        enabled: true,
        daysBefore: 1,
        timeLocal: "19:00",
      }).toISOString()
    );
  });
});
