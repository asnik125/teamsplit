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
import {
  DUPLICATE_DISPLAY_NAME_MESSAGE,
  ONBOARDING_USER_MESSAGE,
} from "../auth/onboarding";
import { createAuthTiming } from "../auth/auth-timing";
import {
  isHealthyUserProfile,
  needsBlockingProvision,
  shouldSkipAuthObserverResolve,
} from "../auth/session-profile";

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
  /**
   * True once the first Firebase Auth resolution (authStateReady + profile
   * attempt for that user) has finished. Sign In must wait for this.
   */
  authResolved: boolean;
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
  const [authResolved, setAuthResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<AppViewMode>(() =>
    readStoredViewMode()
  );
  /** Dedup concurrent blocking provision (signup / incomplete login). */
  const onboardInFlight = useRef<Promise<UserProfile> | null>(null);
  const profileUidRef = useRef<string | null>(null);
  const sessionHealthyRef = useRef(false);
  const applyGeneration = useRef(0);

  const setViewMode = useCallback((mode: AppViewMode) => {
    setViewModeState(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const runBlockingProvision = useCallback(
    async (
      authUser: User,
      displayName?: string | null
    ): Promise<UserProfile> => {
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

  const commitHealthySession = useCallback(
    (authUser: User, nextProfile: UserProfile) => {
      profileUidRef.current = nextProfile.uid;
      sessionHealthyRef.current = true;
      setUser(authUser);
      setProfile(nextProfile);
      setError(null);
      setLoading(false);
      setAuthResolved(true);
    },
    []
  );

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      setAuthResolved(true);
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | undefined;
    setLoading(true);
    setAuthResolved(false);

    const applyAuthState = async (next: User | null) => {
      const gen = ++applyGeneration.current;
      const timing = createAuthTiming("observer");
      try {
        if (cancelled) return;

        if (!next) {
          profileUidRef.current = null;
          sessionHealthyRef.current = false;
          setUser(null);
          setProfile(null);
          setError(null);
          timing.mark("signed_out");
          return;
        }

        timing.mark("auth_user", { uidLen: next.uid.length });

        if (
          shouldSkipAuthObserverResolve({
            nextUid: next.uid,
            resolvedUid: profileUidRef.current,
            sessionHealthy: sessionHealthyRef.current,
          })
        ) {
          timing.mark("skip_already_resolved");
          setUser(next);
          return;
        }

        const sameUserReady = profileUidRef.current === next.uid;
        if (!sameUserReady) {
          setLoading(true);
        }

        setUser(next);
        timing.mark("getUserProfile_start");
        let p = await getUserProfile(getClientDb(), next.uid);
        timing.mark("getUserProfile_complete", {
          healthy: isHealthyUserProfile(p),
        });
        if (cancelled || gen !== applyGeneration.current) return;

        if (isHealthyUserProfile(p)) {
          timing.mark("profileReady");
          commitHealthySession(next, p);
          timing.mark("sessionReady", { blockingProvision: false });
          return;
        }

        timing.mark("blocking_provision_start");
        try {
          p = await runBlockingProvision(next, next.displayName);
          timing.mark("blocking_provision_complete");
        } catch (err) {
          if (cancelled || gen !== applyGeneration.current) return;
          console.error("Onboarding failed", err);
          if (!p || needsBlockingProvision(p)) {
            profileUidRef.current = null;
            sessionHealthyRef.current = false;
            setProfile(null);
            setError(ONBOARDING_USER_MESSAGE);
            return;
          }
        }
        if (cancelled || gen !== applyGeneration.current) return;
        if (!isHealthyUserProfile(p)) {
          profileUidRef.current = null;
          sessionHealthyRef.current = false;
          setProfile(null);
          setError(ONBOARDING_USER_MESSAGE);
          return;
        }
        timing.mark("profileReady");
        commitHealthySession(next, p);
        timing.mark("sessionReady", { blockingProvision: true });
      } catch (err) {
        if (cancelled || gen !== applyGeneration.current) return;
        console.error("Auth/profile load failed", err);
        setUser(next);
        profileUidRef.current = null;
        sessionHealthyRef.current = false;
        setProfile(null);
        setError(ONBOARDING_USER_MESSAGE);
      } finally {
        if (!cancelled && gen === applyGeneration.current) {
          if (!sessionHealthyRef.current) {
            setLoading(false);
          }
          setAuthResolved(true);
          timing.mark("observer_finally");
        }
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
            profileUidRef.current = null;
            sessionHealthyRef.current = false;
            setUser(null);
            setProfile(null);
            setError(formatUnknownError(authErr));
            setLoading(false);
            setAuthResolved(true);
          }
        );
      } catch (err) {
        if (cancelled) return;
        console.error("Auth bootstrap failed", err);
        setError(formatUnknownError(err));
        setLoading(false);
        setAuthResolved(true);
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [configured, commitHealthySession, runBlockingProvision]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setLoading(true);
      const timing = createAuthTiming("signIn");
      timing.mark("signIn_start");
      try {
        const cred = await signInWithEmailAndPassword(
          getClientAuth(),
          email,
          password
        );
        timing.mark("firebase_auth_resolved");

        timing.mark("getUserProfile_start");
        let p = await getUserProfile(getClientDb(), cred.user.uid);
        timing.mark("getUserProfile_complete", {
          healthy: isHealthyUserProfile(p),
        });

        if (isHealthyUserProfile(p)) {
          timing.mark("profileReady");
          commitHealthySession(cred.user, p);
          timing.mark("sessionReady", {
            blockingProvisionCalls: 0,
          });
          return;
        }

        timing.mark("blocking_provision_start");
        try {
          p = await runBlockingProvision(cred.user, cred.user.displayName);
          timing.mark("blocking_provision_complete");
        } catch (err) {
          console.error("Onboarding failed", err);
          if (!p || needsBlockingProvision(p)) {
            profileUidRef.current = null;
            sessionHealthyRef.current = false;
            setUser(cred.user);
            setProfile(null);
            setError(ONBOARDING_USER_MESSAGE);
            setLoading(false);
            setAuthResolved(true);
            throw new Error(ONBOARDING_USER_MESSAGE);
          }
        }
        if (!isHealthyUserProfile(p)) {
          profileUidRef.current = null;
          sessionHealthyRef.current = false;
          setUser(cred.user);
          setProfile(null);
          setError(ONBOARDING_USER_MESSAGE);
          setLoading(false);
          setAuthResolved(true);
          throw new Error(ONBOARDING_USER_MESSAGE);
        }
        timing.mark("profileReady");
        commitHealthySession(cred.user, p);
        timing.mark("sessionReady", { blockingProvisionCalls: 1 });
      } catch (err) {
        if (err instanceof Error && err.message === ONBOARDING_USER_MESSAGE) {
          throw err;
        }
        const message = mapAuthError(err);
        setError(message);
        setLoading(false);
        setAuthResolved(true);
        throw new Error(message);
      }
    },
    [commitHealthySession, runBlockingProvision]
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      setError(null);
      setLoading(true);
      const timing = createAuthTiming("signUp");
      timing.mark("signUp_start");
      const auth = getClientAuth();
      let createdUser: User | null = null;
      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        createdUser = cred.user;
        timing.mark("firebase_auth_resolved");
        const name = displayName.trim();
        if (name) {
          await updateProfile(cred.user, { displayName: name });
        }
        // New accounts have no profile — blocking provision required for
        // users + player link + role/active before UI entry.
        timing.mark("blocking_provision_start");
        const p = await runBlockingProvision(cred.user, name);
        timing.mark("blocking_provision_complete");
        if (!isHealthyUserProfile(p)) {
          throw new Error(ONBOARDING_USER_MESSAGE);
        }
        timing.mark("profileReady");
        commitHealthySession(cred.user, p);
        timing.mark("sessionReady", { blockingProvisionCalls: 1 });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : mapAuthError(err);
        if (
          createdUser &&
          (message === DUPLICATE_DISPLAY_NAME_MESSAGE ||
            /already taken/i.test(message))
        ) {
          try {
            await createdUser.delete();
          } catch {
            /* ignore */
          }
          createdUser = null;
          profileUidRef.current = null;
          sessionHealthyRef.current = false;
          setUser(null);
          setProfile(null);
          setError(DUPLICATE_DISPLAY_NAME_MESSAGE);
          setLoading(false);
          setAuthResolved(true);
          throw new Error(DUPLICATE_DISPLAY_NAME_MESSAGE);
        }
        if (err instanceof Error && err.message === ONBOARDING_USER_MESSAGE) {
          setError(ONBOARDING_USER_MESSAGE);
          setLoading(false);
          setAuthResolved(true);
          throw err;
        }
        if (err instanceof Error && message === DUPLICATE_DISPLAY_NAME_MESSAGE) {
          setError(DUPLICATE_DISPLAY_NAME_MESSAGE);
          setLoading(false);
          setAuthResolved(true);
          throw err;
        }
        const mapped = mapAuthError(err);
        setError(mapped);
        setLoading(false);
        setAuthResolved(true);
        throw new Error(mapped);
      }
    },
    [commitHealthySession, runBlockingProvision]
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
    setLoading(true);
    profileUidRef.current = null;
    sessionHealthyRef.current = false;
    try {
      await firebaseSignOut(getClientAuth());
      setUser(null);
      setProfile(null);
      setLoading(false);
      setAuthResolved(true);
    } catch (err) {
      setLoading(false);
      setAuthResolved(true);
      throw err;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    try {
      let p = await getUserProfile(getClientDb(), user.uid);
      if (needsBlockingProvision(p)) {
        p = await runBlockingProvision(user, user.displayName);
      }
      if (!isHealthyUserProfile(p)) {
        setError(ONBOARDING_USER_MESSAGE);
        return;
      }
      profileUidRef.current = p.uid;
      sessionHealthyRef.current = true;
      setProfile(p);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(ONBOARDING_USER_MESSAGE);
    }
  }, [user, runBlockingProvision]);

  const clearError = useCallback(() => setError(null), []);

  const isAdmin = Boolean(profile?.active && isStaffRole(profile.role));
  const showAdminUI = isAdmin && viewMode === "admin";

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      authResolved,
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
      authResolved,
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
