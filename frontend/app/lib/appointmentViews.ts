import type { Appointment } from "./types";

export type AppointmentView = "All" | "Upcoming" | "Needs rescheduling" | "Past" | "Cancelled";

// Display categories only. Never infer or write a clinical status from the clock.
export function appointmentView(appointment: Appointment, now = Date.now()): AppointmentView {
  if (appointment.status === "NEEDS_RESCHEDULING") return "Needs rescheduling";
  if (appointment.status === "CANCELLED") return "Cancelled";
  if (appointment.slotEndTime && Date.parse(appointment.slotEndTime) <= now) return "Past";
  if (appointment.status === "CONFIRMED") return "Upcoming";
  return "All";
}
