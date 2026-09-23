import { describe, expect, it } from "vitest";
import {
  roleBlocksGameNotifications,
  wantsEmailNotifications,
} from "@/lib/notifications/email-opt-in";

describe("email notification opt-in", () => {
  it("defaults ON when field is missing", () => {
    expect(wantsEmailNotifications({} as { emailNotifications: boolean })).toBe(
      true
    );
    expect(
      wantsEmailNotifications({
        emailNotifications: undefined as unknown as boolean,
      })
    ).toBe(true);
  });

  it("respects explicit opt-out", () => {
    expect(wantsEmailNotifications({ emailNotifications: false })).toBe(false);
    expect(wantsEmailNotifications({ emailNotifications: true })).toBe(true);
  });

  it("never blocks by Admin or Player role", () => {
    expect(roleBlocksGameNotifications("admin")).toBe(false);
    expect(roleBlocksGameNotifications("player")).toBe(false);
  });
});
