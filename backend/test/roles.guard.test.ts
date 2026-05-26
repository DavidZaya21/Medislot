import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";

import { RolesGuard } from "../src/auth/roles.guard";
import { UsersController } from "../src/users/users.controller";

test("GET /users rejects patient access", () => {
  const guard = new RolesGuard(new Reflector());
  const context = createHttpContext({
    handler: UsersController.prototype.listUsers,
    controller: UsersController,
    role: Role.PATIENT,
  });

  assert.throws(
    () => guard.canActivate(context),
    (error) => error instanceof ForbiddenException,
  );
});

test("GET /users allows staff access", () => {
  const guard = new RolesGuard(new Reflector());

  for (const role of [Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR]) {
    const context = createHttpContext({
      handler: UsersController.prototype.listUsers,
      controller: UsersController,
      role,
    });

    assert.equal(guard.canActivate(context), true);
  }
});

function createHttpContext(input: {
  handler: (...args: never[]) => unknown;
  controller: Function;
  role: Role;
}): ExecutionContext {
  return {
    getHandler: () => input.handler,
    getClass: () => input.controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: 1, role: input.role } }),
    }),
  } as ExecutionContext;
}
