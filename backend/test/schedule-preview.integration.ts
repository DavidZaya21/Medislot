import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import bcrypt from "bcrypt";

import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

test("schedule preview validates, generates Warsaw slots, and persists nothing", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/medislot_preview_test", "Use a disposable, migrated database");
  process.env.DATABASE_URL = url.href;
  process.env.JWT_SECRET = "medislot-preview-integration-test";

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const prisma = app.get(PrismaService);
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await prisma.$disconnect();
    }
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();

  assert.equal(await prisma.user.count(), 0, "Use a freshly migrated database");
  const password = "integration-test-password";
  const hash = await bcrypt.hash(password, 4);
  const roles = ["ADMIN", "RECEPTIONIST", "DOCTOR", "PATIENT", "MANAGER"] as const;
  await prisma.user.createMany({ data: roles.map((role) => ({
    role,
    name: role,
    email: `${role.toLowerCase()}@example.test`,
    password: hash,
  })) });

  async function post(path: string, body: object, token?: string) {
    const res = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: await res.json() };
  }

  async function signIn(email: string) {
    const session = await post("/sessions", { email, password });
    assert.equal(session.status, 201);
    assert.equal(typeof session.body.accessToken, "string");
    return session.body.accessToken as string;
  }

  const doctor = await prisma.user.findUniqueOrThrow({ where: { email: "doctor@example.test" } });
  const patient = await prisma.user.findUniqueOrThrow({ where: { email: "patient@example.test" } });
  const path = "/schedulePeriods/preview";
  const input = {
    doctorId: doctor.id,
    startDate: "2026-11-16",
    endDate: "2026-11-20",
    workingWeekdays: [1, 3, 5],
    dailyStartTime: "09:00",
    dailyEndTime: "10:10",
    slotDurationMinutes: 30,
    excludedDates: ["2026-11-18"],
  };

  const manager = await signIn("manager@example.test");
  assert.equal((await post(path, input)).status, 401);
  for (const role of roles.filter((role) => role !== "MANAGER" && role !== "ADMIN")) {
    const token = await signIn(`${role.toLowerCase()}@example.test`);
    assert.equal((await post(path, input, token)).status, 403, role);
  }
  const admin = await signIn("admin@example.test");
  const adminResult = await post(path, input, admin);
  assert.equal(adminResult.status, 200);
  t.diagnostic("ADMIN and MANAGER: 200; doctor, receptionist, patient: 403; unauthenticated: 401");

  const result = await post(path, input, manager);
  assert.equal(result.status, 200);
  assert.deepEqual(adminResult.body, result.body);
  assert.deepEqual(result.body, {
    doctorId: doctor.id,
    timeZone: "Europe/Warsaw",
    slots: ["2026-11-16", "2026-11-20"].flatMap((date) => [
      { startTime: `${date}T08:00:00.000Z`, endTime: `${date}T08:30:00.000Z` },
      { startTime: `${date}T08:30:00.000Z`, endTime: `${date}T09:00:00.000Z` },
    ]),
  });

  const noFullSlot = await post(path, { ...input, slotDurationMinutes: 71 }, manager);
  assert.equal(noFullSlot.status, 200);
  assert.deepEqual(noFullSlot.body.slots, []);

  const spring = await post(path, {
    ...input, startDate: "2026-03-28", endDate: "2026-03-29", workingWeekdays: [6, 7],
    dailyEndTime: "09:30", excludedDates: [],
  }, manager);
  assert.equal(spring.status, 200);
  assert.deepEqual(spring.body.slots, [
    { startTime: "2026-03-28T08:00:00.000Z", endTime: "2026-03-28T08:30:00.000Z" },
    { startTime: "2026-03-29T07:00:00.000Z", endTime: "2026-03-29T07:30:00.000Z" },
  ]);

  for (const invalid of [
    { doctorId: 0 }, { startDate: "2026-02-30" }, { endDate: "2026-11-15" },
    { workingWeekdays: [] }, { workingWeekdays: [0, 8] }, { dailyStartTime: "9:00" },
    { dailyEndTime: "24:00" }, { dailyEndTime: "09:00" }, { slotDurationMinutes: 0 },
    { excludedDates: ["2026-11-31"] }, { excludedDates: undefined },
    { endDate: "2028-11-20" },
    { startDate: "2026-03-29", endDate: "2026-03-29", workingWeekdays: [7], dailyStartTime: "02:30" },
    { startDate: "2026-10-25", endDate: "2026-10-25", workingWeekdays: [7], dailyStartTime: "02:30" },
  ]) {
    assert.equal((await post(path, { ...input, ...invalid }, manager)).status, 400, JSON.stringify(invalid));
  }
  for (const doctorId of [patient.id, 2147483647]) {
    assert.equal((await post(path, { ...input, doctorId }, manager)).status, 404);
  }
  assert.equal(await prisma.user.count(), roles.length);
  assert.equal(await prisma.calendar.count(), 0);
  assert.equal(await prisma.appointment.count(), 0);
  t.diagnostic("Preview returned 4 exact slots; date, DST, validation and doctor checks passed; no rows created");
});
