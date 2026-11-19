import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import bcrypt from "bcrypt";

import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

test("blocking preserves records and serializes appointment mutations", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/medislot_block_test", "Use a disposable, migrated database");
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
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.test" } });
  const adminToken = await signIn(admin.email);
  const managerToken = await signIn("manager@example.test");
  const patientToken = await signIn(patient.email);
  const period = await prisma.schedulePeriod.create({ data: {
    doctorId: doctor.id, startDate: new Date("2030-01-01"), endDate: new Date("2030-12-31"),
    workingWeekdays: [1,2,3,4,5,6,7], dailyStartTime: "00:00", dailyEndTime: "23:59",
    slotDurationMinutes: 30, excludedDates: [], removedSlotIds: [], publishedById: admin.id,
  } });
  async function slot(start: string, end: string, published = true) {
    return prisma.calendar.create({ data: { doctorId: doctor.id, startTime: new Date(start), endTime: new Date(end),
      schedulePeriodId: published ? period.id : null } });
  }
  async function request(method: string, path: string, body?: object, token = adminToken) {
    const response = await fetch(baseUrl + path, { method,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  const before = await slot("2030-01-07T07:30Z", "2030-01-07T08:00Z");
  const booked = await slot("2030-01-07T08:00Z", "2030-01-07T08:30Z");
  const free = await slot("2030-01-07T08:30Z", "2030-01-07T09:00Z");
  const after = await slot("2030-01-07T09:00Z", "2030-01-07T09:30Z");
  const legacy = await slot("2030-01-07T08:15Z", "2030-01-07T08:45Z", false);
  const bookingInput = (calendarId: number) => ({ patientId: patient.id, doctorId: doctor.id, calendarId, reason: "Preserve this appointment reason" });
  const created = await post("/appointments", bookingInput(booked.id), patientToken);
  assert.equal(created.status, 201);
  const original = await prisma.appointment.findUniqueOrThrow({ where: { id: created.body.id } });
  const terminal = await prisma.appointment.create({ data: { ...bookingInput(booked.id), status: "COMPLETED" } });
  const otherDoctor = await prisma.user.create({ data: { name: "Other", email: "otherdoctor@example.test", password: hash, role: "DOCTOR" } });
  const { id: ignoredPeriodId, ...periodData } = period;
  const otherPeriod = await prisma.schedulePeriod.create({ data: { ...periodData, doctorId: otherDoctor.id } });
  const otherSlot = await prisma.calendar.create({ data: { doctorId: otherDoctor.id, schedulePeriodId: otherPeriod.id,
    startTime: booked.startTime, endTime: booked.endTime } });
  const blockInput = { doctorId: doctor.id, startTime: "2030-01-07T08:00:00Z", endTime: "2030-01-07T09:00:00Z" };
  assert.equal((await post("/calendars/block", blockInput)).status, 401);
  for (const role of ["DOCTOR", "RECEPTIONIST", "PATIENT"]) {
    assert.equal((await post("/calendars/block", blockInput, await signIn(role.toLowerCase()+"@example.test"))).status, 403);
  }
  for (const invalid of [{ endTime: blockInput.startTime }, { startTime: "2030-01-07T08:00:00" }, { doctorId: 0 }]) {
    assert.equal((await post("/calendars/block", { ...blockInput, ...invalid }, adminToken)).status, 400);
  }
  assert.equal((await post("/calendars/block", { ...blockInput, doctorId: patient.id }, adminToken)).status, 404);
  const blocked = await post("/calendars/block", blockInput, managerToken);
  assert.equal(blocked.status, 201);
  assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id: otherSlot.id } })).isBlocked, false);
  assert.deepEqual(blocked.body, { blockedSlots: 2, appointmentsNeedingRescheduling: 1 });
  const changed = await prisma.appointment.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(changed.status, "NEEDS_RESCHEDULING");
  assert.deepEqual({ ...changed, status: original.status, updatedAt: original.updatedAt }, original);
  assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: terminal.id } })).status, "COMPLETED");
  for (const id of [before.id, after.id, legacy.id]) assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id } })).isBlocked, false);
  for (const id of [booked.id, free.id]) assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id } })).isBlocked, true);
  assert.deepEqual((await post("/calendars/block", blockInput, adminToken)).body, { blockedSlots: 0, appointmentsNeedingRescheduling: 0 });
  assert.equal((await post("/appointments", bookingInput(free.id), patientToken)).status, 409);
  const partial = await post("/calendars/block", { ...blockInput, startTime: "2030-01-07T09:15Z", endTime: "2030-01-07T09:16Z" }, adminToken);
  assert.equal(partial.body.blockedSlots, 1);
  assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id: after.id } })).isBlocked, true);
  const available = await request("GET", "/calendars?doctorId=" + doctor.id + "&isBooked=false");
  assert.ok(available.body.data.every((row: { isBlocked: boolean }) => row.isBlocked === false));

  assert.equal((await request("DELETE", "/appointments/" + original.id)).status, 409);
  assert.equal((await request("DELETE", "/users/" + patient.id)).status, 409);
  assert.equal((await request("DELETE", "/users/" + doctor.id)).status, 409);
  assert.equal((await request("DELETE", "/doctors/" + doctor.id)).status, 409);
  assert.equal((await request("PUT", "/appointments/" + terminal.id, { status: "NEEDS_RESCHEDULING", reason: "not allowed" })).status, 400);
  for (const extra of [{ doctorId: 999 }, { isBlocked: false }]) {
    assert.equal((await request("PUT", "/calendars/" + free.id, {
      startTime: free.startTime.toISOString(), endTime: free.endTime.toISOString(), isBooked: false, ...extra,
    })).status, 400);
  }
  assert.equal((await request("PUT", "/calendars/" + free.id, {
    startTime: "2030-01-07T10:00Z", endTime: "2030-01-07T10:30Z", isBooked: false,
  })).status, 409);
  assert.equal((await request("DELETE", "/calendars/" + free.id)).status, 409);
  assert.equal((await request("PUT", "/appointments/" + original.id, { status: "CANCELLED", reason: original.reason })).status, 200);
  const cancelledSlot = await prisma.calendar.findUniqueOrThrow({ where: { id: booked.id } });
  assert.equal(cancelledSlot.isBlocked, true); assert.equal(cancelledSlot.isBooked, false);

  // Deleting a cancelled record must not free a subsequent reservation.
  const reused = await slot("2030-02-01T08:00Z", "2030-02-01T08:30Z");
  const old = await post("/appointments", bookingInput(reused.id), patientToken);
  assert.equal((await request("PUT", "/appointments/" + old.body.id, { status: "CANCELLED", reason: "Patient cancelled" })).status, 200);
  const newer = await post("/appointments", bookingInput(reused.id), patientToken); assert.equal(newer.status, 201);
  assert.equal((await request("DELETE", "/appointments/" + old.body.id)).status, 200);
  assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id: reused.id } })).isBooked, true);
  // Legacy duplicate active reservations must also survive release of another.
  const duplicate = await prisma.appointment.create({ data: bookingInput(reused.id) });
  assert.equal((await request("DELETE", "/appointments/" + newer.body.id)).status, 200);
  assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id: reused.id } })).isBooked, true);
  assert.ok(await prisma.appointment.findUnique({ where: { id: duplicate.id } }));

  // Failure after flagging calendar rows must roll back the flags too.
  const rollbackSlot = await slot("2030-03-01T08:00Z", "2030-03-01T08:30Z");
  const rollbackBooking = await post("/appointments", bookingInput(rollbackSlot.id), patientToken);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_block_status() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status::text = 'NEEDS_RESCHEDULING' THEN RAISE EXCEPTION 'injected block failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER reject_block_status BEFORE UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION reject_block_status()');
  try {
    assert.equal((await post("/calendars/block", { doctorId: doctor.id, startTime: "2030-03-01T08:00Z", endTime: "2030-03-01T09:00Z" }, adminToken)).status, 500);
    assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id: rollbackSlot.id } })).isBlocked, false);
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: rollbackBooking.body.id } })).status, "CONFIRMED");
  } finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_block_status ON "Appointment"'); await prisma.$executeRawUnsafe('DROP FUNCTION reject_block_status()'); }

  async function waiters(count: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`);
      if (Number(rows[0].count) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Expected " + count + " doctor-lock waiters");
  }
  for (const bookingFirst of [true, false]) {
    const day = bookingFirst ? "2030-04-01" : "2030-04-02";
    const racing = await slot(day+"T08:00Z", day+"T08:30Z");
    let unlock!: () => void, locked!: () => void;
    const release = new Promise<void>((r) => { unlock = r; });
    const acquired = new Promise<void>((r) => { locked = r; });
    const held = prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', doctor.id); locked(); await release;
    }, { timeout: 12_000 });
    await acquired;
    const book = () => post("/appointments", bookingInput(racing.id), patientToken);
    const block = () => post("/calendars/block", { doctorId: doctor.id, startTime: day+"T08:00Z", endTime: day+"T09:00Z" }, managerToken);
    let first!: ReturnType<typeof book>, second!: ReturnType<typeof book>;
    try { first = bookingFirst ? book() : block(); await waiters(1); second = bookingFirst ? block() : book(); await waiters(2); }
    finally { unlock(); await held; }
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map((r) => r.status), bookingFirst ? [201, 201] : [201, 409]);
    assert.equal((await prisma.calendar.findUniqueOrThrow({ where: { id: racing.id } })).isBlocked, true);
    const appointments = await prisma.appointment.findMany({ where: { calendarId: racing.id } });
    assert.equal(appointments.length, bookingFirst ? 1 : 0);
    if (bookingFirst) assert.equal(appointments[0].status, "NEEDS_RESCHEDULING");
    t.diagnostic((bookingFirst ? "Booking first" : "Block first") + ": verified two lock waiters; HTTP " + results.map(r=>r.status).join("/"));
  }
  t.diagnostic("Blocking boundaries/permissions/repeat safety, preservation, cancellation, safe release, published slot protection and full rollback passed");
});
