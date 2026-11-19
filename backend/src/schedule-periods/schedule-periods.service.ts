import { Inject, Injectable } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";

import { toBadRequest, toConflict, toNotFound } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../auth/auth.types";
import type { PublishSchedulePeriodDto, SchedulePreviewDto } from "./schedule-periods.dto";

import { warsawInstant } from "../common/clinic-time";

const timeZone = "Europe/Warsaw";
const minute = 60_000;
const day = 24 * 60 * minute;
const maxDays = 366;
const maxSlots = 10_000;

@Injectable()
export class SchedulePeriodsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async publish(input: PublishSchedulePeriodDto, user: AuthUser) {
    const preview = await this.preview(input);
    const removed = new Set(input.removedSlotIds);
    if (input.removedSlotIds.some((id) => id >= preview.slots.length)) {
      throw toBadRequest("removedSlotIds must identify slots in the generated preview");
    }
    const retained = preview.slots.filter((_, index) => !removed.has(index));
    if (!retained.length) throw toBadRequest("Publication must retain at least one slot");

    return this.prisma.$transaction(async (tx) => {
      // Manual calendar writers use the same per-doctor lock. READ COMMITTED
      // ensures checks after waiting see the previous writer's committed data.
      const doctors = await tx.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${input.doctorId}
        AND "role" = 'DOCTOR' FOR UPDATE`);
      if (!doctors.length) throw toNotFound("Doctor");
      if (retained.some((slot) => new Date(slot.startTime).getTime() <= Date.now())) {
        throw toBadRequest("Cannot publish slots whose start time is already past");
      }
      const startDate = new Date(input.startDate + "T00:00:00Z");
      const endDate = new Date(input.endDate + "T00:00:00Z");
      const overlap = await tx.schedulePeriod.findFirst({
        where: { doctorId: input.doctorId, startDate: { lte: endDate }, endDate: { gte: startDate } },
        select: { id: true },
      });
      if (overlap) throw toConflict("Schedule period overlaps an existing period for this doctor");
      const existing = await tx.calendar.findMany({
        where: {
          doctorId: input.doctorId,
          startTime: { lt: new Date(retained[retained.length - 1].endTime) },
          endTime: { gt: new Date(retained[0].startTime) },
        },
        select: { startTime: true, endTime: true },
      });
      if (retained.some((slot) => existing.some((other) =>
        other.startTime < new Date(slot.endTime) && other.endTime > new Date(slot.startTime)))) {
        throw toConflict("Published slots overlap existing calendar slots for this doctor");
      }
      const period = await tx.schedulePeriod.create({
        data: {
          doctorId: input.doctorId, startDate, endDate,
          workingWeekdays: input.workingWeekdays,
          dailyStartTime: input.dailyStartTime, dailyEndTime: input.dailyEndTime,
          slotDurationMinutes: input.slotDurationMinutes,
          excludedDates: input.excludedDates, removedSlotIds: input.removedSlotIds,
          publishedById: user.userId,
        },
      });
      await tx.calendar.createMany({
        data: retained.map((slot) => ({
          doctorId: input.doctorId, schedulePeriodId: period.id,
          startTime: new Date(slot.startTime), endTime: new Date(slot.endTime),
        })),
      });
      return { ...period, timeZone, slotCount: retained.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  }

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
