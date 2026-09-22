import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let app: App | undefined;

function loadServiceAccount(): ServiceAccount | null {
  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonEnv) {
    return JSON.parse(jsonEnv) as ServiceAccount;
  }
  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    resolve(process.cwd(), "firebase-service-account.json");
  if (existsSync(credPath)) {
    return JSON.parse(readFileSync(credPath, "utf8")) as ServiceAccount;
  }
  return null;
}

export function getAdminApp(): App {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0]!;
    return app;
  }
  const sa = loadServiceAccount();
  if (sa) {
    app = initializeApp({
      credential: cert(sa),
      projectId:
        typeof sa.projectId === "string"
          ? sa.projectId
          : process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  } else {
    app = initializeApp({
      credential: applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }
  return app;
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}
