import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

/**
 * Next.js only inlines NEXT_PUBLIC_* when accessed as static property paths
 * (e.g. process.env.NEXT_PUBLIC_FIREBASE_API_KEY). Dynamic access like
 * process.env[name] is undefined in the client bundle.
 */
function readRequiredConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "";
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "";
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "";
  const storageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ?? "";
  const messagingSenderId =
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? "";
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() ?? "";

  const missing: string[] = [];
  if (!apiKey) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!authDomain) missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!storageBucket) missing.push("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (!messagingSenderId) missing.push("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
  if (!appId) missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env.local and set values from your Firebase Web App config.`
    );
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

export function isFirebaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() &&
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() &&
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() &&
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() &&
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim()
  );
}

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    const config = readRequiredConfig();
    app = getApps().length ? getApp() : initializeApp(config);
  }
  return app;
}

export function getClientAuth(): Auth {
  if (typeof window === "undefined") {
    throw new Error("Firebase Auth is only available in the browser");
  }
  if (!auth) {
    auth = getAuth(getFirebaseApp());
  }
  return auth;
}

export function getClientDb(): Firestore {
  if (typeof window === "undefined") {
    throw new Error("Firestore is only available in the browser");
  }
  if (!db) {
    db = getFirestore(getFirebaseApp());
  }
  return db;
}
