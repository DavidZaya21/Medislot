import type { AppointmentStatus, Role } from "@prisma/client";
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
