import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import bcrypt from "bcrypt";
import type { Calendar } from "@prisma/client";

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

  // Both initial availability reads finish before either transaction acquires
  // the doctor lock. Transactional rechecks must now run serially by design.
  const bookingService = app.get(AppointmentsService);
  const initialRead = prisma.calendar.findUnique.bind(prisma.calendar);
  const calendar = new Proxy(prisma.calendar, {
    get(target, property) {
      if (property === "findUnique") return async (args: Parameters<typeof initialRead>[0]) => {
        const result = await initialRead(args);
        if (args.where.id === slot.id) {
          assert.equal(result?.isBooked, false);
          if (++reads === 2) release();
          await barrier;
        }
        return result;
      };
      return Reflect.get(target, property, target);
    },
  });
  Reflect.set(bookingService, "prisma", new Proxy(prisma, {
    get(target, property) {
      return property === "calendar" ? calendar : Reflect.get(target, property, target);
    },
  }));
  const timer = setTimeout(() => fail(new Error("Both initial availability reads did not overlap")), 8_000);
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
      overlappingInitialAvailabilityReads: reads,
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
      code: "SLOT_UNAVAILABLE",
      message: "Selected calendar slot is no longer available",
    });
    assert.deepEqual(appointments, [{
      id: responses[winner].body.id,
      patientId: patients[winner].id,
      status: "CONFIRMED",
    }]);
    assert.equal(savedSlot.isBooked, true);
    const publisher = await prisma.user.create({ data: { name: "Publisher", email: "publisher@example.test", password: hash, role: "ADMIN" } });
    const period = await prisma.schedulePeriod.create({ data: { doctorId: doctor.id, publishedById: publisher.id,
      startDate: new Date(), endDate: new Date(Date.now() + 86_400_000 * 14), workingWeekdays: [1,2,3,4,5,6,7],
      dailyStartTime: "00:00", dailyEndTime: "23:59", slotDurationMinutes: 30, excludedDates: [], removedSlotIds: [] } });
    const replacements: Calendar[] = [];
    for (const hours of [2,3]) replacements.push(await prisma.calendar.create({ data: { doctorId: doctor.id,
      schedulePeriodId: period.id, startTime: new Date(startTime.getTime() + hours * 3_600_000), endTime: new Date(startTime.getTime() + hours * 3_600_000 + 1_800_000) } }));
    const loser = 1 - winner;
    const suggestions = await fetch(`${baseUrl}/calendars/${slot.id}/alternatives`, { headers: { Authorization: `Bearer ${tokens[loser]}` } });
    assert.equal(suggestions.status, 200);
    const groups = await suggestions.json();
    assert.ok([...groups.sameDay, ...groups.laterDates].some((s: { id: number }) => s.id === replacements[0].id));
    assert.equal(await prisma.appointment.count({ where: { patientId: patients[loser].id } }), 0);
    assert.equal(await prisma.appointmentRescheduleHistory.count(), 0);
    const booking = (i: number, calendarId: number) => post("/appointments", { patientId: patients[i].id,
      doctorId: doctor.id, calendarId, reason: "Preserved initial visit reason" }, tokens[i]);
    assert.equal((await booking(winner, replacements[0].id)).status, 201);
    const takenAgain = await booking(loser, replacements[0].id);
    assert.equal(takenAgain.status, 409); assert.equal(takenAgain.body.code, "SLOT_UNAVAILABLE");
    assert.equal(await prisma.appointment.count({ where: { patientId: patients[loser].id } }), 0);
    const newBooking = await booking(loser, replacements[1].id);
    assert.equal(newBooking.status, 201); assert.equal(newBooking.body.version, 1);
    assert.notEqual(newBooking.body.id, responses[winner].body.id);
    assert.equal(newBooking.body.reason, "Preserved initial visit reason");
    assert.equal(await prisma.appointmentRescheduleHistory.count(), 0);
    t.diagnostic("Loser received suggestions with no appointment; second taken alternative returned SLOT_UNAVAILABLE; final alternative created a NEW booking (201/version 1), with no rescheduling history");
  } finally {
    clearTimeout(timer);
    release();
    Reflect.set(bookingService, "prisma", prisma);
  }
});
