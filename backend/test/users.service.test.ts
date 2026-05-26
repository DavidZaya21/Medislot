import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";

import { UsersService } from "../src/users/users.service";

test("patients cannot read another user's profile", async () => {
  const prisma = {
    user: {
      findUnique: async () => {
        throw new Error("patient access should fail before querying");
      },
    },
  };
  const service = new UsersService(prisma as never);

  await assert.rejects(
    () => service.getUserById(7, { userId: 3, role: Role.PATIENT }),
    (error) => {
      assert.ok(error instanceof ForbiddenException);
      assert.deepStrictEqual(error.getResponse(), {
        message: "Patients can only access their own user information",
        code: "FORBIDDEN",
      });
      return true;
    },
  );
});
