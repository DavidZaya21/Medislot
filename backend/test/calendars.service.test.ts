import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";

import { Role } from "@prisma/client";
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

test("calendar date filters use Warsaw days in winter, summer and DST transitions", async () => {
  for (const [date, start, end] of [
    ["2030-01-07", "2030-01-06T23:00:00.000Z", "2030-01-07T23:00:00.000Z"],
    ["2030-07-01", "2030-06-30T22:00:00.000Z", "2030-07-01T22:00:00.000Z"],
    ["2026-03-29", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
    ["2026-10-25", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
  ]) {
    let received: unknown;
    const service = new CalendarsService({
      calendar: { findMany: async (query: unknown) => { received = query; return []; } },
    } as never);
    await service.listCalendarSlots({ date }, { userId: 1, role: Role.ADMIN });
    assert.deepEqual(received, {
      where: { startTime: { gte: new Date(start), lt: new Date(end) } },
      include: { doctor: true }, orderBy: { startTime: "asc" },
    });
  }
});
