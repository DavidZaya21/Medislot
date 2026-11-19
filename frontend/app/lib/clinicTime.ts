export const CLINIC_TIME_ZONE = "Europe/Warsaw";
export const CLINIC_TIME_NOTICE = "Appointment times are shown in the clinic’s local time (Europe/Warsaw), which differs from your device’s timezone.";

export function clinicDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function clinicTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function clinicDateTime(value: string) {
  return `${clinicDate(value)} ${clinicTime(value)}`;
}

// datetime-local contains a civil time, not a device-local instant. Resolve it
// against Warsaw's offsets and reject skipped/repeated DST boundary times.
export function clinicLocalToISO(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Enter a valid clinic date and time.");
  }
  const wall = Date.parse(value + ":00Z");
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) {
    throw new Error("Enter a valid clinic date and time.");
  }
  const offsets = new Set([-86_400_000, 86_400_000].map((delta) => {
    const sample = wall + delta;
    return Date.parse(clinicDateTime(new Date(sample).toISOString()).replace(" ", "T") + ":00Z") - sample;
  }));
  const matches = [...offsets].map((offset) => wall - offset).filter((candidate) =>
    clinicDateTime(new Date(candidate).toISOString()).replace(" ", "T") === value);
  if (matches.length !== 1) {
    throw new Error("This time is ambiguous or does not exist in Europe/Warsaw because of a clock change. Choose another time.");
  }
  return new Date(matches[0]).toISOString();
}
