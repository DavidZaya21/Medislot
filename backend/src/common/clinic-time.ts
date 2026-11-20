import { toBadRequest } from "./prisma-errors";

const timeZone = "Europe/Warsaw";
const minute = 60_000;
const day = 24 * 60 * minute;
const warsawClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function localTime(instant: number) {
  const parts = Object.fromEntries(warsawClock.formatToParts(instant).map(({ type, value }) => [type, value]));
  return Date.parse(`${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
}

export function warsawInstant(date: string, time: string) {
  const wallTime = Date.parse(`${date}T${time}:00Z`);
  // Sample both sides of a possible Warsaw clock change, then round-trip
  // each candidate to detect both skipped and repeated local times.
  const offsets = new Set([-day, day].map((delta) => localTime(wallTime + delta) - (wallTime + delta)));
  const matches = [...offsets].map((offset) => wallTime - offset)
    .filter((candidate) => localTime(candidate) === wallTime);
  if (matches.length !== 1) {
    throw toBadRequest(`Daily boundary ${date} ${time} is ambiguous or does not exist in ${timeZone}`);
  }
  return matches[0];
}


export function warsawDate(instant: Date) {
  const parts = Object.fromEntries(warsawClock.formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Civil date arithmetic, not elapsed 24-hour increments across DST boundaries.
export function addClinicDays(date: string, days: number) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * day).toISOString().slice(0, 10);
}
