import { describe, expect, it } from "vitest";
import { formatUnknownError } from "@/lib/errors";

describe("formatUnknownError", () => {
  it("formats Error and Firebase-like code", () => {
    const err = new Error("Permission denied");
    (err as { code?: string }).code = "permission-denied";
    expect(formatUnknownError(err)).toBe("permission-denied: Permission denied");
  });

  it("formats browser Event instead of [object Event]", () => {
    const event = new Event("error");
    const message = formatUnknownError(event);
    expect(message).not.toBe("[object Event]");
    expect(message).toContain("error");
  });

  it("formats plain objects with message", () => {
    expect(formatUnknownError({ message: "boom", code: "x" })).toBe("x: boom");
  });
});
