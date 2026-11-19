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
