export const TOTAL_ATTEMPTS = 3;
export const LEASE_MS = 60_000;
export const SMTP_TIMEOUT_MS = 10_000;
export function retryDelay(attempt: number) { return attempt === 1 ? 60_000 : 300_000; }
export type FailureKind = "TEMPORARY" | "AMBIGUOUS" | "PERMANENT_RECIPIENT" | "CAPTURE_REJECTED";
export class EmailFailure extends Error {
  constructor(readonly kind: FailureKind) { super(kind); }
}
export type EmailMessage = { to: string; subject: string; text: string; messageId: string };
export interface EmailTransport { send(message: EmailMessage): Promise<{ messageId: string }> }
