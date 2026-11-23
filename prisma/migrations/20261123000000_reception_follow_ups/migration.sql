BEGIN;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "Notification" ADD COLUMN "followUpDeadlineAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "legacyFollowUpEscalatedAt" TIMESTAMP(3);
ALTER TABLE "EmailJob" ADD COLUMN "failedAt" TIMESTAMP(3);
-- Approved conservative migration policy, NOT an inferred disruption timestamp/deadline.
-- Historical createdAt may precede the blocking lock. Preserve it; leave scheduled
-- deadlines unknown, and flag unresolved legacy cases at this migration's wall time.
UPDATE "Notification" SET "legacyFollowUpEscalatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
 WHERE "resolvedAt" IS NULL;
-- Existing terminal jobs already record their failure transition in updatedAt.
UPDATE "EmailJob" SET "failedAt" = "updatedAt" WHERE status = 'FAILED';
CREATE TYPE "ContactOutcome" AS ENUM ('REACHED_PATIENT','NO_ANSWER','BUSY','VOICEMAIL_LEFT','WRONG_NUMBER');
CREATE TABLE "ContactAttempt" (
 "id" SERIAL PRIMARY KEY,
 "notificationId" INTEGER NOT NULL REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "actorRef" INTEGER NOT NULL,
 "appointmentVersion" INTEGER NOT NULL,
 "currentCalendarId" INTEGER NOT NULL,
 "outcome" "ContactOutcome" NOT NULL,
 "note" VARCHAR(500),
 "idempotencyKey" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ContactAttempt_notificationId_idempotencyKey_key" ON "ContactAttempt"("notificationId","idempotencyKey");
CREATE INDEX "ContactAttempt_notificationId_createdAt_id_idx" ON "ContactAttempt"("notificationId","createdAt","id");
CREATE INDEX "Notification_followUpDeadlineAt_id_idx" ON "Notification"("followUpDeadlineAt","id");
COMMIT;
