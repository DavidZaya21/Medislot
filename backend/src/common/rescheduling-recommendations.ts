import { addClinicDays, warsawDate, warsawInstant } from "./clinic-time";

type TimedSlot = { id: number; doctorId: number; startTime: Date };

export function recommendationWindow(startTime: Date) {
  const startDate = warsawDate(startTime);
  const endDate = addClinicDays(startDate, 14);
  return {
    startDate, endDate, timeZone: "Europe/Warsaw" as const,
    start: new Date(warsawInstant(startDate, "00:00")),
    nextDay: new Date(warsawInstant(addClinicDays(startDate, 1), "00:00")),
    endExclusive: new Date(warsawInstant(addClinicDays(startDate, 15), "00:00")),
  };
}

export function rankAlternatives<T extends TimedSlot>(slots: T[], doctorId: number, startTime: Date) {
  const window = recommendationWindow(startTime);
  const tie = (a: T, b: T) => a.startTime.getTime() - b.startTime.getTime() || a.doctorId - b.doctorId || a.id - b.id;
  return {
    keepYourDay: slots.filter((slot) => slot.doctorId !== doctorId && slot.startTime >= window.start && slot.startTime < window.nextDay)
      .sort((a, b) => Math.abs(a.startTime.getTime() - startTime.getTime()) - Math.abs(b.startTime.getTime() - startTime.getTime()) || tie(a, b)).slice(0, 3),
    keepYourDoctor: slots.filter((slot) => slot.doctorId === doctorId && slot.startTime >= window.nextDay && slot.startTime < window.endExclusive)
      .sort(tie).slice(0, 3),
  };
}
