import { Prisma } from "@prisma/client";
import { toNotFound } from "./prisma-errors";

export async function lockDoctor(tx: Prisma.TransactionClient, doctorId: number) {
  const doctors = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM "User" WHERE id = ${doctorId} AND role = 'DOCTOR' FOR UPDATE`);
  if (!doctors.length) throw toNotFound("Doctor");
}

export const activeReservationStatuses = ["CONFIRMED", "NEEDS_RESCHEDULING"] as const;

export async function releaseReservation(tx: Prisma.TransactionClient, calendarId: number) {
  const remaining = await tx.appointment.findFirst({
    where: { calendarId, status: { in: [...activeReservationStatuses] } }, select: { id: true },
  });
  if (!remaining) await tx.calendar.update({ where: { id: calendarId }, data: { isBooked: false } });
}

// All multi-doctor operations must acquire their complete doctor set first.
export async function lockDoctors(tx: Prisma.TransactionClient, doctorIds: number[]) {
  for (const id of [...new Set(doctorIds)].sort((a, b) => a - b)) await lockDoctor(tx, id);
}

export async function lockPatient(tx: Prisma.TransactionClient, patientId: number) {
  const patients = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM "User" WHERE id = ${patientId} AND role = 'PATIENT' FOR UPDATE`);
  if (!patients.length) throw toNotFound("Patient");
}

export async function hasPatientOverlap(
  tx: Prisma.TransactionClient, patientId: number, startTime: Date, endTime: Date, excludeAppointmentId?: number,
) {
  return Boolean(await tx.appointment.findFirst({
    where: {
      patientId, status: "CONFIRMED",
      ...(excludeAppointmentId === undefined ? {} : { id: { not: excludeAppointmentId } }),
      calendar: { is: { startTime: { lt: endTime }, endTime: { gt: startTime } } },
    }, select: { id: true },
  }));
}
