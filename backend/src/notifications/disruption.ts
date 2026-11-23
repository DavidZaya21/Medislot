import type { Prisma } from "@prisma/client";

export async function resolveNotices(tx: Prisma.TransactionClient, ids: number[], now = new Date()) {
  if (!ids.length) return;
  // Appointment mutations already hold doctor/patient locks. Notice locks always precede job locks.
  await tx.notification.updateMany({ where: { id: { in: ids }, resolvedAt: null }, data: { resolvedAt: now } });
  await tx.emailJob.updateMany({ where: { notificationId: { in: ids }, OR: [
    { status: "PENDING" }, { status: "PROCESSING", sendingAt: null },
  ] }, data: { status: "SKIPPED", claimToken: null, lockedUntil: null } });
}
export async function resolveDisruption(tx: Prisma.TransactionClient, appointmentId: number) {
  const notices = await tx.notification.findMany({ where: { appointmentId, resolvedAt: null }, select: { id: true }, orderBy: { id: "asc" } });
  await resolveNotices(tx, notices.map(n => n.id));
}
export async function detachAppointmentNotices(tx: Prisma.TransactionClient, where: Prisma.AppointmentWhereInput) {
  const appointments = await tx.appointment.findMany({ where, select: { id: true } });
  const notices = await tx.notification.findMany({ where: { appointmentId: { in: appointments.map(a => a.id) } }, select: { id: true }, orderBy: { id: "asc" } });
  const ids = notices.map(n => n.id);
  await resolveNotices(tx, ids);
  await tx.notification.updateMany({ where: { id: { in: ids } }, data: { appointmentId: null } });
}
export async function detachRecipientNotices(tx: Prisma.TransactionClient, recipientId: number) {
  const notices = await tx.notification.findMany({ where: { recipientId }, select: { id: true }, orderBy: { id: "asc" } });
  const ids = notices.map(n => n.id);
  await resolveNotices(tx, ids);
  await tx.notification.updateMany({ where: { id: { in: ids } }, data: { recipientId: null, appointmentId: null } });
}
