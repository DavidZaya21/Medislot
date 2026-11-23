import type { Appointment, Prisma } from "@prisma/client";
import { toConflict } from "../common/prisma-errors";
export type CaseIdentity = { notificationId: number; disruptionVersion: number; currentCalendarId: number; expectedVersion: number };
export async function assertCurrentCase(tx: Prisma.TransactionClient, appointment: Appointment, input: CaseIdentity) {
  await tx.$queryRaw`SELECT id FROM "Notification" WHERE id = ${input.notificationId} FOR UPDATE`;
  const notice = await tx.notification.findUnique({ where: { id: input.notificationId } });
  if (!notice || notice.type !== "DOCTOR_UNAVAILABLE" || notice.resolvedAt || notice.appointmentId !== appointment.id ||
    notice.recipientId !== appointment.patientId || appointment.status !== "NEEDS_RESCHEDULING" ||
    appointment.calendarId !== input.currentCalendarId || appointment.version !== input.expectedVersion ||
    notice.disruptionVersion !== input.disruptionVersion || notice.disruptionVersion !== appointment.version || notice.calendarRef !== appointment.calendarId) {
    throw toConflict("Disruption changed. Reload the case before trying again");
  }
  return notice;
}
