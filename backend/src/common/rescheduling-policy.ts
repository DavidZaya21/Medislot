import type { AppointmentStatus, Calendar, Role, Specialization, User } from "@prisma/client";
import { toConflict } from "./prisma-errors";

export function ensureMoveCutoff(status: AppointmentStatus, startTime: Date, role: Role, now: number) {
  if (status === "NEEDS_RESCHEDULING") return;
  if (status !== "CONFIRMED") throw toConflict("Only confirmed appointments or appointments needing rescheduling can be moved");
  const remaining = startTime.getTime() - now;
  if (role === "PATIENT" && remaining < 24 * 60 * 60 * 1000) {
    throw toConflict("Patient-requested moves require at least 24 hours before the currently confirmed start time");
  }
  if (remaining <= 0) throw toConflict("The currently confirmed appointment has already started");
}

// Shared by manual browsing, recommendations and the locked move transaction.
export type ReplacementContext = {
  doctorId: number;
  calendarId: number;
  calendar: { startTime: Date; endTime: Date };
  doctor: { specialization: Specialization | null };
};
export type ReplacementSlot = Calendar & {
  doctor: Pick<User, "role" | "specialization">;
};

export function replacementEligibilityError(current: ReplacementContext, slot: ReplacementSlot, now: number): string | null {
  if (slot.id === current.calendarId) return "Choose a different replacement slot";
  if (slot.doctor.role !== "DOCTOR" || slot.schedulePeriodId === null || slot.isBlocked || slot.isBooked || slot.startTime.getTime() <= now) {
    return "Replacement must be a future, published, unblocked and unbooked slot";
  }
  const duration = slot.endTime.getTime() - slot.startTime.getTime();
  if (duration <= 0 || duration !== current.calendar.endTime.getTime() - current.calendar.startTime.getTime()) {
    return "Replacement must have exactly the same duration";
  }
  if (slot.doctorId !== current.doctorId && (!current.doctor.specialization ||
      !slot.doctor.specialization || current.doctor.specialization !== slot.doctor.specialization)) {
    return "Another doctor must have a known, exactly matching specialization";
  }
  return null;
}

export function intervalsOverlap(a: { startTime: Date; endTime: Date }, b: { startTime: Date; endTime: Date }) {
  return a.startTime < b.endTime && a.endTime > b.startTime;
}
