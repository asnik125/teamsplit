import { describe, expect, it } from "vitest";
import {
  selectAuthenticatedMobileSurface,
  selectSessionSurface,
  shouldKeepAuthLoading,
  shouldRenderViewportContent,
  shouldShowSignInForm,
} from "@/lib/session-ready";

describe("unresolved auth does not render Sign In prematurely", () => {
  it("hides Sign In until authResolved and not loading", () => {
    expect(
      shouldShowSignInForm({
        authResolved: false,
        loading: true,
        userPresent: false,
      })
    ).toBe(false);
    expect(
      shouldShowSignInForm({
        authResolved: false,
        loading: false,
        userPresent: false,
      })
    ).toBe(false);
    expect(
      shouldShowSignInForm({
        authResolved: true,
        loading: true,
        userPresent: false,
      })
    ).toBe(false);
  });

  it("shows Sign In only when Firebase resolved to no user", () => {
    expect(
      shouldShowSignInForm({
        authResolved: true,
        loading: false,
        userPresent: false,
      })
    ).toBe(true);
  });

  it("keeps Sign In hidden while a login action is pending", () => {
    expect(
      shouldShowSignInForm({
        authResolved: true,
        loading: false,
        userPresent: false,
        authActionPending: true,
      })
    ).toBe(false);
  });
});

describe("unresolved viewport does not render desktop/mobile prematurely", () => {
  it("blocks content until viewportReady", () => {
    expect(shouldRenderViewportContent({ viewportReady: false })).toBe(false);
    expect(shouldRenderViewportContent({ viewportReady: true })).toBe(true);
  });
});

describe("unresolved role/profile does not briefly render the wrong role UI", () => {
  it("returns loading until profile is ready", () => {
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

  it("does not show Player while loading even if showAdminUI is false", () => {
    expect(
      selectAuthenticatedMobileSurface({
        authResolved: true,
        loading: true,
        profileReady: false,
        showAdminUI: false,
        hasMobileAdmin: true,
      })
    ).toBe("loading");
  });

  it("selects Admin vs Player only after profile readiness", () => {
    expect(
      selectAuthenticatedMobileSurface({
        authResolved: true,
        loading: false,
        profileReady: true,
        showAdminUI: true,
        hasMobileAdmin: true,
      })
    ).toBe("admin");
    expect(
      selectAuthenticatedMobileSurface({
        authResolved: true,
        loading: false,
        profileReady: true,
        showAdminUI: false,
        hasMobileAdmin: true,
      })
    ).toBe("player");
  });
});

describe("successful login and logout transitions", () => {
  it("login stays on one loading surface until app is ready", () => {
    expect(
      selectSessionSurface({
        authResolved: true,
        loading: true,
        userPresent: true,
        profileReady: false,
        authActionPending: true,
      })
    ).toBe("loading");
    expect(
      selectSessionSurface({
        authResolved: true,
        loading: false,
        userPresent: true,
        profileReady: true,
      })
    ).toBe("app");
  });

  it("logout goes loading then Sign In (never app)", () => {
    expect(
      selectSessionSurface({
        authResolved: true,
        loading: true,
        userPresent: false,
        profileReady: false,
      })
    ).toBe("loading");
    expect(
      selectSessionSurface({
        authResolved: true,
        loading: false,
        userPresent: false,
        profileReady: false,
      })
    ).toBe("sign-in");
  });

  it("keeps auth loading when profile uid does not match yet", () => {
    expect(
      shouldKeepAuthLoading({
        nextUid: "u1",
        currentProfileUid: null,
        profileFetchInFlight: false,
      })
    ).toBe(true);
    expect(
      shouldKeepAuthLoading({
        nextUid: "u1",
        currentProfileUid: "u1",
        profileFetchInFlight: false,
      })
    ).toBe(false);
    expect(
      shouldKeepAuthLoading({
        nextUid: "u1",
        currentProfileUid: "u1",
        profileFetchInFlight: true,
      })
    ).toBe(true);
  });
});
