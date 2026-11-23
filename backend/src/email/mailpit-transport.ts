import nodemailer from "nodemailer";
import { EmailFailure, SMTP_TIMEOUT_MS, type EmailMessage, type EmailTransport } from "./policy";

// Capture is the only supported transport in this milestone. No credentials or real-provider fallback.
export class MailpitTransport implements EmailTransport {
  private readonly smtp;
  constructor(host: string, port: number) {
    if (!["127.0.0.1", "localhost", "::1", "mailpit"].includes(host) || port !== 1025) {
      throw new Error("Capture SMTP must use local Mailpit on port 1025");
    }
    this.smtp = nodemailer.createTransport({ host, port, secure: false, ignoreTLS: true,
      connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: SMTP_TIMEOUT_MS,
      disableFileAccess: true, disableUrlAccess: true });
  }
  async send(message: EmailMessage) {
    if (!/^[^@\s]+@example\.(test|invalid)$/i.test(message.to)) throw new EmailFailure("CAPTURE_REJECTED");
    try {
      const sent = await this.smtp.sendMail({ ...message, from: "Medislot <clinic@example.test>" });
      return { messageId: String(sent.messageId) };
    } catch (caught) {
      const error = caught as { command?: string; responseCode?: number; code?: string };
      if (error.command === "RCPT TO" && (error.responseCode ?? 0) >= 500) throw new EmailFailure("PERMANENT_RECIPIENT");
      throw new EmailFailure(error.code === "ETIMEDOUT" || error.code === "ESOCKET" ? "AMBIGUOUS" : "TEMPORARY");
    }
  }
}
