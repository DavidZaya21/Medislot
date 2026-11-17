// Compile with tsc and emitDecoratorMetadata enabled so Nest transforms query DTOs.
import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import bcrypt from "bcrypt";

import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

test("doctor appointments are admin-only while managers can read availability", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/medislot_permissions_test", "Use a disposable, migrated database");
  process.env.DATABASE_URL = url.href;
  process.env.JWT_SECRET = "medislot-permissions-integration-test";

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
  const startTime = new Date(Date.now() + 60 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
  const booked = await prisma.calendar.create({
    data: { doctorId: doctor.id, startTime, endTime, isBooked: true },
  });
  const available = await prisma.calendar.create({
    data: {
      doctorId: doctor.id,
      startTime: endTime,
      endTime: new Date(endTime.getTime() + 30 * 60 * 1000),
    },
  });
  const appointment = await prisma.appointment.create({
    data: { doctorId: doctor.id, patientId: patient.id, calendarId: booked.id, reason: "Test appointment" },
  });
  const path = `/doctors/${doctor.id}/appointments`;

  async function get(path: string, expectedStatus: number, token?: string, caller = "unauthenticated") {
    const res = await fetch(baseUrl + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    t.diagnostic(`${caller} GET ${path}: HTTP ${res.status}`);
    assert.equal(res.status, expectedStatus);
    return res.json();
  }

  await get(path, 401);
  for (const role of roles) {
    const token = await signIn(`${role.toLowerCase()}@example.test`);
    const body = await get(path, role === "ADMIN" ? 200 : 403, token, role);
    if (role === "ADMIN") {
      assert.deepEqual(body.data.map(({ id }: { id: number }) => id), [appointment.id]);
    } else {
      assert.equal(body.code, "FORBIDDEN");
    }
    if (role === "MANAGER") {
      const doctors = await get("/doctors", 200, token, role);
      assert.deepEqual(doctors.data.map(({ id }: { id: number }) => id), [doctor.id]);
      const slots = await get(`/calendars?doctorId=${doctor.id}&isBooked=false`, 200, token, role);
      assert.deepEqual(slots.data.map(({ id }: { id: number }) => id), [available.id]);
    }
  }
});
