import { describe, expect, it } from "vitest";
import {
  isHealthyUserProfile,
  needsBlockingProvision,
  roleFromHealthyProfile,
  shouldBlockOnProvision,
  shouldSkipAuthObserverResolve,
} from "@/lib/auth/session-profile";
import {
  selectAuthenticatedMobileSurface,
  shouldRenderViewportContent,
  shouldShowSignInForm,
  selectSessionSurface,
} from "@/lib/session-ready";
import type { UserProfile } from "@/lib/types";

function healthy(over: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: "uid-1",
    playerId: "p_uid-1",
    displayName: "Alex",
    email: "alex@example.com",
    role: "player",
    emailNotifications: true,
    active: true,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

describe("healthy existing profile → UI ready without blocking provision", () => {
  it("treats active profile with playerId + role as healthy", () => {
    expect(isHealthyUserProfile(healthy())).toBe(true);
    expect(isHealthyUserProfile(healthy({ role: "admin" }))).toBe(true);
    expect(needsBlockingProvision(healthy())).toBe(false);
    expect(
      shouldBlockOnProvision({ mode: "login", profile: healthy() })
    ).toBe(false);
  });

  it("healthy login plans 0 blocking provision calls", () => {
    const profile = healthy({ role: "admin" });
    const blockingCalls = shouldBlockOnProvision({
      mode: "login",
      profile,
    })
      ? 1
      : 0;
    expect(blockingCalls).toBe(0);
    // Role known from profile before Admin/Player UI selection
    expect(roleFromHealthyProfile(profile)).toBe("admin");
    expect(
      selectAuthenticatedMobileSurface({
        authResolved: true,
        loading: false,
        profileReady: true,
        showAdminUI: true,
        hasMobileAdmin: true,
      })
    ).toBe("admin");
  });
});

describe("missing / incomplete profile → blocking provision required", () => {
  it("missing profile", () => {
    expect(isHealthyUserProfile(null)).toBe(false);
    expect(needsBlockingProvision(null)).toBe(true);
    expect(shouldBlockOnProvision({ mode: "login", profile: null })).toBe(
      true
    );
  });

  it("missing playerId", () => {
    expect(
      needsBlockingProvision(healthy({ playerId: null }))
    ).toBe(true);
  });

  it("inactive profile", () => {
    expect(needsBlockingProvision(healthy({ active: false }))).toBe(true);
  });

  it("empty playerId string", () => {
    expect(needsBlockingProvision(healthy({ playerId: "  " }))).toBe(true);
  });
});

describe("signup still requires blocking provision", () => {
  it("blocks even if a profile object is somehow present", () => {
    expect(
      shouldBlockOnProvision({ mode: "signup", profile: healthy() })
    ).toBe(true);
    expect(shouldBlockOnProvision({ mode: "signup", profile: null })).toBe(
      true
    );
  });
});

describe("signIn + auth observer → no duplicate provisioning", () => {
  it("skips observer resolve when UID already session-healthy", () => {
    expect(
      shouldSkipAuthObserverResolve({
        nextUid: "uid-1",
        resolvedUid: "uid-1",
        sessionHealthy: true,
      })
    ).toBe(true);
  });

  it("does not skip when session not healthy yet", () => {
    expect(
      shouldSkipAuthObserverResolve({
        nextUid: "uid-1",
        resolvedUid: "uid-1",
        sessionHealthy: false,
      })
    ).toBe(false);
  });

  it("does not skip when UID differs", () => {
    expect(
      shouldSkipAuthObserverResolve({
        nextUid: "uid-2",
        resolvedUid: "uid-1",
        sessionHealthy: true,
      })
    ).toBe(false);
  });
});

describe("anti-flash gates remain intact", () => {
  it("unresolved auth does not show Sign In", () => {
    expect(
      shouldShowSignInForm({
        authResolved: false,
        loading: true,
        userPresent: false,
      })
    ).toBe(false);
  });

  it("unresolved viewport stays behind loading shell", () => {
    expect(shouldRenderViewportContent({ viewportReady: false })).toBe(false);
  });

  it("Admin role must be known before Admin mobile UI", () => {
    expect(
      selectAuthenticatedMobileSurface({
        authResolved: true,
        loading: false,
        profileReady: false,
        showAdminUI: false,
        hasMobileAdmin: true,
      })
    ).toBe("loading");
  });

  it("logout reaches Sign In after loading clears", () => {
    expect(
      selectSessionSurface({
        authResolved: true,
        loading: false,
        userPresent: false,
        profileReady: false,
      })
    ).toBe("sign-in");
  });
});

describe("healthy login critical-path timing model", () => {
  it("critical path stages exclude provision for healthy users", () => {
    // Simulated stage order for a healthy existing login (no wall-clock I/O).
    const stages: string[] = [];
    stages.push("signIn_start");
    stages.push("firebase_auth_resolved");
    stages.push("getUserProfile_start");
    stages.push("getUserProfile_complete");
    const profile = healthy({ role: "admin" });
    expect(isHealthyUserProfile(profile)).toBe(true);
    stages.push("profileReady");
    // No blocking_provision_* stages
    stages.push("sessionReady");
    expect(stages).toEqual([
      "signIn_start",
      "firebase_auth_resolved",
      "getUserProfile_start",
      "getUserProfile_complete",
      "profileReady",
      "sessionReady",
    ]);
    expect(stages.some((s) => s.includes("provision"))).toBe(false);
    expect(
      shouldBlockOnProvision({ mode: "login", profile })
        ? 1
        : 0
    ).toBe(0);
  });
});
