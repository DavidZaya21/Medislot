import { Inject, Injectable } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import type { AppointmentStatus } from "@prisma/client";

import type { AuthUser } from "../auth/auth.types";
import { toConflict, toForbidden, toNotFound, toSlotUnavailable } from "../common/prisma-errors";
import { lockDoctor, lockDoctors, lockPatient, hasPatientOverlap, releaseReservation, activeReservationStatuses } from "../common/doctor-lock";
import { ensureMoveCutoff, replacementEligibilityError, intervalsOverlap, type ReplacementContext } from "../common/rescheduling-policy";
import { recommendationWindow, rankAlternatives } from "../common/rescheduling-recommendations";
import type { RescheduleAppointmentDto } from "./appointments.dto";
import { serializeAppointment, serializeCalendar } from "../common/serializers";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AppointmentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listAppointments(status?: AppointmentStatus) {
    const appointments = await this.prisma.appointment.findMany({
      where: status ? { status } : undefined,
      include: {
        patient: true,
        doctor: true,
        calendar: true,
        _count: { select: { rescheduleHistory: true } },
      },
      orderBy: { id: "asc" },
    });

    return { data: appointments.map(serializeAppointment) };
  }

  async requestAppointment(input: {
    patientId: number;
    doctorId: number;
    calendarId: number;
    reason: string;
  }, currentUser: AuthUser) {
    const patientId = currentUser.role === Role.PATIENT ? currentUser.userId : input.patientId;

    await this.ensurePatientExists(patientId);
    await this.ensureDoctorExists(input.doctorId);

    const calendar = await this.prisma.calendar.findUnique({
      where: { id: input.calendarId },
    });
    if (!calendar) throw toNotFound("Calendar slot");

    if (calendar.doctorId !== input.doctorId) {
      throw toConflict("Selected calendar slot does not belong to the requested doctor");
    }

    if (calendar.isBooked || calendar.isBlocked) {
      throw toSlotUnavailable();
    }

    if (calendar.startTime <= new Date()) {
      throw toConflict("Cannot book an appointment in the past");
    }

    const appointment = await this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, input.doctorId);
      await lockPatient(tx, patientId);
      const refreshedSlot = await tx.calendar.findUnique({ where: { id: input.calendarId } });
      if (!refreshedSlot || refreshedSlot.doctorId !== input.doctorId || refreshedSlot.isBooked || refreshedSlot.isBlocked) {
        throw toSlotUnavailable();
      }

      if (refreshedSlot.startTime <= new Date()) {
        throw toConflict("Cannot book an appointment in the past");
      }

      if (await hasPatientOverlap(tx, patientId, refreshedSlot.startTime, refreshedSlot.endTime)) {
        throw toConflict("Patient already has a confirmed appointment overlapping this slot");
      }
      const claimedSlot = await tx.calendar.updateMany({
        where: { id: input.calendarId, doctorId: input.doctorId, isBooked: false, isBlocked: false, startTime: { gt: new Date() } },
        data: { isBooked: true },
      });

      if (claimedSlot.count !== 1) {
        throw toSlotUnavailable();
      }

      return tx.appointment.create({
        data: {
          patientId,
          doctorId: input.doctorId,
          calendarId: input.calendarId,
          reason: input.reason,
        },
        include: {
          patient: true,
          doctor: true,
          calendar: true,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });

    return serializeAppointment(appointment);
  }

  // Browsing is advisory: the move transaction rechecks every condition before writing.
  async rescheduleOptions(appointmentId: number, user: AuthUser) {
    if (user.role !== Role.PATIENT && user.role !== Role.RECEPTIONIST) throw toForbidden();
    const current = await this.findAppointmentOrThrow(appointmentId);
    if (user.role === Role.PATIENT && current.patientId !== user.userId) throw toForbidden();
    ensureMoveCutoff(current.status, current.calendar.startTime, user.role, Date.now());
    const slots = await this.eligibleReplacementSlots(current, Date.now());
    slots.sort((a, b) => Number(b.doctorId === current.doctorId) - Number(a.doctorId === current.doctorId));
    return { appointment: serializeAppointment(current), data: slots.map(serializeCalendar) };
  }

  async alternatives(appointmentId: number, user: AuthUser) {
    if (user.role !== Role.PATIENT && user.role !== Role.RECEPTIONIST) throw toForbidden();
    const current = await this.findAppointmentOrThrow(appointmentId);
    if (user.role === Role.PATIENT && current.patientId !== user.userId) throw toForbidden();
    if (current.status !== "NEEDS_RESCHEDULING") throw toConflict("Recommendations are available only for appointments needing rescheduling");
    const now = Date.now();
    const bounds = recommendationWindow(current.calendar.startTime);
    const slots = now >= bounds.endExclusive.getTime() ? [] : await this.eligibleReplacementSlots(current, now, {
      gte: bounds.start, lt: bounds.endExclusive,
    });
    const groups = rankAlternatives(slots, current.doctorId, current.calendar.startTime);
    return {
      appointment: serializeAppointment(current),
      window: { startDate: bounds.startDate, endDate: bounds.endDate, timeZone: bounds.timeZone },
      keepYourDay: groups.keepYourDay.map(serializeCalendar),
      keepYourDoctor: groups.keepYourDoctor.map(serializeCalendar),
    };
  }

  private async eligibleReplacementSlots(
    current: ReplacementContext & { id: number; patientId: number }, now: number,
    range: { gte: Date; lt: Date } | undefined = undefined,
  ) {
    const [slots, conflicts] = await Promise.all([
      this.prisma.calendar.findMany({
        where: {
          id: { not: current.calendarId }, schedulePeriodId: { not: null },
          isBooked: false, isBlocked: false, startTime: { gt: new Date(now), ...range },
          doctor: { role: Role.DOCTOR },
          OR: [
            { doctorId: current.doctorId },
            ...(current.doctor.specialization ? [{ doctor: { specialization: current.doctor.specialization } }] : []),
          ],
        },
        include: { doctor: true }, orderBy: [{ startTime: "asc" }, { doctorId: "asc" }, { id: "asc" }],
      }),
      this.prisma.appointment.findMany({
        where: { patientId: current.patientId, id: { not: current.id }, status: "CONFIRMED" },
        select: { calendar: { select: { startTime: true, endTime: true } } },
      }),
    ]);
    return slots.filter((slot) => !replacementEligibilityError(current, slot, now) &&
      !conflicts.some(({ calendar }) => intervalsOverlap(slot, calendar)));
  }

  async reschedule(appointmentId: number, input: RescheduleAppointmentDto, user: AuthUser) {
    if (user.role !== Role.PATIENT && user.role !== Role.RECEPTIONIST) throw toForbidden();
    // Discovery only. Every mutable decision is repeated after the complete lock set.
    const discovered = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!discovered) throw toNotFound("Appointment");
    if (user.role === Role.PATIENT && discovered.patientId !== user.userId) throw toForbidden("Patients can only move their own appointments");
    const target = await this.prisma.calendar.findUnique({ where: { id: input.newCalendarId } });
    if (!target) throw toNotFound("Replacement slot");

    return this.prisma.$transaction(async (tx) => {
      await lockDoctors(tx, [discovered.doctorId, target.doctorId]);
      await lockPatient(tx, discovered.patientId);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Appointment" WHERE id = ${appointmentId} FOR UPDATE`);
      const current = await tx.appointment.findUnique({
        where: { id: appointmentId }, include: { calendar: true, doctor: true },
      });
      if (!current) throw toNotFound("Appointment");
      const actor = await tx.user.findUnique({ where: { id: user.userId }, select: { role: true } });
      if (!actor || actor.role !== user.role ||
          (actor.role !== Role.PATIENT && actor.role !== Role.RECEPTIONIST) ||
          (actor.role === Role.PATIENT && current.patientId !== user.userId)) throw toForbidden();
      if (current.patientId !== discovered.patientId || current.doctorId !== discovered.doctorId ||
          current.calendarId !== input.currentCalendarId || current.version !== input.expectedVersion) {
        throw toConflict("Appointment changed. Reload it before confirming another move");
      }
      if (input.newCalendarId === current.calendarId) throw toConflict("Choose a different replacement slot");
      ensureMoveCutoff(current.status, current.calendar.startTime, user.role, Date.now());
      const replacement = await tx.calendar.findUnique({ where: { id: input.newCalendarId }, include: { doctor: true } });
      if (!replacement) throw toNotFound("Replacement slot");
      if (replacement.doctorId !== target.doctorId) throw toConflict("Replacement must be a future, published, unblocked and unbooked slot");
      const eligibilityError = replacementEligibilityError(current, replacement, Date.now());
      if (eligibilityError) throw toConflict(eligibilityError);
      if (await hasPatientOverlap(tx, current.patientId, replacement.startTime, replacement.endTime, appointmentId)) {
        throw toConflict("Patient already has a confirmed appointment overlapping this slot");
      }
      const claimed = await tx.calendar.updateMany({
        where: { id: replacement.id, doctorId: replacement.doctorId, schedulePeriodId: { not: null },
          isBooked: false, isBlocked: false, startTime: { gt: new Date() } }, data: { isBooked: true },
      });
      if (claimed.count !== 1) throw toConflict("Replacement slot is no longer available");
      const updated = await tx.appointment.update({
        where: { id: appointmentId, version: input.expectedVersion, calendarId: input.currentCalendarId },
        data: { doctorId: replacement.doctorId, calendarId: replacement.id, status: "CONFIRMED", version: { increment: 1 } },
        include: { patient: true, doctor: true, calendar: true },
      });
      await releaseReservation(tx, current.calendarId);
      const historyEntry = await tx.appointmentRescheduleHistory.create({ data: {
        appointmentId, appointmentVersion: updated.version,
        previousDoctorId: current.doctorId, newDoctorId: replacement.doctorId,
        previousCalendarId: current.calendarId, newCalendarId: replacement.id,
        previousStartTime: current.calendar.startTime, previousEndTime: current.calendar.endTime,
        newStartTime: replacement.startTime, newEndTime: replacement.endTime,
        reason: current.status === "NEEDS_RESCHEDULING" ? "DOCTOR_UNAVAILABLE" : "PATIENT_REQUESTED",
        actorId: user.userId,
      } });
      const rescheduleCount = await tx.appointmentRescheduleHistory.count({ where: { appointmentId } });
      return { ...serializeAppointment(updated), historyEntry, rescheduleCount };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  }

  async getAppointmentById(appointmentId: number, currentUser: AuthUser) {
    const appointment = await this.findAppointmentOrThrow(appointmentId);
    const allowed = currentUser.role === Role.ADMIN || currentUser.role === Role.RECEPTIONIST ||
      (currentUser.role === Role.PATIENT && appointment.patientId === currentUser.userId) ||
      (currentUser.role === Role.DOCTOR && appointment.doctorId === currentUser.userId);
    if (!allowed) throw toForbidden("You are not allowed to access this appointment");
    return serializeAppointment(appointment);
  }

  async reviewAppointment(
    appointmentId: number,
    input: { status: AppointmentStatus; reason: string },
  ) {
    const current = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { calendar: true },
    });
    if (!current) throw toNotFound("Appointment");

    if (input.status === "NEEDS_RESCHEDULING") throw toConflict("Rescheduling status is assigned only by blocking");
    if (current.status !== "CONFIRMED" && !(current.status === "NEEDS_RESCHEDULING" && input.status === "CANCELLED")) {
      throw toConflict("Only confirmed appointments can be updated");
    }

    if (input.status === "COMPLETED" && current.calendar.endTime > new Date()) {
      throw toConflict("Cannot complete a future appointment");
    }

    const shouldFreeSlot = input.status === "CANCELLED";

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, current.doctorId);
      await lockPatient(tx, current.patientId);
      const refreshed = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { calendar: true } });
      if (!refreshed) throw toNotFound("Appointment");
      if (refreshed.doctorId !== current.doctorId || refreshed.patientId !== current.patientId || refreshed.version !== current.version) {
        throw toConflict("Appointment changed. Reload it before updating");
      }
      if (refreshed.status !== "CONFIRMED" && !(refreshed.status === "NEEDS_RESCHEDULING" && input.status === "CANCELLED")) {
        throw toConflict("Only confirmed appointments or rescheduling cancellations can be updated");
      }
      if (input.status === "COMPLETED" && refreshed.calendar.endTime > new Date()) {
        throw toConflict("Cannot complete a future appointment");
      }
      const appointment = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: input.status,
          reason: input.reason,
          version: { increment: 1 },
        },
        include: {
          patient: true,
          doctor: true,
          calendar: true,
        },
      });

      if (shouldFreeSlot) {
        await releaseReservation(tx, appointment.calendarId);
        const calendar = await tx.calendar.findUniqueOrThrow({ where: { id: appointment.calendarId } });
        appointment.calendar.isBooked = calendar.isBooked;
      }

      return appointment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    return serializeAppointment(updated);
  }

  async deleteAppointment(appointmentId: number) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) throw toNotFound("Appointment");

    await this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, appointment.doctorId);
      await lockPatient(tx, appointment.patientId);
      const current = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!current) throw toNotFound("Appointment");
      if (current.doctorId !== appointment.doctorId || current.patientId !== appointment.patientId || current.version !== appointment.version) {
        throw toConflict("Appointment changed. Reload it before deleting");
      }
      if (await tx.appointmentRescheduleHistory.findFirst({ where: { appointmentId }, select: { id: true } })) {
        throw toConflict("Appointments with rescheduling history cannot be deleted");
      }
      if (current.status === "NEEDS_RESCHEDULING") {
        throw toConflict("Appointments awaiting rescheduling cannot be deleted");
      }
      await tx.appointment.delete({ where: { id: appointmentId } });
      if (activeReservationStatuses.some((status) => status === current.status)) {
        await releaseReservation(tx, current.calendarId);
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async findAppointmentOrThrow(appointmentId: number) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctor: true,
        calendar: true,
        _count: { select: { rescheduleHistory: true } },
      },
    });
    if (!appointment) throw toNotFound("Appointment");
    return appointment;
  }

  private async ensurePatientExists(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user || user.role !== Role.PATIENT) throw toNotFound("Patient");
  }

  private async ensureDoctorExists(doctorId: number) {
    const doctor = await this.prisma.user.findFirst({
      where: { id: doctorId, role: "DOCTOR" },
      select: { id: true },
    });
    if (!doctor) throw toNotFound("Doctor");
  }
}
