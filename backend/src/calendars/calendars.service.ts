import { Inject, Injectable } from "@nestjs/common";

import { toBadRequest, toConflict, toNotFound } from "../common/prisma-errors";
import { serializeCalendar } from "../common/serializers";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CalendarsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listCalendarSlots(query: { doctorId?: number; date?: string; isBooked?: boolean }) {
    const where: Record<string, unknown> = {};

    if (query.doctorId) where.doctorId = query.doctorId;
    if (query.isBooked !== undefined) where.isBooked = query.isBooked;
    if (query.date) {
      const start = new Date(`${query.date}T00:00:00.000Z`);
      const end = new Date(`${query.date}T23:59:59.999Z`);
      where.startTime = { gte: start, lte: end };
    }

    const slots = await this.prisma.calendar.findMany({
      where,
      include: { doctor: true },
      orderBy: { startTime: "asc" },
    });

    return { data: slots.map(serializeCalendar) };
  }

  async createCalendarSlot(input: { doctorId: number; startTime: string; endTime: string }) {
    await this.ensureDoctor(input.doctorId);

    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    this.ensureTimeOrder(startTime, endTime);

    const conflict = await this.prisma.calendar.findFirst({
      where: {
        doctorId: input.doctorId,
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });

    if (conflict) {
      throw toConflict("Calendar slot overlaps with an existing slot for this doctor");
    }

    const calendar = await this.prisma.calendar.create({
      data: {
        doctorId: input.doctorId,
        startTime,
        endTime,
      },
      include: { doctor: true },
    });

    return serializeCalendar(calendar);
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

    const updated = await this.prisma.calendar.update({
      where: { id: calendarId },
      data: {
        startTime,
        endTime,
        isBooked: input.isBooked,
      },
      include: { doctor: true },
    });

    return serializeCalendar(updated);
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

    await this.prisma.calendar.delete({ where: { id: calendarId } });
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
}
