import type { Appointment, Calendar, User } from "@prisma/client";

// Deliberate allowlist: private phone is never included in generic/nested users.
export function serializeUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    specialization: user.specialization, createdAt: user.createdAt, updatedAt: user.updatedAt };
}
export function serializeOwnUser(user: User) {
  return { ...serializeUser(user), ...(user.role === "PATIENT" ? { phone: user.phone ?? null } : {}) };
}

export function serializeDoctor(user: User) {
  return {
    id: user.id,
    userId: user.id,
    specialization: user.specialization ?? null,
    user: serializeUser(user),
  };
}

export function serializeCalendar(
  calendar: Calendar & { doctor?: User | null },
) {
  return {
    id: calendar.id,
    doctorId: calendar.doctorId,
    startTime: calendar.startTime,
    endTime: calendar.endTime,
    isBooked: calendar.isBooked,
    isBlocked: calendar.isBlocked,
    createdAt: calendar.createdAt,
    updatedAt: calendar.updatedAt,
    ...(calendar.doctor ? { doctor: serializeDoctor(calendar.doctor) } : {}),
  };
}

export function serializeAppointment(
  appointment: Appointment & {
    patient: User;
    doctor: User;
    calendar: Calendar;
    _count?: { rescheduleHistory: number };
  },
) {
  return {
    id: appointment.id,
    patientId: appointment.patientId,
    doctorId: appointment.doctorId,
    calendarId: appointment.calendarId,
    status: appointment.status,
    version: appointment.version,
    ...(appointment._count ? { rescheduleCount: appointment._count.rescheduleHistory } : {}),
    reason: appointment.reason,
    slotStartTime: appointment.calendar.startTime,
    slotEndTime: appointment.calendar.endTime,
    patient: serializeUser(appointment.patient),
    doctor: serializeDoctor(appointment.doctor),
  };
}
