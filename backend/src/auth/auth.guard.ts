import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import jwt from "jsonwebtoken";

import { toUnauthorized } from "../common/prisma-errors";
import type { AuthUser } from "./auth.types";

type JwtPayload = {
  sub: number;
  role: AuthUser["role"];
};

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthUser;
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
