import { AppointmentLifecycle } from "../common/appointment-lifecycle";
import { Prisma, Role } from "@prisma/client";
import { Inject, Injectable } from "@nestjs/common";

import { toBadRequest, toConflict, toNotFound, toForbidden } from "../common/prisma-errors";
import { followUpDeadline } from "../follow-ups/follow-up-policy";
import { lockDoctor } from "../common/doctor-lock";
import { addClinicDays, warsawInstant } from "../common/clinic-time";
import { serializeCalendar, serializeManagerCalendar } from "../common/serializers";
import type { AuthUser } from "../auth/auth.types";
import { recommendationWindow, rankBookingAlternatives } from "../common/rescheduling-recommendations";
import { replacementEligibilityError, intervalsOverlap } from "../common/rescheduling-policy";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CalendarsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppointmentLifecycle) private readonly lifecycle: AppointmentLifecycle = new AppointmentLifecycle()) {}

  async listCalendarSlots(query: { doctorId?: number; date?: string; isBooked?: boolean }, user: AuthUser) {
    const where: Prisma.CalendarWhereInput = {};
    const patient = user.role === Role.PATIENT;
    const startTime: Prisma.DateTimeFilter = patient ? { gt: new Date() } : {};
    if (query.doctorId) where.doctorId = query.doctorId;
    if (patient) {
      // Patient visibility is mandatory, independent of caller-supplied status/filter flags.
      where.isBooked = false;
      where.isBlocked = false;
      where.schedulePeriodId = { not: null };
    } else {
      if (query.isBooked !== undefined) where.isBooked = query.isBooked;
      if (query.isBooked === false) where.isBlocked = false;
    }
    if (query.date) {
      try {
        startTime.gte = new Date(warsawInstant(query.date, "00:00"));
        startTime.lt = new Date(warsawInstant(addClinicDays(query.date, 1), "00:00"));
      } catch (error) {
        if (error instanceof RangeError) throw toBadRequest("date is outside the supported clinic-date range");
        throw error;
      }
    }
    if (patient || query.date) where.startTime = startTime;
    const slots = await this.prisma.calendar.findMany({ where, include: { doctor: true }, orderBy: { startTime: "asc" } });
    return { data: slots.map(slot => user.role === Role.MANAGER ? serializeManagerCalendar(slot) : serializeCalendar(slot)) };
  }

  async alternatives(calendarId: number, suppliedPatientId: number | undefined, user: AuthUser) {
    if (user.role !== Role.PATIENT && user.role !== Role.RECEPTIONIST && user.role !== Role.ADMIN) throw toForbidden();
    const patientId = user.role === Role.PATIENT ? user.userId : suppliedPatientId;
    if (patientId === undefined) throw toBadRequest("patientId is required when booking for a patient");
    const patient = await this.prisma.user.findUnique({ where: { id: patientId }, select: { role: true } });
    if (!patient || patient.role !== Role.PATIENT) throw toNotFound("Patient");
    const original = await this.prisma.calendar.findUnique({ where: { id: calendarId }, include: { doctor: true } });
    if (!original) throw toNotFound("Calendar slot");
    const bounds = recommendationWindow(original.startTime);
    const now = Date.now();
    const context = { calendarId: original.id, doctorId: original.doctorId, calendar: original, doctor: original.doctor };
    const [slots, conflicts] = now >= bounds.endExclusive.getTime() ? [[], []] : await Promise.all([
      this.prisma.calendar.findMany({
        where: { id: { not: calendarId }, doctorId: original.doctorId, doctor: { role: Role.DOCTOR },
          schedulePeriodId: { not: null }, isBooked: false, isBlocked: false,
          startTime: { gt: new Date(now), gte: bounds.start, lt: bounds.endExclusive } },
        include: { doctor: true }, orderBy: [{ startTime: "asc" }, { id: "asc" }],
      }),
      this.prisma.appointment.findMany({ where: { patientId, status: "CONFIRMED" },
        select: { calendar: { select: { startTime: true, endTime: true } } } }),
    ]);
    const eligible = slots.filter((slot) => !replacementEligibilityError(context, slot, now) &&
      !conflicts.some(({ calendar }) => intervalsOverlap(slot, calendar)));
    const groups = rankBookingAlternatives(eligible, original.doctorId, original.startTime);
    return {
      requestedSlot: serializeCalendar(original), patientId,
      window: { startDate: bounds.startDate, endDate: bounds.endDate, timeZone: bounds.timeZone },
      sameDay: groups.sameDay.map(serializeCalendar), laterDates: groups.laterDates.map(serializeCalendar),
    };
  }

  async block(input: { doctorId: number; startTime: string; endTime: string }, user: AuthUser) {
    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    this.ensureTimeOrder(startTime, endTime);
    return this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, input.doctorId);
      const actor = await tx.user.findUnique({ where: { id: user.userId } });
      if (!actor || actor.closedAt || actor.role !== user.role || ![Role.ADMIN, Role.MANAGER].includes(actor.role as "ADMIN"|"MANAGER")) throw toForbidden();
      const recordedAt = this.lifecycle.now();
      const where = { doctorId: input.doctorId, schedulePeriodId: { not: null },
        startTime: { lt: endTime, gt: recordedAt }, endTime: { gt: startTime } };
      const blocked = await tx.calendar.updateMany({ where: { ...where, isBlocked: false }, data: { isBlocked: true } });
      const affected = await tx.appointment.updateManyAndReturn({
        where: { status: "CONFIRMED", patient: { closedAt: null }, calendar: { is: where } },
        data: { status: "NEEDS_RESCHEDULING", version: { increment: 1 } },
        include: { doctor: { select: { name: true } }, calendar: { select: { startTime: true, endTime: true } } },
      });
      for (const appointment of affected) await this.lifecycle.record(tx, appointment, "CONFIRMED", "NEEDS_RESCHEDULING", user.userId, recordedAt);
      if (affected.length) {
        const notices = await tx.notification.createManyAndReturn({ data: affected.sort((a, b) => a.id - b.id).map(appointment => ({
          recipientId: appointment.patientId, appointmentId: appointment.id, appointmentRef: appointment.id,
          createdAt: recordedAt, followUpDeadlineAt: followUpDeadline(appointment.calendar.startTime, recordedAt),
          disruptionVersion: appointment.version, calendarRef: appointment.calendarId, doctorName: appointment.doctor.name,
          slotStartTime: appointment.calendar.startTime, slotEndTime: appointment.calendar.endTime,
        })), select: { id: true } });
        await tx.emailJob.createMany({ data: notices.map(notice => ({ notificationId: notice.id })) });
      }
      return { blockedSlots: blocked.count, appointmentsNeedingRescheduling: affected.length };
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

  async getCalendarSlotById(calendarId: number, user: AuthUser) {
    if (user.role === Role.PATIENT) {
      const available = await this.prisma.calendar.findFirst({ where: {
        id: calendarId, startTime: { gt: new Date() }, schedulePeriodId: { not: null }, isBooked: false, isBlocked: false,
      }, include: { doctor: true } });
      if (!available) throw toNotFound("Calendar slot");
      return serializeCalendar(available);
    }
    const slot = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      include: { doctor: true },
    });
    if (!slot) throw toNotFound("Calendar slot");
    return user.role === Role.MANAGER ? serializeManagerCalendar(slot) : serializeCalendar(slot);
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
