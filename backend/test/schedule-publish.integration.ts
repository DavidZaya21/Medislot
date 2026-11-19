import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import bcrypt from "bcrypt";

import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

test("schedule publication is atomic, validates removals, and serializes conflicts", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/medislot_publish_test", "Use a disposable, migrated database");
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
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "manager@example.test" } });
  const managerToken = await signIn(manager.email);
  const adminToken = await signIn("admin@example.test");
  const input = {
    doctorId: doctor.id, startDate: "2030-01-07", endDate: "2030-01-09",
    workingWeekdays: [1, 3], dailyStartTime: "09:00", dailyEndTime: "10:00",
    slotDurationMinutes: 30, excludedDates: [], removedSlotIds: [0, 1],
  };
  const publish = (body = input, token = managerToken) => post("/schedulePeriods", body, token);
  assert.equal((await post("/schedulePeriods", input)).status, 401);
  for (const role of ["DOCTOR", "RECEPTIONIST", "PATIENT"]) {
    assert.equal((await publish(input, await signIn(role.toLowerCase() + "@example.test"))).status, 403);
  }
  for (const removedSlotIds of [[4], [-1], [0, 0], [0.5], [0, 1, 2, 3]]) {
    assert.equal((await publish({ ...input, removedSlotIds })).status, 400);
  }
  assert.equal((await publish({ ...input, startDate: "2020-01-06", endDate: "2020-01-08" })).status, 400);
  assert.equal(await prisma.schedulePeriod.count(), 0);
  const success = await publish(Object.assign({}, input, { slots: [{ startTime: "2099-01-01T00:00:00Z" }] }));
  assert.equal(success.status, 201);
  assert.equal(success.body.publishedById, manager.id);
  assert.equal(success.body.slotCount, 2);
  const saved = await prisma.calendar.findMany({ orderBy: { startTime: "asc" } });
  assert.equal(saved.length, 2);
  assert.ok(saved.every((slot) => slot.schedulePeriodId === success.body.id));
  assert.equal(saved[0].startTime.toISOString(), "2030-01-09T08:00:00.000Z");
  await assert.rejects(
    () => prisma.schedulePeriod.delete({ where: { id: success.body.id } }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "P2003");
      return true;
    },
  );
  assert.ok(await prisma.schedulePeriod.findUnique({ where: { id: success.body.id } }));
  assert.equal(await prisma.calendar.count({ where: { schedulePeriodId: success.body.id } }), 2);
  t.diagnostic("Deleting a period with linked slots rejected with P2003; period and both slots preserved");

  // Jan 7 has no retained slots but remains inside the published date period.
  assert.equal((await publish({ ...input, endDate: input.startDate, removedSlotIds: [],
    dailyStartTime: "18:00", dailyEndTime: "19:00" })).status, 409);

  const other = await prisma.user.create({
    data: { name: "Other Doctor", email: "other@example.test", password: hash, role: "DOCTOR" },
  });
  assert.equal((await publish({ ...input, doctorId: other.id }, adminToken)).status, 201);
  const legacy = await prisma.calendar.create({ data: {
    doctorId: doctor.id, startTime: new Date("2030-01-14T08:00Z"), endTime: new Date("2030-01-14T08:30Z"),
  } });
  assert.equal((await publish({ ...input, startDate: "2030-01-14", endDate: "2030-01-14", removedSlotIds: [] })).status, 409);
  assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id: legacy.id } })).schedulePeriodId, null);

  const beforePeriods = await prisma.schedulePeriod.count();
  const beforeSlots = await prisma.calendar.count();
  // Fail slot insertion after period creation: the HTTP request must roll back both.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_test_slot() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected slot failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_test_slot BEFORE INSERT ON "Calendar"
    FOR EACH ROW EXECUTE FUNCTION reject_test_slot()`);
  try {
    assert.equal((await publish({ ...input, startDate: "2030-01-21", endDate: "2030-01-21", removedSlotIds: [] })).status, 500);
    assert.equal(await prisma.schedulePeriod.count(), beforePeriods);
    assert.equal(await prisma.calendar.count(), beforeSlots);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_test_slot ON "Calendar"');
    await prisma.$executeRawUnsafe('DROP FUNCTION reject_test_slot()');
  }

  const concurrent = { ...input, startDate: "2030-02-04", endDate: "2030-02-04", removedSlotIds: [] };
  // Hold the same real doctor-row lock so both HTTP transactions reach it
  // before either can check conflicts. Poll PostgreSQL's actual lock waits.
  let unlock!: () => void;
  let locked!: () => void;
  const release = new Promise<void>((resolve) => { unlock = resolve; });
  const acquired = new Promise<void>((resolve) => { locked = resolve; });
  const blocker = prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', doctor.id);
    locked();
    await release;
  }, { timeout: 12_000 });
  await acquired;
  const requests = Promise.all([publish(concurrent), publish(concurrent, adminToken)]);
  let waiters = 0;
  try {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%FOR UPDATE%'`);
      waiters = Number(rows[0].count);
      if (waiters >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(waiters >= 2, "Both HTTP publications must wait on the held doctor lock");
  } finally { unlock(); await blocker; }
  const results = await requests;
  assert.deepEqual(results.map(({ status }) => status).sort(), [201, 409]);
  assert.equal(await prisma.schedulePeriod.count(), beforePeriods + 1);
  assert.equal(await prisma.calendar.count(), beforeSlots + 2);

  const manualRace = { ...input, startDate: "2030-02-11", endDate: "2030-02-11", removedSlotIds: [] };
  const manual = {
    doctorId: doctor.id, startTime: "2030-02-11T08:00:00.000Z", endTime: "2030-02-11T08:30:00.000Z",
  };
  const mixed = await Promise.all([
    publish(manualRace), post("/calendars", manual, adminToken),
  ]);
  assert.deepEqual(mixed.map(({ status }) => status).sort(), [201, 409]);
  const overlapping = await prisma.calendar.findMany({
    where: { doctorId: doctor.id, startTime: { gte: new Date(manual.startTime), lt: new Date("2030-02-11T09:00Z") } },
    orderBy: { startTime: "asc" },
  });
  for (let i = 1; i < overlapping.length; i++) {
    assert.ok(overlapping[i - 1].endTime <= overlapping[i].startTime);
  }
  t.diagnostic("Concurrent publication versus manual calendar creation also yielded 201/409 without overlapping slots");
  t.diagnostic("Publication 201; removed slots omitted; invalid removals/past/empty 400; non-admin/manager 403; no-token 401; date/calendar conflicts 409; injected failure rolled back; two verified lock waiters yielded 201/409");
});
