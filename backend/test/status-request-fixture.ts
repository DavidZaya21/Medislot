import type { PrismaClient } from "@prisma/client";
// Existing regression fixtures read their displayed identity before submitting.
// Dedicated lifecycle tests intentionally construct missing/stale identities themselves.
export async function statusRequestFixture(db: PrismaClient, method: string, path: string, body?: object) {
  if (method !== "PUT" || !/^\/appointments\/\d+$/.test(path) || !body) return body;
  const appointment = await db.appointment.findUnique({ where: { id: Number(path.split("/")[2]) } });
  if (!appointment) return body;
  const notice = appointment.status === "NEEDS_RESCHEDULING" ? await db.notification.findFirst({ where: {
    appointmentId: appointment.id, resolvedAt: null, disruptionVersion: appointment.version,
  } }) : null;
  return { currentCalendarId: appointment.calendarId, expectedVersion: appointment.version,
    ...(notice ? { notificationId: notice.id, disruptionVersion: notice.disruptionVersion } : {}), ...body };
}
