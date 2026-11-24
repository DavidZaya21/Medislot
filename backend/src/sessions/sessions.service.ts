import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { toUnauthorized } from "../common/prisma-errors";
import { getJwtSecret } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SessionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createSession(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.closedAt) {
      throw toUnauthorized("Invalid email or password");
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      throw toUnauthorized("Invalid email or password");
    }

    const accessToken = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        authVersion: user.authVersion,
      },
      getJwtSecret(),
      { expiresIn: "7d" },
    );

    return {
      accessToken,
      tokenType: "Bearer",
    };
  }
}
