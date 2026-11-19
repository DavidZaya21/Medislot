import { Inject, Injectable } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import type { AppointmentStatus } from "@prisma/client";

import type { AuthUser } from "../auth/auth.types";
import { toConflict, toNotFound } from "../common/prisma-errors";
import { lockDoctor, releaseReservation, activeReservationStatuses } from "../common/doctor-lock";
import { serializeAppointment } from "../common/serializers";
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
      throw toConflict("Selected calendar slot is no longer available");
    }

    if (calendar.startTime <= new Date()) {
      throw toConflict("Cannot book an appointment in the past");
    }

    const appointment = await this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, input.doctorId);
      const refreshedSlot = await tx.calendar.findUnique({ where: { id: input.calendarId } });
      if (!refreshedSlot || refreshedSlot.doctorId !== input.doctorId || refreshedSlot.isBooked || refreshedSlot.isBlocked) {
        throw toConflict("Selected calendar slot is no longer available");
      }

      if (refreshedSlot.startTime <= new Date()) {
        throw toConflict("Cannot book an appointment in the past");
      }

      const claimedSlot = await tx.calendar.updateMany({
        where: { id: input.calendarId, doctorId: input.doctorId, isBooked: false, isBlocked: false },
        data: { isBooked: true },
      });

      if (claimedSlot.count !== 1) {
        throw toConflict("Selected calendar slot is no longer available");
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

  async getAppointmentById(appointmentId: number) {
    const appointment = await this.findAppointmentOrThrow(appointmentId);
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
      const refreshed = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { calendar: true } });
      if (!refreshed) throw toNotFound("Appointment");
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
      const current = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!current) throw toNotFound("Appointment");
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
