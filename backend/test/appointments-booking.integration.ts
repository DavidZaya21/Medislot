import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import bcrypt from "bcrypt";

import { AppModule } from "../src/app.module";
import { AppointmentsService } from "../src/appointments/appointments.service";
import { PrismaService } from "../src/prisma/prisma.service";

test("POST /appointments allows only one concurrent booking", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1", "Use a disposable local PostgreSQL instance");
  assert.equal(url.pathname, "/medislot_booking_test");
  process.env.DATABASE_URL = url.href;
  process.env.JWT_SECRET = "medislot-booking-integration-test";

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const prisma = app.get(PrismaService);
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await prisma.$disconnect();
    }
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidUnknownValues: false,
  }));
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();

  assert.equal(await prisma.user.count(), 0, "Use a fresh, migrated test database");
  const password = "integration-test-password";
  const hash = await bcrypt.hash(password, 4);
  const [doctor, ...patients] = await Promise.all([
    prisma.user.create({ data: { name: "Test Doctor", email: "doctor@example.test", password: hash, role: "DOCTOR" } }),
    ...[1, 2].map((n) => prisma.user.create({
      data: { name: `Patient ${n}`, email: `patient${n}@example.test`, password: hash, role: "PATIENT" },
    })),
  ]);
  const startTime = new Date(Date.now() + 60 * 60 * 1000);
  const slot = await prisma.calendar.create({
    data: { doctorId: doctor.id, startTime, endTime: new Date(startTime.getTime() + 30 * 60 * 1000) },
  });
  assert.equal(slot.isBooked, false);

  async function post(path: string, body: object, token?: string) {
    const response = await fetch(baseUrl + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() };
  }

  const tokens = await Promise.all(patients.map(async ({ email }) => {
    const login = await post("/sessions", { email, password });
    assert.ok(login.status >= 200 && login.status < 300, `Login returned HTTP ${login.status}`);
    assert.equal(typeof login.body.accessToken, "string");
    return login.body.accessToken as string;
  }));

  let reads = 0;
  let release!: () => void;
  let fail!: (error: Error) => void;
  const barrier = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });

  // Route only interactive transactions through this extension. Both real
  // SELECTs must observe the free slot before either callback can write.
  const synchronized = prisma.$extends({
    query: {
      calendar: {
        async findUnique({ args, query }) {
          const result = await query(args);
          if (args.where.id === slot.id) {
            assert.equal(result?.isBooked, false);
            if (++reads === 2) release();
            await barrier;
          }
          return result;
        },
      },
    },
  });
  const transaction = synchronized.$transaction.bind(synchronized);
  const bookingService = app.get(AppointmentsService);
  assert.ok(Reflect.set(bookingService, "prisma", new Proxy(prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return (callback: unknown) => transaction(callback as never, { timeout: 12_000 });
      }
      return Reflect.get(target, property, target);
    },
  })));
  const timer = setTimeout(() => fail(new Error("Both transactional availability reads did not overlap")), 8_000);
  // The deadline may fire before any request reaches the barrier.
  void barrier.catch(() => {});

  try {
    const responses = await Promise.all(tokens.map((token, i) => post("/appointments", {
      patientId: patients[i].id,
      doctorId: doctor.id,
      calendarId: slot.id,
      reason: "Concurrent booking integration test",
    }, token)));

    const appointments = await prisma.appointment.findMany({
      where: { calendarId: slot.id },
      select: { id: true, patientId: true, status: true },
    });
    const savedSlot = await prisma.calendar.findUniqueOrThrow({ where: { id: slot.id } });
    t.diagnostic(JSON.stringify({
      overlappingAvailableReads: reads,
      responses: responses.map(({ status, body }, i) => ({
        patientId: patients[i].id,
        status,
        body: status === 201 ? { id: body.id, calendarId: body.calendarId, status: body.status } : body,
      })),
      database: { calendarId: slot.id, isBooked: savedSlot.isBooked, appointments },
    }));

    assert.equal(reads, 2);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
    const winner = responses.findIndex(({ status }) => status === 201);
    assert.equal(responses[winner].body.calendarId, slot.id);
    assert.deepEqual(responses[1 - winner].body, {
      code: "CONFLICT",
      message: "Selected calendar slot is no longer available",
    });
    assert.deepEqual(appointments, [{
      id: responses[winner].body.id,
      patientId: patients[winner].id,
      status: "CONFIRMED",
    }]);
    assert.equal(savedSlot.isBooked, true);
  } finally {
    clearTimeout(timer);
    release();
    Reflect.set(bookingService, "prisma", prisma);
  }
});
