import type { Appointment, Calendar, User } from "@prisma/client";

type UserWithoutPassword = Omit<User, "password">;

export function serializeUser(user: User): UserWithoutPassword {
  const { password: _password, ...rest } = user;
  return rest;
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
  },
) {
  return {
    id: appointment.id,
    patientId: appointment.patientId,
    doctorId: appointment.doctorId,
    calendarId: appointment.calendarId,
    status: appointment.status,
    reason: appointment.reason,
    slotStartTime: appointment.calendar.startTime,
    slotEndTime: appointment.calendar.endTime,
    patient: serializeUser(appointment.patient),
    doctor: serializeDoctor(appointment.doctor),
  };
}
