/**
 * Dev-only auth stage timings. Never logs secrets (no passwords/tokens).
 * Relative to the timing instance start (T+0).
 */

export type AuthTimingMarks = Record<string, number>;

export function createAuthTiming(flow: string): {
  mark: (stage: string, extra?: Record<string, string | number | boolean>) => void;
  marks: AuthTimingMarks;
} {
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const marks: AuthTimingMarks = { start: 0 };

  function elapsed(): number {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    return Math.round(now - t0);
  }

  return {
    marks,
    mark(stage, extra) {
      const ms = elapsed();
      marks[stage] = ms;
      if (process.env.NODE_ENV === "development") {
        const suffix = extra
          ? " " +
            Object.entries(extra)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(" ")
          : "";
        console.info(`[auth-timing] ${flow} ${stage} T+${ms}ms${suffix}`);
      }
    },
  };
}
