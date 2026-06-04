import { Inject, Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import type { AppointmentStatus } from "@prisma/client";

import type { AuthUser } from "../auth/auth.types";
import { toConflict, toNotFound } from "../common/prisma-errors";
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

    if (calendar.isBooked) {
      throw toConflict("Selected calendar slot is no longer available");
    }

    if (calendar.startTime <= new Date()) {
      throw toConflict("Cannot book an appointment in the past");
    }

    const appointment = await this.prisma.$transaction(async (tx) => {
      const refreshedSlot = await tx.calendar.findUnique({ where: { id: input.calendarId } });
      if (!refreshedSlot || refreshedSlot.isBooked) {
        throw toConflict("Selected calendar slot is no longer available");
      }

      if (refreshedSlot.startTime <= new Date()) {
        throw toConflict("Cannot book an appointment in the past");
      }

      await tx.calendar.update({
        where: { id: input.calendarId },
        data: { isBooked: true },
      });

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
    });

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

    if (current.status !== "CONFIRMED") {
      throw toConflict("Only confirmed appointments can be updated");
    }

    if (input.status === "COMPLETED" && current.calendar.endTime > new Date()) {
      throw toConflict("Cannot complete a future appointment");
    }

    const shouldFreeSlot = input.status === "CANCELLED";

    const updated = await this.prisma.$transaction(async (tx) => {
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
        await tx.calendar.update({
          where: { id: appointment.calendarId },
          data: { isBooked: false },
        });
        appointment.calendar.isBooked = false;
      }

      return appointment;
    });

    return serializeAppointment(updated);
  }

  async deleteAppointment(appointmentId: number) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) throw toNotFound("Appointment");

    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.delete({ where: { id: appointmentId } });
      await tx.calendar.update({
        where: { id: appointment.calendarId },
        data: { isBooked: false },
      });
    });
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
