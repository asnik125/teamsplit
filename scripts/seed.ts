/**
 * Import players + evaluations from soccer_players_backup.json into real Firestore.
 *
 * Does NOT create Firebase Authentication users.
 * You create Auth users in Firebase Console and link them via users/{uid} separately.
 *
 * Prerequisites:
 *   1. Service account JSON with Firestore write access
 *   2. Environment variables (see README)
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccount.json
 *   export NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
 *   export CONFIRM_FIRESTORE_SEED=true
 *   npm run seed
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

interface SeedPlayer {
  id: string;
  name: string;
  speed: number;
  strength: number;
  stamina: number;
  control: number;
  passing: number;
  action: number;
  defend: number;
  attack: number;
  transition: number;
  decisions: number;
  workrate: number;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  if (process.env.CONFIRM_FIRESTORE_SEED !== "true") {
    console.error(
      "Refusing to write to Firestore.\n" +
        "Set CONFIRM_FIRESTORE_SEED=true after reviewing the target project, then re-run."
    );
    process.exit(1);
  }

  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    console.error(
      "FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are set. " +
        "Unset them — this project seeds the real Firebase project only."
    );
    process.exit(1);
  }

  const projectId = requireEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID");

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialPath) {
    initializeApp({
      credential: cert(JSON.parse(readFileSync(credentialPath, "utf8"))),
      projectId,
    });
  } else {
    initializeApp({
      credential: applicationDefault(),
      projectId,
    });
  }

  const db = getFirestore();
  const jsonPath = resolve(process.cwd(), "soccer_players_backup.json");
  const players = JSON.parse(readFileSync(jsonPath, "utf8")) as SeedPlayer[];
  const now = new Date().toISOString();

  console.log(
    `Importing ${players.length} players + evaluations into Firestore project "${projectId}"…`
  );

  for (const p of players) {
    const playerRef = db.collection("players").doc(p.id);
    const existing = await playerRef.get();
    const prev = existing.exists ? existing.data() : null;

    await playerRef.set(
      {
        id: p.id,
        displayName: p.name,
        email: prev?.email ?? null,
        active: prev?.active ?? true,
        linkedUid: prev?.linkedUid ?? null,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );

    await db
      .collection("playerEvaluations")
      .doc(p.id)
      .set({
        playerId: p.id,
        speed: p.speed,
        strength: p.strength,
        stamina: p.stamina,
        control: p.control,
        passing: p.passing,
        action: p.action,
        defend: p.defend,
        attack: p.attack,
        transition: p.transition,
        decisions: p.decisions,
        workrate: p.workrate,
        updatedAt: now,
        updatedBy: "seed",
      });

    console.log(`  ✓ ${p.name} (${p.id})`);
  }

  console.log("\nDone. Auth users were NOT created.");
  console.log(
    "Next: create users in Firebase Authentication, then create users/{uid} docs with role + playerId."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
