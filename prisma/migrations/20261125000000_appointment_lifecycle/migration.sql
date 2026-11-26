-- Add an empty audit table. Preserve existing records; do not infer historical events.
CREATE TABLE "AppointmentStatusTransition" (
 "id" SERIAL NOT NULL,
 "appointmentId" INTEGER NOT NULL,
 "appointmentVersion" INTEGER NOT NULL,
 "fromStatus" "AppointmentStatus" NOT NULL,
 "toStatus" "AppointmentStatus" NOT NULL,
 "actorId" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AppointmentStatusTransition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppointmentStatusTransition_appointment_version_key" ON "AppointmentStatusTransition"("appointmentId", "appointmentVersion");
CREATE INDEX "AppointmentStatusTransition_actorId_idx" ON "AppointmentStatusTransition"("actorId");
ALTER TABLE "AppointmentStatusTransition" ADD CONSTRAINT "AppointmentStatusTransition_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentStatusTransition" ADD CONSTRAINT "AppointmentStatusTransition_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
