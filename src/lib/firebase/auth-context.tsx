"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getClientAuth, getClientDb, isFirebaseConfigured } from "./client";
import { getUserProfile } from "./data";
import { provisionTeamSplitAccount } from "./complete-onboarding";
import type { UserProfile } from "../types";
import { isStaffRole } from "../roles";
import { formatUnknownError } from "../errors";
import { ONBOARDING_USER_MESSAGE } from "../auth/onboarding";

export type AppViewMode = "admin" | "player";

const VIEW_MODE_KEY = "teamsplit-view-mode";

function readStoredViewMode(): AppViewMode {
  if (typeof window === "undefined") return "admin";
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    if (raw === "player" || raw === "admin") return raw;
  } catch {
    /* ignore */
  }
  return "admin";
}

function mapAuthError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  if (code === "auth/email-already-in-use") {
    return "An account with this email already exists. Sign in or reset your password.";
  }
  if (code === "auth/invalid-email") {
    return "Enter a valid email address.";
  }
  if (code === "auth/weak-password") {
    return "Password must be at least 6 characters.";
  }
  if (
    code === "auth/user-not-found" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-credential"
  ) {
    return "Incorrect email or password.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Try again later.";
  }
  return formatUnknownError(err);
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  configured: boolean;
  /** Real Firestore role is admin (security / capabilities). */
  isAdmin: boolean;
  /**
   * UI-only preference for real admins: Admin View vs Player View.
   * Does not change Auth, role, or Firestore rules.
   */
  viewMode: AppViewMode;
  setViewMode: (mode: AppViewMode) => void;
  /** True only when real admin AND currently in Admin View. */
  showAdminUI: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<AppViewMode>("admin");
  /** Avoid concurrent onboard races from signUp + onAuthStateChanged. */
  const onboardInFlight = useRef<Promise<UserProfile> | null>(null);

  useEffect(() => {
    setViewModeState(readStoredViewMode());
  }, []);

  const setViewMode = useCallback((mode: AppViewMode) => {
    setViewModeState(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const ensureProfile = useCallback(
    async (authUser: User, displayName?: string | null): Promise<UserProfile> => {
      // Always run provision — idempotent; backfills missing evaluation / active flag.
      if (!onboardInFlight.current) {
        onboardInFlight.current = provisionTeamSplitAccount(
          authUser,
          displayName
        ).finally(() => {
          onboardInFlight.current = null;
        });
      }
      return onboardInFlight.current;
    },
    []
  );

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | undefined;
    setLoading(true);

    const applyAuthState = async (next: User | null) => {
      try {
        if (cancelled) return;

        if (!next) {
          setUser(null);
          setProfile(null);
          setError(null);
          return;
        }

        setUser(next);
        let p = await getUserProfile(getClientDb(), next.uid);
        if (cancelled) return;

        // Missing profile OR incomplete onboarding (e.g. no evaluation) → provision
        try {
          p = await ensureProfile(next, next.displayName);
        } catch (err) {
          if (cancelled) return;
          console.error("Onboarding failed", err);
          if (!p) {
            setProfile(null);
            setError(ONBOARDING_USER_MESSAGE);
            return;
          }
          // Profile exists but eval backfill failed — still allow session
        }
        if (cancelled) return;
        setProfile(p);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Auth/profile load failed", err);
        setUser(next);
        setProfile(null);
        setError(ONBOARDING_USER_MESSAGE);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    (async () => {
      try {
        const auth = getClientAuth();
        await auth.authStateReady();
        if (cancelled) return;
        await applyAuthState(auth.currentUser);
        if (cancelled) return;

        unsub = onAuthStateChanged(
          auth,
          (next) => {
            void applyAuthState(next);
          },
          (authErr) => {
            if (cancelled) return;
            console.error("onAuthStateChanged error", authErr);
            setUser(null);
            setProfile(null);
            setError(formatUnknownError(authErr));
            setLoading(false);
          }
        );
      } catch (err) {
        if (cancelled) return;
        console.error("Auth bootstrap failed", err);
        setError(formatUnknownError(err));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [configured, ensureProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await signInWithEmailAndPassword(getClientAuth(), email, password);
    } catch (err) {
      const message = mapAuthError(err);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      setError(null);
      const auth = getClientAuth();
      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        const name = displayName.trim();
        if (name) {
          await updateProfile(cred.user, { displayName: name });
        }
        // Shared in-flight promise with applyAuthState — no race / no orphan profile.
        const p = await ensureProfile(cred.user, name);
        setUser(cred.user);
        setProfile(p);
        setError(null);
      } catch (err) {
        if (err instanceof Error && err.message === ONBOARDING_USER_MESSAGE) {
          setError(ONBOARDING_USER_MESSAGE);
          throw err;
        }
        const message = mapAuthError(err);
        setError(message);
        throw new Error(message);
      }
    },
    [ensureProfile]
  );

  const resetPassword = useCallback(async (email: string) => {
    setError(null);
    try {
      const continueUrl =
        (typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")) ||
        "http://localhost:3000";
      await sendPasswordResetEmail(getClientAuth(), email.trim(), {
        url: `${continueUrl}/sign-in`,
      });
    } catch (err) {
      const message = mapAuthError(err);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    await firebaseSignOut(getClientAuth());
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    try {
      let p = await getUserProfile(getClientDb(), user.uid);
      if (!p) {
        p = await ensureProfile(user, user.displayName);
      }
      setProfile(p);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(ONBOARDING_USER_MESSAGE);
    }
  }, [user, ensureProfile]);

  const clearError = useCallback(() => setError(null), []);

  const isAdmin = Boolean(profile?.active && isStaffRole(profile.role));
  const showAdminUI = isAdmin && viewMode === "admin";

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      configured,
      isAdmin,
      viewMode: isAdmin ? viewMode : "player",
      setViewMode,
      showAdminUI,
      error,
      signIn,
      signUp,
      resetPassword,
      signOut,
      refreshProfile,
      clearError,
    }),
    [
      user,
      profile,
      loading,
      configured,
      isAdmin,
      viewMode,
      setViewMode,
      showAdminUI,
      error,
      signIn,
      signUp,
      resetPassword,
      signOut,
      refreshProfile,
      clearError,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
