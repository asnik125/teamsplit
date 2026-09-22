"use client";

import type { ReactNode } from "react";
import { AppLoadingShell } from "@/components/AppLoadingShell";
import { useViewport } from "@/hooks/useIsMobile";
import { useAuth } from "@/lib/firebase/auth-context";
import {
  selectAuthenticatedMobileSurface,
  shouldRenderViewportContent,
} from "@/lib/session-ready";

/**
 * Renders dedicated mobile presentation below the breakpoint.
 * Desktop children stay exactly as provided (existing desktop UI).
 * Holds a neutral loading shell until viewport + auth/profile are ready.
 */
export function ViewportGate({
  desktop,
  mobilePlayer,
  mobileAdmin,
}: {
  desktop: ReactNode;
  mobilePlayer: ReactNode;
  mobileAdmin?: ReactNode;
}) {
  const { ready: viewportReady, isMobile } = useViewport();
  const { loading, authResolved, profile, showAdminUI } = useAuth();

  if (!shouldRenderViewportContent({ viewportReady })) {
    return <AppLoadingShell />;
  }

  if (!authResolved || loading) {
    return <AppLoadingShell />;
  }

  if (!isMobile) {
    return <>{desktop}</>;
  }

  const surface = selectAuthenticatedMobileSurface({
    authResolved,
    loading,
    profileReady: Boolean(profile?.active),
    showAdminUI,
    hasMobileAdmin: Boolean(mobileAdmin),
  });

  if (surface === "loading") return <AppLoadingShell />;
  if (surface === "admin") return <>{mobileAdmin}</>;
  return <>{mobilePlayer}</>;
}
