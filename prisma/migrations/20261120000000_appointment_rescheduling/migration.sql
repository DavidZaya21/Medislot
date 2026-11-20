BEGIN;
ALTER TABLE "Appointment" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE TYPE "RescheduleReason" AS ENUM ('DOCTOR_UNAVAILABLE', 'PATIENT_REQUESTED');
CREATE TABLE "AppointmentRescheduleHistory" (
  "id" SERIAL PRIMARY KEY,
  "appointmentId" INTEGER NOT NULL REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "appointmentVersion" INTEGER NOT NULL,
  "previousDoctorId" INTEGER NOT NULL,
  "newDoctorId" INTEGER NOT NULL,
  "previousCalendarId" INTEGER NOT NULL,
  "newCalendarId" INTEGER NOT NULL,
  "previousStartTime" TIMESTAMP(3) NOT NULL,
  "previousEndTime" TIMESTAMP(3) NOT NULL,
  "newStartTime" TIMESTAMP(3) NOT NULL,
  "newEndTime" TIMESTAMP(3) NOT NULL,
  "reason" "RescheduleReason" NOT NULL,
  "actorId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AppointmentRescheduleHistory_appointment_version_key" ON "AppointmentRescheduleHistory"("appointmentId", "appointmentVersion");
CREATE INDEX "AppointmentRescheduleHistory_actorId_idx" ON "AppointmentRescheduleHistory"("actorId");
COMMIT;
