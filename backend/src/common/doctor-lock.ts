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
