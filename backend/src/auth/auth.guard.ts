import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
} from "@nestjs/common";
import jwt from "jsonwebtoken";
import { PrismaService } from "../prisma/prisma.service";
import type { User } from "@prisma/client";

import { toUnauthorized } from "../common/prisma-errors";
import type { AuthUser } from "./auth.types";

type JwtPayload = {
  sub: number;
  role: AuthUser["role"];
  authVersion?: number;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) protected readonly db: PrismaService) {}
  protected closedReplay(_account: User, _payload: JwtPayload, _body: unknown) { return false; }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthUser;
      body?: unknown;
    }>();

    const authorization = request.headers.authorization;
    if (!authorization || Array.isArray(authorization)) {
      throw toUnauthorized();
    }

    const [type, token] = authorization.split(" ");
    if (type !== "Bearer" || !token) {
      throw toUnauthorized();
    }

    try {
      const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;
      const account = await this.db.user.findUnique({ where: { id: Number(payload.sub) } });
      if (!account || account.role !== payload.role ||
        (account.closedAt ? !this.closedReplay(account, payload, request.body) : account.authVersion !== payload.authVersion)) throw toUnauthorized();
      request.user = {
        userId: Number(payload.sub),
        role: payload.role,
      };
      return true;
    } catch {
      throw toUnauthorized();
    }
  }
}

export function getJwtSecret() {
  return process.env.JWT_SECRET ?? "medislot-dev-secret";
}

// Only this endpoint accepts a revoked token, and only to return its own committed receipt.
@Injectable()
export class ClosureAuthGuard extends AuthGuard {
  protected closedReplay(account: User, payload: JwtPayload, body: unknown) {
    return account.role === "PATIENT" && account.authVersion === (payload.authVersion ?? -1) + 1 &&
      !!account.closureRequestId && typeof body === "object" && body !== null &&
      "requestId" in body && body.requestId === account.closureRequestId &&
      "confirmed" in body && body.confirmed === true;
  }
}
