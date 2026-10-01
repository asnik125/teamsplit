import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendanceStatus, Game, Player, UserProfile } from "@/lib/types";

type DocData = Record<string, unknown>;

interface MemRef {
  id: string;
  get: () => Promise<{
    id: string;
    exists: boolean;
    ref: MemRef;
    data: () => DocData;
  }>;
  set: (data: DocData, opts?: { merge?: boolean }) => Promise<void>;
  update: (data: DocData) => Promise<void>;
  delete: () => Promise<void>;
}

const h = vi.hoisted(() => {
  const cols = new Map<string, Map<string, DocData>>();
  let auto = 0;
  const sent: { to: string; subject: string; text: string; html: string }[] = [];

  function bucket(name: string) {
    let map = cols.get(name);
    if (!map) {
      map = new Map();
      cols.set(name, map);
    }
    return map;
  }

  function write(collectionName: string, id: string, data: DocData, merge?: boolean) {
    const map = bucket(collectionName);
    if (merge && map.has(id)) {
      map.set(id, { ...map.get(id), ...data });
    } else {
      map.set(id, { ...data });
    }
  }

  function ref(collectionName: string, id?: string): MemRef {
    const docId = id ?? `auto_${++auto}`;
    const handle: MemRef = {
      id: docId,
      async get() {
        const data = bucket(collectionName).get(docId);
        return {
          id: docId,
          exists: data !== undefined,
          ref: handle,
          data: () => ({ ...(data ?? {}) }),
        };
      },
      async set(data, opts) {
        write(collectionName, docId, data, opts?.merge);
      },
      async update(data) {
        if (!bucket(collectionName).has(docId)) {
          throw new Error(`missing ${collectionName}/${docId}`);
        }
        write(collectionName, docId, data, true);
      },
      async delete() {
        bucket(collectionName).delete(docId);
      },
    };
    return handle;
  }

  function query(collectionName: string, filters: { field: string; value: unknown }[]) {
    return {
      where(field: string, op: string, value: unknown) {
        if (op !== "==") throw new Error(`unsupported op ${op}`);
        return query(collectionName, [...filters, { field, value }]);
      },
      async get() {
        const docs = [...bucket(collectionName).entries()]
          .filter(([, data]) => filters.every((f) => data[f.field] === f.value))
          .map(([id]) => {
            const docRef = ref(collectionName, id);
            return {
              id,
              ref: docRef,
              data: () => ({ ...(bucket(collectionName).get(id) ?? {}) }),
            };
          });
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  const db = {
    collection(name: string) {
      return {
        doc: (id?: string) => ref(name, id),
        where: (field: string, op: string, value: unknown) => {
          if (op !== "==") throw new Error(`unsupported op ${op}`);
          return query(name, [{ field, value }]);
        },
        get: () => query(name, []).get(),
      };
    },
    async runTransaction<T>(
      fn: (tx: {
        get: MemRef["get"];
        set: (r: MemRef, data: DocData, opts?: { merge?: boolean }) => void;
      }) => Promise<T>
    ) {
      return fn({
        get: (r) => r.get(),
        set: (r, data, opts) => {
          void r.set(data, opts);
        },
      });
    },
    batch() {
      const ops: Array<() => void> = [];
      return {
        delete(r: MemRef) {
          ops.push(() => {
            void r.delete();
          });
        },
        async commit() {
          for (const op of ops) op();
        },
      };
    },
    reset() {
      cols.clear();
      auto = 0;
      sent.length = 0;
    },
  };

  return { db, sent };
});

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => h.db,
}));

vi.mock("@/lib/notifications/resend-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/notifications/resend-client")>();
  return {
    ...actual,
    getAppUrl: () => "https://teamsplit.vanaku.com",
    sendResendEmail: async (input: {
      to: string;
      content: { subject: string; text: string; html: string };
    }) => {
      h.sent.push({
        to: input.to,
        subject: input.content.subject,
        text: input.content.text,
        html: input.content.html,
      });
      return { id: `re_${h.sent.length}` };
    },
  };
});

import { processDueNotifications } from "@/lib/notifications/process";
import { setGameNoGame } from "@/lib/firebase/sync-teams-admin";

function game(partial: Partial<Game> & Pick<Game, "id" | "date" | "startTime">): Game {
  return {
    endTime: null,
    location: "Gym",
    status: "scheduled",
    noGame: false,
    seasonId: "2026-2027",
    createdBy: "admin",
    createdAt: "",
    updatedAt: "",
    teamsMayBeStale: false,
    teamsStatusMessage: null,
    lastAttendanceChange: null,
    ...partial,
  };
}

