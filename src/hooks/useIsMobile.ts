"use client";

import { useEffect, useState } from "react";
import {
  MOBILE_BREAKPOINT_PX,
  isMobileViewportWidth,
} from "@/lib/mobile-nav";

export type ViewportState = {
  /** False until the first client measurement (never assume desktop). */
  ready: boolean;
  isMobile: boolean;
};

/**
 * Viewport-based mobile detection (not user-agent).
 * Unresolved until measured — callers must not render desktop/mobile content yet.
 */
export function useViewport(breakpointPx = MOBILE_BREAKPOINT_PX): ViewportState {
  const [state, setState] = useState<ViewportState>({
    ready: false,
    isMobile: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const apply = () => {
      setState({
        ready: true,
        isMobile: mq.matches || isMobileViewportWidth(window.innerWidth),
      });
    };
    apply();
    mq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, [breakpointPx]);

  return state;
}

/**
 * Convenience boolean for call sites that only run after ViewportGate has already
 * resolved (e.g. desktop AppNav). Before ready, returns false without implying desktop.
 */
export function useIsMobile(breakpointPx = MOBILE_BREAKPOINT_PX): boolean {
  const { ready, isMobile } = useViewport(breakpointPx);
  return ready ? isMobile : false;
}
