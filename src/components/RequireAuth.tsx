"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppLoadingShell } from "@/components/AppLoadingShell";
import { useAuth } from "@/lib/firebase/auth-context";
import { isStaffRole } from "@/lib/roles";

export function RequireAuth({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const {
    user,
    profile,
    loading,
    authResolved,
    configured,
    error,
    signOut,
    showAdminUI,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!authResolved || loading) return;
    if (!configured) return;
    // Stay on page to show error rather than bounce forever when profile is missing.
    if (error) return;
    if (!user) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!profile || !profile.active) {
      router.replace("/sign-in?error=inactive");
      return;
    }
    if (adminOnly && !isStaffRole(profile.role)) {
      router.replace("/");
      return;
    }
    // Real admins in Player View should not stay on Admin screens.
    if (adminOnly && !showAdminUI) {
      router.replace("/");
    }
  }, [
    loading,
    authResolved,
    configured,
    user,
    profile,
    adminOnly,
    router,
    pathname,
    error,
    showAdminUI,
  ]);

  if (!authResolved || loading) {
    return <AppLoadingShell />;
  }

  if (!configured) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        Firebase is not configured. Copy <code>.env.example</code> to{" "}
        <code>.env.local</code> and set your real Firebase Web App values (see
        README).
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
          <p className="font-semibold">Could not load your TeamSplit session</p>
          <p className="mt-2 break-words text-red-50/90">{error}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (!user || !profile?.active) {
    return <AppLoadingShell />;
  }
  if (adminOnly && !isStaffRole(profile.role)) {
    return <AppLoadingShell />;
  }
  if (adminOnly && !showAdminUI) {
    return <AppLoadingShell />;
  }

  return <>{children}</>;
}
