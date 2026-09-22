/**
 * Convert unknown thrown values (FirebaseError, Event, etc.) into readable text.
 * Next.js often surfaces bare Events as the useless string "[object Event]".
 */
export function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    const message = err.message || err.name || "Error";
    return code ? `${code}: ${message}` : message;
  }

  if (typeof Event !== "undefined" && err instanceof Event) {
    if (typeof ErrorEvent !== "undefined" && err instanceof ErrorEvent && err.message) {
      return `browser ${err.type} event: ${err.message}`;
    }
    const target = err.target as
      | (EventTarget & { status?: number; url?: string; src?: string })
      | null;
    const parts = [`browser ${err.type} event`];
    if (target && typeof target === "object") {
      if (typeof target.status === "number") parts.push(`status=${target.status}`);
      if (typeof target.url === "string") parts.push(`url=${target.url}`);
      if (typeof target.src === "string") parts.push(`src=${target.src}`);
    }
    return parts.join(" · ");
  }

  if (typeof err === "string" && err.trim()) return err;

  if (err && typeof err === "object") {
    const anyErr = err as { code?: unknown; message?: unknown; reason?: unknown };
    const code = typeof anyErr.code === "string" ? anyErr.code : null;
    const message =
      typeof anyErr.message === "string"
        ? anyErr.message
        : typeof anyErr.reason === "string"
          ? anyErr.reason
          : null;
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
    try {
      return JSON.stringify(err);
    } catch {
      /* ignore */
    }
  }

  if (err == null) return "Unknown error";
  return Object.prototype.toString.call(err);
}
