import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcrypt";

import { mapPrismaError } from "../common/prisma-errors";
import { serializeUser } from "../common/serializers";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ReceptionistsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createReceptionist(input: { name: string; email: string; password: string }) {
    try {
      const user = await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          password: await bcrypt.hash(input.password, 10),
          role: "RECEPTIONIST",
        },
      });

      return serializeUser(user);
    } catch (error) {
      mapPrismaError(error, {
        uniqueConstraintMessage: "Email is already registered",
      });
    }
  }
}
