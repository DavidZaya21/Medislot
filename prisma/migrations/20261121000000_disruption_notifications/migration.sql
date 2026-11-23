BEGIN;
-- CreateEnum
CREATE TYPE "EmailJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "recipientId" INTEGER,
    "appointmentId" INTEGER,
    "appointmentRef" INTEGER NOT NULL,
    "disruptionVersion" INTEGER NOT NULL,
    "calendarRef" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DOCTOR_UNAVAILABLE',
    "doctorName" TEXT NOT NULL,
    "slotStartTime" TIMESTAMP(3) NOT NULL,
    "slotEndTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "status" "EmailJobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "claimToken" TEXT,
    "sendingAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientId_createdAt_id_idx" ON "Notification"("recipientId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_appointmentRef_disruptionVersion_key" ON "Notification"("appointmentRef", "disruptionVersion");

-- CreateIndex
CREATE UNIQUE INDEX "EmailJob_notificationId_key" ON "EmailJob"("notificationId");

-- CreateIndex
CREATE INDEX "EmailJob_status_nextAttemptAt_id_idx" ON "EmailJob"("status", "nextAttemptAt", "id");

-- CreateIndex
CREATE INDEX "EmailJob_status_lockedUntil_idx" ON "EmailJob"("status", "lockedUntil");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;
