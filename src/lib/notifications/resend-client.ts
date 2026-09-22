import { Resend } from "resend";
import type { EmailContent } from "./templates";

export function getEmailFrom(): string {
  return (
    process.env.EMAIL_FROM?.trim() ||
    "TeamSplit <notifications@teamsplit.vanaku.com>"
  );
}

export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://localhost:3000"
  );
}

export function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key);
}

export async function sendResendEmail(input: {
  to: string;
  content: EmailContent;
}): Promise<{ id: string }> {
  const client = getResendClient();
  if (!client) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const from = getEmailFrom();
  const result = await client.emails.send({
    from,
    to: input.to,
    subject: input.content.subject,
    text: input.content.text,
    html: input.content.html,
  });
  if (result.error) {
    throw new Error(result.error.message || "Resend send failed");
  }
  const id = result.data?.id;
  if (!id) {
    throw new Error("Resend did not return a message id");
  }
  return { id };
}

/** Strip secrets from error messages shown to Admins. */
export function sanitizeEmailError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/re_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240);
}
