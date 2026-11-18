import { Inject, Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";

import { toBadRequest, toNotFound } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";
import type { SchedulePreviewDto } from "./schedule-periods.dto";

const timeZone = "Europe/Warsaw";
const minute = 60_000;
const day = 24 * 60 * minute;
const maxDays = 366;
const maxSlots = 10_000;
const warsawClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function localTime(instant: number) {
  const parts = Object.fromEntries(warsawClock.formatToParts(instant).map(({ type, value }) => [type, value]));
  return Date.parse(`${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
}

function warsawInstant(date: string, time: string) {
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

@Injectable()
export class SchedulePeriodsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async preview(input: SchedulePreviewDto) {
    const first = Date.parse(`${input.startDate}T00:00:00Z`);
    const last = Date.parse(`${input.endDate}T00:00:00Z`);
    if (last < first) throw toBadRequest("endDate must be on or after startDate");
    if (last - first >= maxDays * day) throw toBadRequest(`Preview cannot exceed ${maxDays} days`);
    if (input.dailyEndTime <= input.dailyStartTime) {
      throw toBadRequest("dailyEndTime must be later than dailyStartTime");
    }

    const doctor = await this.prisma.user.findFirst({
      where: { id: input.doctorId, role: Role.DOCTOR },
      select: { id: true },
    });
    if (!doctor) throw toNotFound("Doctor");

    const weekdays = new Set(input.workingWeekdays);
    const excluded = new Set(input.excludedDates);
    const duration = input.slotDurationMinutes * minute;
    const slots: { startTime: string; endTime: string }[] = [];

    // UTC is used only to iterate civil date labels and compute their weekday.
    for (let date = first; date <= last; date += day) {
      const label = new Date(date).toISOString().slice(0, 10);
      const weekday = new Date(date).getUTCDay() || 7;
      if (!weekdays.has(weekday) || excluded.has(label)) continue;

      const start = warsawInstant(label, input.dailyStartTime);
      const end = warsawInstant(label, input.dailyEndTime);
      for (let slot = start; slot + duration <= end; slot += duration) {
        if (slots.length === maxSlots) throw toBadRequest(`Preview cannot exceed ${maxSlots} slots`);
        slots.push({
          startTime: new Date(slot).toISOString(),
          endTime: new Date(slot + duration).toISOString(),
        });
      }
    }

    return { doctorId: doctor.id, timeZone, slots };
  }
}
