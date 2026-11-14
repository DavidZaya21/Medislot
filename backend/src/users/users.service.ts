import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcrypt";
import { Prisma, Role } from "@prisma/client";
import type { AppointmentStatus, User } from "@prisma/client";

import type { AuthUser } from "../auth/auth.types";
import { mapPrismaError, toForbidden, toNotFound } from "../common/prisma-errors";
import { serializeAppointment, serializeUser } from "../common/serializers";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async registerPatient(input: { name: string; email: string; password: string }) {
    try {
      const user = await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          password: await bcrypt.hash(input.password, 10),
          role: "PATIENT",
        },
      });

      return serializeUser(user);
    } catch (error) {
      mapPrismaError(error, {
        uniqueConstraintMessage: "Email is already registered",
      });
    }
  }

  async listUsers(query: {
    role?: Role;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}, currentUser: AuthUser) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 10);
    const roleFilter = currentUser.role === "ADMIN" ? query.role : Role.PATIENT;
    const where: Prisma.UserWhereInput = {
      ...(roleFilter ? { role: roleFilter } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { id: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map(serializeUser),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getUserById(userId: number, currentUser: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw toNotFound("User");
    this.ensureUserReadAccess(user, currentUser);
    return serializeUser(user);
  }

  async updateUserById(
    userId: number,
    input: { name: string; email: string },
    currentUser: AuthUser,
  ) {
    await this.ensureUserUpdateAccess(userId, currentUser);

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          email: input.email,
        },
      });
      return serializeUser(user);
    } catch (error) {
      if (isRecordNotFound(error)) throw toNotFound("User");
      mapPrismaError(error);
    }
  }

  async deleteUserById(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw toNotFound("User");

    await this.prisma.$transaction(async (tx) => {
      if (user.role === "DOCTOR") {
        await tx.appointment.deleteMany({ where: { doctorId: userId } });
        await tx.calendar.deleteMany({ where: { doctorId: userId } });
      }

      if (user.role === "PATIENT") {
        await tx.appointment.deleteMany({ where: { patientId: userId } });
      }

      await tx.user.delete({ where: { id: userId } });
    });
  }

  async listAppointmentsByUser(
    userId: number,
    status: AppointmentStatus | undefined,
    currentUser: AuthUser,
  ) {
    await this.ensureUserAppointmentAccess(userId, currentUser);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        patientId: userId,
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

  private ensureUserReadAccess(user: User, currentUser: AuthUser) {
    if (currentUser.role === "ADMIN") return;
    if (currentUser.userId === user.id) return;
    if (currentUser.role === "RECEPTIONIST" && user.role === "PATIENT") return;

    if (currentUser.role === "PATIENT") {
      throw toForbidden("Patients can only access their own user information");
    }
    throw toForbidden("You can only access allowed user information");
  }

  private async ensureUserUpdateAccess(userId: number, currentUser: AuthUser) {
    if (currentUser.role === "ADMIN") return;
    if (currentUser.userId !== userId) {
      throw toForbidden("You can only update your own user information");
    }
  }

  private async ensureUserAppointmentAccess(userId: number, currentUser: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw toNotFound("User");

    if (currentUser.role === "ADMIN") return;
    if (currentUser.role === "PATIENT" && currentUser.userId === userId) return;
    if (currentUser.role === "RECEPTIONIST" && user.role === "PATIENT") return;

    throw toForbidden("You can only access allowed user appointment information");
  }
}

function isRecordNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2025"
  );
}
