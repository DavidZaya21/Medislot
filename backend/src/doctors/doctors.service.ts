import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import type { AppointmentStatus } from "@prisma/client";

import { mapPrismaError, toConflict, toNotFound } from "../common/prisma-errors";
import { lockDoctor } from "../common/doctor-lock";
import { serializeAppointment, serializeDoctor } from "../common/serializers";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DoctorsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listDoctors(query: { search?: string; specialization?: string } = {}) {
    const doctors = await this.prisma.user.findMany({
      where: {
        role: "DOCTOR",
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: "insensitive" } },
                { email: { contains: query.search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(query.specialization
          ? { specialization: { contains: query.specialization, mode: "insensitive" } }
          : {}),
      },
      orderBy: { id: "asc" },
    });

    return {
      data: doctors.map(serializeDoctor),
    };
  }

  async createDoctor(input: {
    name: string;
    email: string;
    password: string;
    specialization: string;
  }) {
    try {
      const user = await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          password: await bcrypt.hash(input.password, 10),
          role: "DOCTOR",
          specialization: input.specialization,
        },
      });
      return serializeDoctor(user);
    } catch (error) {
      mapPrismaError(error, {
        uniqueConstraintMessage: "Email is already registered",
      });
    }
  }

  async getDoctorById(doctorId: number) {
    const user = await this.findDoctorOrThrow(doctorId);
    return serializeDoctor(user);
  }

  async updateDoctorById(doctorId: number, input: { specialization: string }) {
    await this.findDoctorOrThrow(doctorId);
    const user = await this.prisma.user.update({
      where: { id: doctorId },
      data: { specialization: input.specialization },
    });
    return serializeDoctor(user);
  }

  async deleteDoctorById(doctorId: number) {
    await this.findDoctorOrThrow(doctorId);

    await this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, doctorId);
      if (await tx.appointment.findFirst({ where: { doctorId, status: "NEEDS_RESCHEDULING" } })) {
        throw toConflict("Doctor has appointments awaiting rescheduling");
      }
      await tx.appointment.deleteMany({ where: { doctorId } });
      await tx.calendar.deleteMany({ where: { doctorId } });
      await tx.user.delete({ where: { id: doctorId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async listAppointmentsByDoctor(doctorId: number, status?: AppointmentStatus) {
    await this.findDoctorOrThrow(doctorId);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        ...(status ? { status } : {}),
      },
      include: {
        patient: true,
        doctor: true,
        calendar: true,
      },
      orderBy: { id: "asc" },
    });

    return { data: appointments.map(serializeAppointment) };
  }

  private async findDoctorOrThrow(doctorId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: doctorId, role: "DOCTOR" },
    });

    if (!user) throw toNotFound("Doctor");
    return user;
  }
}