const oct1 = game({
  id: "g_oct1",
  date: "2026-10-01",
  startTime: "19:30",
  location: "Gym",
});

/** Sep 30, 2026 7:05 PM America/Vancouver — day-before reminder is due. */
const reminderNow = new Date("2026-10-01T02:05:00.000Z");
/** Oct 1, 2026 4:05 PM America/Vancouver — Maybe / attendance reminder is due. */
const maybeNow = new Date("2026-10-01T23:05:00.000Z");
/** Oct 1, 2026 5:35 PM America/Vancouver — automatic OFF check (kickoff − 2h). */
const offNow = new Date("2026-10-02T00:35:00.000Z");

async function seedUser() {
  const user: UserProfile = {
    uid: "u1",
    playerId: "p1",
    displayName: "Kalya A",
    email: "player@example.com",
    role: "player",
    emailNotifications: true,
    active: true,
    createdAt: "",
    updatedAt: "",
  };
  const player: Player = {
    id: "p1",
    displayName: "Kalya A",
    email: null,
    active: true,
    linkedUid: "u1",
    createdAt: "",
    updatedAt: "",
  };
  await h.db.collection("users").doc(user.uid).set(user as unknown as DocData);
  await h.db.collection("players").doc(player.id).set(player as unknown as DocData);
}

async function seedAttendance(
  gameId: string,
  count: number,
  status: AttendanceStatus
) {
  for (let i = 0; i < count; i++) {
    const playerId = i === 0 ? "p1" : `p_extra_${i}`;
    await h.db.collection("attendance").doc(`${gameId}_${playerId}`).set({
      gameId,
      playerId,
      status,
      updatedAt: "",
      updatedBy: null,
    });
  }
}

async function seedGame(g: Game) {
  await h.db.collection("games").doc(g.id).set({ ...g });
}

beforeEach(() => {
  h.db.reset();
});

