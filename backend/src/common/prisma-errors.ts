import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

export function toNotFound(resource: string) {
  return new NotFoundException({
    message: `${resource} was not found`,
    code: "NOT_FOUND",
  });
}

export function toBadRequest(message: string, details?: string[]) {
  return new BadRequestException({
    message,
    code: "BAD_REQUEST",
    ...(details ? { details } : {}),
  });
}

export function toConflict(message: string) {
  return new ConflictException({
    message,
    code: "CONFLICT",
  });
}

export function toUnauthorized(message = "Authentication token is missing or invalid") {
  return new UnauthorizedException({
    message,
    code: "UNAUTHORIZED",
  });
}

export function toForbidden(message = "You do not have permission to perform this action") {
  return new ForbiddenException({
    message,
    code: "FORBIDDEN",
  });
}

type PrismaErrorMappingOptions = {
  uniqueConstraintMessage?: string;
};

export function mapPrismaError(error: unknown, options: PrismaErrorMappingOptions = {}): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw toConflict(
      options.uniqueConstraintMessage ?? "Resource already exists or violates a uniqueness constraint",
    );
  }
  throw error;
}
