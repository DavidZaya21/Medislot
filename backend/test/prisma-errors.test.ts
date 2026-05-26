import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { mapPrismaError } from "../src/common/prisma-errors";

test("Prisma unique constraint errors can use an endpoint-specific message", () => {
  const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["email"] },
  });

  assert.throws(
    () => mapPrismaError(error, { uniqueConstraintMessage: "Email is already registered" }),
    (thrown) => {
      assert.ok(thrown instanceof ConflictException);
      assert.deepStrictEqual(thrown.getResponse(), {
        message: "Email is already registered",
        code: "CONFLICT",
      });
      return true;
    },
  );
});
