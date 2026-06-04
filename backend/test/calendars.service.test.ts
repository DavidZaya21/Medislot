import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";

import { CalendarsService } from "../src/calendars/calendars.service";

test("calendar creation rejects past slots", async () => {
  const prisma = {
    user: {
      findFirst: async () => ({ id: 5 }),
    },
    calendar: {
      findFirst: async () => null,
      create: async () => {
        throw new Error("past slot should fail before create");
      },
    },
  };
  const service = new CalendarsService(prisma as never);

  await assert.rejects(
    () =>
      service.createCalendarSlot({
        doctorId: 5,
        startTime: "2020-01-01T10:00:00.000Z",
        endTime: "2020-01-01T11:00:00.000Z",
      }),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.deepStrictEqual(error.getResponse(), {
        message: "Calendar slot must start in the future",
        code: "CONFLICT",
      });
      return true;
    },
  );
});
