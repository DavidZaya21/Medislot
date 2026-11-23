import { addClinicDays, warsawDate, warsawInstant } from "../common/clinic-time";
const hour = 3_600_000;
export function followUpDeadline(start: Date, recordedAt: Date) {
  const remaining = +start - +recordedAt;
  return new Date(+recordedAt + (remaining > 48 * hour ? 24 * hour : remaining >= 24 * hour ? 4 * hour : 0));
}
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", hourCycle: "h23" });
export function contactAllowed(at: Date) { const h = Number(clock.format(at)); return h >= 8 && h < 20; }
export function nextContactTime(at: Date) {
  const h = Number(clock.format(at)), day = warsawDate(at);
  return contactAllowed(at) ? at : new Date(warsawInstant(h >= 20 ? addClinicDays(day, 1) : day, "08:00"));
}