describe("No Game notification dispatch", () => {
  it("No Game already set → tomorrow reminder is not sent", async () => {
    await seedUser();
    await seedGame({ ...oct1, noGame: true });
    await seedAttendance(oct1.id, 1, "playing");

    await processDueNotifications({ now: reminderNow });

    expect(h.sent.map((m) => m.subject)).not.toContain("TeamSplit — Game tomorrow");
    expect(h.sent.some((m) => m.text.includes("Game tomorrow"))).toBe(false);
    expect(h.sent.some((m) => m.text.includes("Your current attendance"))).toBe(
      false
    );
    expect(h.sent.some((m) => m.text.includes("not enough confirmed players"))).toBe(
      false
    );
    expect(h.sent.some((m) => m.text.includes("confirmed Playing"))).toBe(false);
  });

  it("No Game already set → attendance reminder is not sent", async () => {
    await seedUser();
    await seedGame({ ...oct1, noGame: true });
    await seedAttendance(oct1.id, 1, "maybe");

    await processDueNotifications({ now: maybeNow });

    expect(h.sent.map((m) => m.subject)).not.toContain(
      "TeamSplit — Are you playing today?"
    );
    expect(h.sent.some((m) => m.text.includes("Your current attendance"))).toBe(
      false
    );
    expect(h.sent.some((m) => m.text.includes("Your current status is Maybe"))).toBe(
      false
    );
    expect(h.sent.some((m) => m.text.includes("not enough confirmed players"))).toBe(
      false
    );
    expect(h.sent.some((m) => m.text.includes("confirmed Playing"))).toBe(false);
  });

  it("changing a scheduled game to No Game sends the existing OFF notification once", async () => {
    await seedUser();
    await seedGame({ ...oct1, noGame: false });
    await seedAttendance(oct1.id, 1, "playing");

    await setGameNoGame({
      gameId: oct1.id,
      noGame: true,
      updatedBy: "admin",
    });

    expect(h.sent).toHaveLength(1);
    const email = h.sent[0]!;
    expect(email.subject).toBe("TeamSplit — Game is OFF");
    expect(email.text).toContain("Game is OFF");
    expect(email.text).toContain("Thursday, October 1");
    expect(email.text).toContain("7:30 PM");
    expect(email.text).toContain("Location: Gym");
    expect(email.text).not.toContain("not enough confirmed players");
    expect(email.text).not.toContain("confirmed Playing");
    expect(email.text).not.toContain("minimum required");
    expect(email.text).not.toContain("Your current attendance");
    expect(email.html).not.toContain("not enough confirmed players");
    expect(email.html).not.toContain("confirmed Playing");
    expect(email.html).not.toContain("Your current attendance");

    const saved = await h.db.collection("games").doc(oct1.id).get();
    expect(saved.data().noGame).toBe(true);

    await processDueNotifications({ now: reminderNow });
    await processDueNotifications({ now: maybeNow });
    await processDueNotifications({ now: offNow });
    expect(h.sent).toHaveLength(1);
  });

  it("repeated cron does not duplicate OFF for a game already marked No Game", async () => {
    await seedUser();
    await seedGame({ ...oct1, noGame: true });

    await processDueNotifications({ now: reminderNow });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.subject).toBe("TeamSplit — Game is OFF");
    expect(h.sent[0]?.text).not.toContain("not enough confirmed players");
    expect(h.sent[0]?.text).not.toContain("confirmed Playing");
    expect(h.sent[0]?.text).not.toContain("Your current attendance");

    await processDueNotifications({ now: reminderNow });
    await processDueNotifications({ now: offNow });
    // Still Oct 1 in Vancouver, after kickoff: dedupe holds.
    await processDueNotifications({ now: new Date("2026-10-02T03:30:00.000Z") });
    // Oct 2: window closed, still one OFF.
    await processDueNotifications({ now: new Date("2026-10-02T17:00:00.000Z") });
    expect(h.sent).toHaveLength(1);
  });

  it("active game still sends the normal tomorrow reminder", async () => {
    await seedUser();
    await seedGame({ ...oct1, noGame: false });
    await seedAttendance(oct1.id, 1, "playing");

    await processDueNotifications({ now: reminderNow });

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.subject).toBe("TeamSplit — Game tomorrow");
    expect(h.sent[0]?.text).toContain("Your current attendance: Playing");
    expect(h.sent[0]?.text).toContain("Thursday, October 1");
    expect(h.sent[0]?.text).toContain("7:30 PM");
  });

  it("automatic low-attendance OFF still sends once and stays quiet at the minimum", async () => {
    await seedUser();
    await seedGame({ ...oct1, noGame: false });
    await seedAttendance(oct1.id, 5, "playing");

    await processDueNotifications({ now: offNow });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.subject).toBe("TeamSplit — Game is OFF");
    expect(h.sent[0]?.text).toContain("Game is OFF — not enough confirmed players.");
    expect(h.sent[0]?.text).toContain("5 confirmed Playing (minimum required: 6)");
    expect(h.sent[0]?.text).not.toContain("Your current attendance");

    await processDueNotifications({ now: offNow });
    expect(h.sent).toHaveLength(1);

    h.db.reset();
    await seedUser();
    await seedGame({ ...oct1, noGame: false });
    await seedAttendance(oct1.id, 6, "playing");
    await processDueNotifications({ now: offNow });
    expect(h.sent).toHaveLength(0);

    await h.db.collection("attendance").doc(`${oct1.id}_p_extra_5`).delete();
    await processDueNotifications({ now: offNow });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.subject).toBe("TeamSplit — Game is OFF");
  });

  it("reopening No Game allows a later automatic OFF, without a second email while it stays off", async () => {
    await seedUser();
    await seedGame({ ...oct1, noGame: false });
    await seedAttendance(oct1.id, 5, "playing");

    await setGameNoGame({ gameId: oct1.id, noGame: true, updatedBy: "admin" });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.text).not.toContain("not enough confirmed players");
    expect(h.sent[0]?.text).not.toContain("confirmed Playing");

    await processDueNotifications({ now: offNow });
    expect(h.sent).toHaveLength(1);

    await setGameNoGame({ gameId: oct1.id, noGame: false, updatedBy: "admin" });
    expect(h.sent).toHaveLength(1);

    await seedAttendance(oct1.id, 5, "playing");
    await processDueNotifications({ now: offNow });
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]?.subject).toBe("TeamSplit — Game is OFF");
    expect(h.sent[1]?.text).toContain("Game is OFF — not enough confirmed players.");
    expect(h.sent[1]?.text).toContain("5 confirmed Playing (minimum required: 6)");

    await processDueNotifications({ now: offNow });
    expect(h.sent).toHaveLength(2);
  });
});
