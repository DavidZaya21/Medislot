import "reflect-metadata";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { MailpitTransport } from "./mailpit-transport";
import { EmailWorker } from "./worker";
dotenv.config({ path: resolve(__dirname, "../../../.env"), quiet: true });
async function main() {
  if (process.env.MAIL_MODE !== "mailpit") throw new Error("Worker requires explicit MAIL_MODE=mailpit; no real delivery supported");
  if (!process.env.APP_BASE_URL) throw new Error("APP_BASE_URL is required");
  const transport = new MailpitTransport(process.env.SMTP_HOST ?? "127.0.0.1", Number(process.env.SMTP_PORT ?? 1025));
  const db = new PrismaService(); await db.$connect();
  const worker = new EmailWorker(db, transport, process.env.APP_BASE_URL);
  let stopped = false;
  process.once("SIGTERM", () => { stopped = true; }); process.once("SIGINT", () => { stopped = true; });
  try { while (!stopped) { try { if (await worker.runOnce()) continue; } catch { console.error("Email worker iteration failed; durable jobs retained"); }
    await new Promise(resolve => setTimeout(resolve, 1000)); } } finally { await db.$disconnect(); }
}
void main().catch(() => { console.error("Email worker configuration/startup failed; no fallback delivery"); process.exitCode = 1; });
