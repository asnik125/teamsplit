"use client";

import { FormEvent, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLoadingShell } from "@/components/AppLoadingShell";
import { useAuth } from "@/lib/firebase/auth-context";
import { formatUnknownError } from "@/lib/errors";
import { shouldShowSignInForm } from "@/lib/session-ready";

type AuthMode = "signin" | "register" | "reset";

function SignInForm() {
  const {
    signIn,
    signUp,
    resetPassword,
    configured,
    user,
    profile,
    loading,
    authResolved,
    error: authError,
    clearError,
  } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Password managers (LastPass, etc.) inject DOM nodes into inputs before
  // hydrate and cause a recoverable mismatch — render the form after mount.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (
      authResolved &&
      !loading &&
      user &&
      profile?.active &&
      mode !== "reset"
    ) {
      router.replace(next);
    }
  }, [authResolved, loading, user, profile, router, next, mode]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setMessage(null);
    clearError();
    setPassword("");
    setConfirm("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    clearError();
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
        // Keep shell until replace; profile is already resolved by signIn.
        router.replace(next);
        return;
      }
      if (mode === "register") {
        if (password.length < 6) {
          throw new Error("Password must be at least 6 characters.");
        }
        if (password !== confirm) {
          throw new Error("Passwords do not match.");
        }
        if (!displayName.trim()) {
          throw new Error("Enter your name.");
        }
        await signUp(email.trim(), password, displayName.trim());
        router.replace(next);
        return;
      }
      // reset
      if (!email.trim()) {
        throw new Error("Enter your email address.");
      }
      await resetPassword(email.trim());
      setMessage(
        "If an account exists for that email, a password reset link has been sent. Check your inbox."
      );
    } catch (err) {
      setError(formatUnknownError(err));
    } finally {
      setBusy(false);
    }
  }

  const showForm = shouldShowSignInForm({
    authResolved,
    loading,
    userPresent: Boolean(user),
    authActionPending: busy && mode !== "reset",
  });

  if (!mounted || !showForm) {
    return (
      <AppLoadingShell
        label={
          busy && mode === "signin"
            ? "Signing in…"
            : busy && mode === "register"
              ? "Creating account…"
              : "Loading…"
        }
      />
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white">TeamSplit</h1>
      </div>

      {!configured && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          Firebase env vars missing. See README / .env.example.
        </div>
      )}

      {params.get("error") === "inactive" && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
          Account is inactive or missing a profile.
        </div>
      )}

      <div
        className="mb-4 flex rounded-lg border border-slate-700 bg-slate-900/80 p-1"
        role="tablist"
        aria-label="Account"
      >
        {(
          [
            ["signin", "Sign in"],
            ["register", "Register"],
            ["reset", "Reset"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={`flex-1 rounded-md px-2 py-2 text-sm font-semibold transition ${
              mode === id
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => switchMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="card space-y-4">
        {mode === "register" && (
          <div>
            <label className="label" htmlFor="displayName">
              Name
            </label>
            <input
              id="displayName"
              className="input"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {mode !== "reset" && (
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 6 : undefined}
            />
          </div>
        )}
        {mode === "register" && (
          <div>
            <label className="label" htmlFor="confirm">
              Confirm password
            </label>
            <input
              id="confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
            />
          </div>
        )}
        {mode === "reset" && (
          <p className="text-sm text-slate-400">
            We&apos;ll email you a link to choose a new password.
          </p>
        )}
        {(error || authError) && (
          <p className="break-words text-sm text-red-400">
            {error || authError}
          </p>
        )}
        {message && (
          <p className="break-words text-sm text-green-400">{message}</p>
        )}
        <button
          className="btn btn-primary w-full"
          disabled={busy || !configured}
        >
          {busy
            ? mode === "signin"
              ? "Signing in…"
              : mode === "register"
                ? "Creating account…"
                : "Sending…"
            : mode === "signin"
              ? "Sign in"
              : mode === "register"
                ? "Create account"
                : "Send reset link"}
        </button>
        {mode === "signin" && (
          <p className="text-center text-sm text-slate-400">
            <button
              type="button"
              className="text-blue-400 hover:underline"
              onClick={() => switchMode("reset")}
            >
              Forgot password?
            </button>
          </p>
        )}
      </form>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<AppLoadingShell />}>
      <SignInForm />
    </Suspense>
  );
}
