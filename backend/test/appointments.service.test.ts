import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { Role } from "@prisma/client";

import { AppointmentsService } from "../src/appointments/appointments.service";

test("appointment creation rejects past calendar slots", async () => {
  const prisma = {
    user: {
      findUnique: async () => ({ id: 1, role: Role.PATIENT }),
      findFirst: async () => ({ id: 5 }),
    },
    calendar: {
      findUnique: async () => ({
        id: 3,
        doctorId: 5,
        startTime: new Date("2020-01-01T10:00:00.000Z"),
        isBooked: false,
      }),
    },
    $transaction: async () => {
      throw new Error("past slot should fail before transaction");
    },
  };
  const service = new AppointmentsService(prisma as never);

  await assert.rejects(
    () =>
      service.requestAppointment(
        {
          patientId: 1,
          doctorId: 5,
          calendarId: 3,
          reason: "Regular clinic visit",
        },
        { userId: 1, role: Role.PATIENT },
      ),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.deepStrictEqual(error.getResponse(), {
        message: "Cannot book an appointment in the past",
        code: "CONFLICT",
      });
      return true;
    },
  );
});

test("appointment review rejects already cancelled appointments", async () => {
  const prisma = {
    appointment: {
      findUnique: async () => ({
        id: 2,
        status: "CANCELLED",
        calendar: {
          endTime: new Date("2020-01-01T11:00:00.000Z"),
        },
      }),
    },
    $transaction: async () => {
      throw new Error("cancelled appointment should fail before transaction");
    },
  };
  const service = new AppointmentsService(prisma as never);

  await assert.rejects(
    () =>
      service.reviewAppointment(2, {
        status: "COMPLETED",
        reason: "Already cancelled",
      }),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.deepStrictEqual(error.getResponse(), {
        message: "Only confirmed appointments can be updated",
        code: "CONFLICT",
      });
      return true;
    },
  );
});

test("appointment review rejects completing future appointments", async () => {
  const prisma = {
    appointment: {
      findUnique: async () => ({
        id: 3,
        status: "CONFIRMED",
        calendar: {
          endTime: new Date("2099-01-01T11:00:00.000Z"),
        },
      }),
    },
    $transaction: async () => {
      throw new Error("future appointment should fail before transaction");
    },
  };
  const service = new AppointmentsService(prisma as never);

  await assert.rejects(
    () =>
      service.reviewAppointment(3, {
        status: "COMPLETED",
        reason: "Future visit",
      }),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.deepStrictEqual(error.getResponse(), {
        message: "Cannot complete a future appointment",
        code: "CONFLICT",
      });
      return true;
    },
  );
});
