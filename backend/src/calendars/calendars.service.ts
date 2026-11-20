import { Prisma } from "@prisma/client";
import { Inject, Injectable } from "@nestjs/common";

import { toBadRequest, toConflict, toNotFound } from "../common/prisma-errors";
import { lockDoctor } from "../common/doctor-lock";
import { warsawInstant } from "../common/clinic-time";
import { serializeCalendar } from "../common/serializers";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CalendarsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listCalendarSlots(query: { doctorId?: number; date?: string; isBooked?: boolean }) {
    const where: Record<string, unknown> = {};

    if (query.doctorId) where.doctorId = query.doctorId;
    if (query.isBooked !== undefined) where.isBooked = query.isBooked;
    if (query.isBooked === false) where.isBlocked = false;
    if (query.date) {
      const nextDate = new Date(Date.parse(query.date + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
      const start = new Date(warsawInstant(query.date, "00:00"));
      const end = new Date(warsawInstant(nextDate, "00:00"));
      where.startTime = { gte: start, lt: end };
    }

    const slots = await this.prisma.calendar.findMany({
      where,
      include: { doctor: true },
      orderBy: { startTime: "asc" },
    });

    return { data: slots.map(serializeCalendar) };
  }

  async block(input: { doctorId: number; startTime: string; endTime: string }) {
    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    this.ensureTimeOrder(startTime, endTime);
    return this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, input.doctorId);
      const where = { doctorId: input.doctorId, schedulePeriodId: { not: null },
        startTime: { lt: endTime }, endTime: { gt: startTime } };
      const blocked = await tx.calendar.updateMany({ where: { ...where, isBlocked: false }, data: { isBlocked: true } });
      const affected = await tx.appointment.updateMany({
        where: { status: "CONFIRMED", calendar: { is: where } },
        data: { status: "NEEDS_RESCHEDULING", version: { increment: 1 } },
      });
      return { blockedSlots: blocked.count, appointmentsNeedingRescheduling: affected.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  }

  async createCalendarSlot(input: { doctorId: number; startTime: string; endTime: string }) {
    await this.ensureDoctor(input.doctorId);

    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    this.ensureTimeOrder(startTime, endTime);
    this.ensureFutureStart(startTime);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${input.doctorId} FOR UPDATE`);
      const conflict = await tx.calendar.findFirst({
        where: {
          doctorId: input.doctorId,
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });

      if (conflict) {
        throw toConflict("Calendar slot overlaps with an existing slot for this doctor");
      }

      const calendar = await tx.calendar.create({
        data: {
          doctorId: input.doctorId,
          startTime,
          endTime,
        },
        include: { doctor: true },
      });

      return serializeCalendar(calendar);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async getCalendarSlotById(calendarId: number) {
    const slot = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      include: { doctor: true },
    });
    if (!slot) throw toNotFound("Calendar slot");
    return serializeCalendar(slot);
  }

  async updateCalendarSlotById(
    calendarId: number,
    input: { startTime: string; endTime: string; isBooked: boolean },
  ) {
    const slot = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      include: { appointments: true },
    });
    if (!slot) throw toNotFound("Calendar slot");

    if (slot.appointments.length > 0) {
      throw toConflict("Calendar slot cannot be updated after it has been used by appointments");
    }

    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    this.ensureTimeOrder(startTime, endTime);
    this.ensureFutureStart(startTime);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${slot.doctorId} FOR UPDATE`);
      const refreshed = await tx.calendar.findUnique({
        where: { id: calendarId }, include: { appointments: true },
      });
      if (!refreshed) throw toNotFound("Calendar slot");
      if (refreshed.appointments.length) {
        throw toConflict("Calendar slot cannot be updated after it has been used by appointments");
      }
      if (refreshed.schedulePeriodId !== null && refreshed.schedulePeriodId !== undefined &&
          (refreshed.startTime.getTime() !== startTime.getTime() || refreshed.endTime.getTime() !== endTime.getTime())) {
        throw toConflict("Published slot times cannot be changed");
      }
      const overlap = await tx.calendar.findFirst({
        where: { doctorId: slot.doctorId, id: { not: calendarId },
          startTime: { lt: endTime }, endTime: { gt: startTime } },
      });
      if (overlap) throw toConflict("Calendar slot overlaps with an existing slot for this doctor");
      const updated = await tx.calendar.update({
        where: { id: calendarId },
        data: {
          startTime,
          endTime,
          isBooked: input.isBooked,
        },
        include: { doctor: true },
      });

      return serializeCalendar(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async deleteCalendarSlotById(calendarId: number) {
    const slot = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      include: { appointments: true },
    });
    if (!slot) throw toNotFound("Calendar slot");

    if (slot.isBooked || slot.appointments.length > 0) {
      throw toConflict("Calendar slot cannot be deleted after it has been used or booked");
    }

    await this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, slot.doctorId);
      const current = await tx.calendar.findUnique({ where: { id: calendarId }, include: { appointments: true } });
      if (!current) throw toNotFound("Calendar slot");
      if (current.isBooked || current.isBlocked || current.appointments.length) {
        throw toConflict("Calendar slot cannot be deleted after it has been used, booked or blocked");
      }
      await tx.calendar.delete({ where: { id: calendarId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async ensureDoctor(doctorId: number) {
    const doctor = await this.prisma.user.findFirst({
      where: { id: doctorId, role: "DOCTOR" },
      select: { id: true },
    });
    if (!doctor) throw toNotFound("Doctor");
  }

  private ensureTimeOrder(startTime: Date, endTime: Date) {
    if (Number.isNaN(startTime.valueOf()) || Number.isNaN(endTime.valueOf()) || endTime <= startTime) {
      throw toBadRequest("endTime must be later than startTime");
    }
  }

  private ensureFutureStart(startTime: Date) {
    if (startTime <= new Date()) {
      throw toConflict("Calendar slot must start in the future");
    }
  }
}
