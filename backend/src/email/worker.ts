import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type EmailJob } from "@prisma/client";
import { EmailFailure, LEASE_MS, TOTAL_ATTEMPTS, retryDelay, type EmailTransport } from "./policy";

type Claim = EmailJob & { claimToken: string };
export class EmailWorker {
  readonly base: URL;
  constructor(private readonly db: PrismaClient, private readonly transport: EmailTransport, baseUrl: string,
    private readonly clock = () => new Date()) {
    this.base = new URL(baseUrl);
    if (!["http:", "https:"].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== "/") {
      throw new Error("APP_BASE_URL must be an explicit http(s) origin");
    }
  }
  async recoverExpired() {
    const now = this.clock();
    // Lock notice before job, just like resolution and completion. A stale recovery
    // snapshot must not put a resolved disruption back into PENDING.
    const expired = await this.db.emailJob.findMany({ where: { status: "PROCESSING", lockedUntil: { lte: now } },
      select: { id: true, notificationId: true }, orderBy: { id: "asc" }, take: 100 });
    for (const job of expired) await this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Notification" WHERE id = ${job.notificationId} FOR UPDATE`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "EmailJob" AS j SET
          status = CASE WHEN n."resolvedAt" IS NOT NULL OR n."recipientId" IS NULL OR n."appointmentId" IS NULL THEN 'SKIPPED'::"EmailJobStatus"
            WHEN j."attemptCount" >= ${TOTAL_ATTEMPTS} THEN 'FAILED'::"EmailJobStatus" ELSE 'PENDING'::"EmailJobStatus" END,
          "nextAttemptAt" = j."lockedUntil" + CASE WHEN j."attemptCount" = 1 THEN INTERVAL '1 minute' ELSE INTERVAL '5 minutes' END,
          "claimToken" = NULL, "lockedUntil" = NULL, "sendingAt" = NULL, "lastError" = 'LEASE_EXPIRED', "updatedAt" = ${now}
        FROM "Notification" n WHERE n.id = j."notificationId" AND j.id = ${job.id} AND j.status = 'PROCESSING' AND j."lockedUntil" <= ${now}`);
    });
  }

  async claim(): Promise<Claim | null> {
    const now = this.clock(), token = randomUUID(), until = new Date(now.getTime() + LEASE_MS);
    const jobs = await this.db.$queryRaw<Claim[]>(Prisma.sql`
      WITH candidate AS (
        SELECT id FROM "EmailJob" WHERE status = 'PENDING' AND "nextAttemptAt" <= ${now} AND "attemptCount" < ${TOTAL_ATTEMPTS}
        ORDER BY "nextAttemptAt", id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE "EmailJob" j SET status = 'PROCESSING', "attemptCount" = j."attemptCount" + 1,
        "claimToken" = ${token}, "lockedUntil" = ${until}, "sendingAt" = NULL, "updatedAt" = ${now}
      FROM candidate WHERE j.id = candidate.id RETURNING j.*`);
    return jobs[0] ?? null;
  }
  async prepare(job: Claim) {
    return this.db.$transaction(async tx => {
      // No job row lock is held while waiting for the notice; mutation paths use notice -> job order too.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Notification" WHERE id = ${job.notificationId} FOR UPDATE`);
      const notice = await tx.notification.findUnique({ where: { id: job.notificationId }, include: {
        recipient: { select: { id: true, role: true, email: true } },
        appointment: { select: { status: true, version: true, calendarId: true, patientId: true } },
      } });
      const now = this.clock();
      if (!notice || notice.resolvedAt || !notice.recipient || notice.recipient.role !== "PATIENT" ||
        !notice.appointment || notice.appointment.status !== "NEEDS_RESCHEDULING" ||
        notice.appointment.version !== notice.disruptionVersion || notice.appointment.calendarId !== notice.calendarRef ||
        notice.appointment.patientId !== notice.recipient.id) {
        await tx.emailJob.updateMany({ where: { id: job.id, status: "PROCESSING", claimToken: job.claimToken },
          data: { status: "SKIPPED", claimToken: null, lockedUntil: null } });
        return null;
      }
      const ready = await tx.emailJob.updateMany({ where: { id: job.id, status: "PROCESSING", claimToken: job.claimToken, lockedUntil: { gt: now } }, data: { sendingAt: now } });
      if (ready.count !== 1) return null;
      const link = new URL(`/appointments?reschedule=${notice.appointmentId}`, this.base).href;
      const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      return { to: notice.recipient.email, subject: "Your appointment needs rescheduling",
        text: `Your appointment with ${notice.doctorName} on ${date.format(notice.slotStartTime)} (Europe/Warsaw) needs rescheduling.\nSign in to review current details: ${link}\nNo appointment has been moved or cancelled automatically.`,
        messageId: `<medislot-notification-${notice.id}@example.test>` };
    });
  }
  async complete(job: Claim, outcome: { messageId: string } | { failure: string; permanent: boolean }) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Notification" WHERE id = ${job.notificationId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmailJob" WHERE id = ${job.id} FOR UPDATE`);
      const resolved = await tx.notification.findUnique({ where: { id: job.notificationId }, select: { resolvedAt: true, recipientId: true, appointmentId: true } });
      // Both locks may wait. Evaluate lease validity only after acquiring them.
      const now = this.clock();
      const skipped = !resolved || resolved.resolvedAt || resolved.recipientId === null || resolved.appointmentId === null;
      const data = "messageId" in outcome
        ? { status: "SENT" as const, sentAt: now, providerMessageId: outcome.messageId, lastError: null }
        : { status: skipped ? "SKIPPED" as const : outcome.permanent || job.attemptCount >= TOTAL_ATTEMPTS ? "FAILED" as const : "PENDING" as const,
          lastError: outcome.failure, nextAttemptAt: new Date(now.getTime() + retryDelay(job.attemptCount)) };
      return tx.emailJob.updateMany({ where: { id: job.id, status: "PROCESSING", claimToken: job.claimToken, lockedUntil: { gt: now } },
        data: { ...data, claimToken: null, lockedUntil: null } });
    });
  }
  renew(job: Claim) {
    const now = this.clock();
    return this.db.emailJob.updateMany({ where: { id: job.id, status: "PROCESSING", claimToken: job.claimToken, lockedUntil: { gt: now } },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS) } });
  }

  async runOnce() {
    await this.recoverExpired();
    const job = await this.claim(); if (!job) return false;
    const heartbeat = setInterval(() => {
      void this.renew(job).catch(() => {});
    }, LEASE_MS / 3);
    heartbeat.unref();
    try {
      const message = await this.prepare(job); if (!message) return true;
      try { await this.complete(job, await this.transport.send(message)); }
      catch (error) {
        const kind = error instanceof EmailFailure ? error.kind : "AMBIGUOUS";
        await this.complete(job, { failure: kind, permanent: kind === "PERMANENT_RECIPIENT" || kind === "CAPTURE_REJECTED" });
      }
      return true;
    } finally { clearInterval(heartbeat); }
  }
}
