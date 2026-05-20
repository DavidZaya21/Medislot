/*
  Assumptions used for historical migration:

  - Existing `PENDING` appointments are converted to `CONFIRMED` to match the
    new automatic booking flow.
  - Legacy appointments without explicit slot duration are converted into
    30-minute calendar slots using `appointmentDate` as the slot start.
*/

-- Drop the legacy foreign key so doctor ids can be remapped from Doctor.id to User.id.
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_doctorId_fkey";

-- Add new user fields in a backfillable way.
ALTER TABLE "User"
  ADD COLUMN "specialization" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "User"
SET "updatedAt" = CURRENT_TIMESTAMP
WHERE "updatedAt" IS NULL;

-- Copy doctor specialization into the User table before Doctor is removed.
UPDATE "User" AS u
SET "specialization" = d."specialization"
FROM "Doctor" AS d
WHERE d."userId" = u."id";

ALTER TABLE "User"
  ALTER COLUMN "updatedAt" SET NOT NULL;

-- Remap appointments from Doctor.id to User.id.
UPDATE "Appointment" AS a
SET "doctorId" = d."userId"
FROM "Doctor" AS d
WHERE a."doctorId" = d."id";

-- Prepare the new appointment relation to Calendar.
ALTER TABLE "Appointment"
  ADD COLUMN "calendarId" INTEGER;

-- Convert old pending appointments into confirmed ones for the automatic-slot model.
UPDATE "Appointment"
SET "status" = 'CONFIRMED'
WHERE "status" = 'PENDING';

-- Create Calendar with a temporary legacy link so appointment rows can be backfilled safely.
CREATE TABLE "Calendar" (
    "id" SERIAL NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "isBooked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "legacyAppointmentId" INTEGER,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Calendar_legacyAppointmentId_key" ON "Calendar"("legacyAppointmentId");

INSERT INTO "Calendar" (
  "doctorId",
  "startTime",
  "endTime",
  "isBooked",
  "createdAt",
  "updatedAt",
  "legacyAppointmentId"
)
SELECT
  a."doctorId",
  a."appointmentDate",
  a."appointmentDate" + INTERVAL '30 minutes',
  CASE
    WHEN a."status" = 'CONFIRMED' THEN true
    ELSE false
  END,
  a."createdAt",
  a."updatedAt",
  a."id"
FROM "Appointment" AS a;

UPDATE "Appointment" AS a
SET "calendarId" = c."id"
FROM "Calendar" AS c
WHERE c."legacyAppointmentId" = a."id";

-- Replace the old status enum with the new analytics-oriented status model.
BEGIN;
CREATE TYPE "AppointmentStatus_new" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
ALTER TABLE "Appointment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Appointment" ALTER COLUMN "status" TYPE "AppointmentStatus_new" USING ("status"::text::"AppointmentStatus_new");
ALTER TYPE "AppointmentStatus" RENAME TO "AppointmentStatus_old";
ALTER TYPE "AppointmentStatus_new" RENAME TO "AppointmentStatus";
DROP TYPE "AppointmentStatus_old";
ALTER TABLE "Appointment" ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';
COMMIT;

-- Finalize appointment shape for the new schema.
ALTER TABLE "Appointment"
  DROP COLUMN "appointmentDate",
  ALTER COLUMN "calendarId" SET NOT NULL;

-- Recreate foreign keys against the new model.
ALTER TABLE "Calendar"
  ADD CONSTRAINT "Calendar_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Appointment_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Remove the temporary link and the legacy Doctor table after the backfill is complete.
DROP INDEX "Calendar_legacyAppointmentId_key";
ALTER TABLE "Calendar" DROP COLUMN "legacyAppointmentId";
DROP TABLE "Doctor";
