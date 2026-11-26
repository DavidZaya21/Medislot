import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import jwt from "jsonwebtoken";
import { Role, type AppointmentStatus } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

test("manager appointment reads do not grant ordinary mutations", async t => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/medislot_manager_test");
  process.env.DATABASE_URL = url.href; process.env.JWT_SECRET = "manager-test";
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0, "127.0.0.1"); const base = await app.getUrl(), db = app.get(PrismaService);
  t.after(() => app.close());
  let seq = 0;
  const user = (role: Role) => db.user.create({ data: { name: "Synthetic " + ++seq, email: `manager-test-${seq}@example.test`, password: "not-a-login-hash", role, phone: role === "PATIENT" ? "+48123456789" : null, specialization: role === "DOCTOR" ? "ENT" : null } });
  const manager = await user(Role.MANAGER), admin = await user(Role.ADMIN), patient = await user(Role.PATIENT), other = await user(Role.PATIENT), doctor = await user(Role.DOCTOR), otherDoctor = await user(Role.DOCTOR);
  const period = await db.schedulePeriod.create({ data: { doctorId: doctor.id, publishedById: admin.id, startDate: new Date("2037-01-01"), endDate: new Date("2037-12-31"), workingWeekdays: [1], dailyStartTime: "08:00", dailyEndTime: "17:00", slotDurationMinutes: 30, excludedDates: [], removedSlotIds: [] } });
  let day = 0;
  const slot = (d = doctor) => { const start = Date.parse("2037-02-01T10:00Z") + ++day * 86400000; return db.calendar.create({ data: { doctorId: d.id, schedulePeriodId: period.id, startTime: new Date(start), endTime: new Date(start + 1800000) } }); };
  async function fixture(status: AppointmentStatus = "CONFIRMED", p = patient, d = doctor) {
    const c = await slot(d); await db.calendar.update({ where: { id: c.id }, data: { isBooked: true, isBlocked: status === "NEEDS_RESCHEDULING" } });
    return db.appointment.create({ data: { patientId: p.id, doctorId: d.id, calendarId: c.id, status, reason: "Synthetic visit reason" } });
  }
  type Actor = { id: number; role: Role };
  async function request(method: string, path: string, actor: Actor | undefined = manager, body?: object) {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: "Bearer " + jwt.sign({ sub: actor.id, role: actor.role, authVersion: 1 }, "manager-test") } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  const normal = await fixture(), foreign = await fixture("CONFIRMED", other, otherDoctor);
  const identity = (a: { calendarId: number; version: number }) => ({ currentCalendarId: a.calendarId, expectedVersion: a.version });
  const minimal = (a: any) => {
    assert.deepEqual(Object.keys(a.patient).sort(), ["closedAt", "id", "name"]);
    assert.deepEqual(Object.keys(a.doctor).sort(), ["id", "specialization", "user", "userId"]);
    assert.deepEqual(Object.keys(a.doctor.user).sort(), ["id", "name"]);
    for (const key of ["password", "phone", "email", "authVersion", "closureRequestId"]) assert.equal(JSON.stringify(a).includes('"' + key + '"'), false);
  };
  const list = await request("GET", "/appointments"); assert.equal(list.status, 200); assert.deepEqual(list.body.data.map((a: any) => a.id), [normal.id, foreign.id]); list.body.data.forEach(minimal);
  const detail = await request("GET", `/appointments/${foreign.id}`); assert.equal(detail.status, 200); minimal(detail.body); assert.equal(detail.body.reason, foreign.reason);
  assert.equal((await request("GET", "/appointments?status=INVALID")).status, 400);
  for (const status of ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "NEEDS_RESCHEDULING"] as const) { const r = await request("GET", "/appointments?status=" + status); assert.equal(r.status, 200); assert.ok(r.body.data.every((a: any) => a.status === status)); }
  const schedule = await request("GET", "/calendars?isBooked=true"); assert.equal(schedule.status, 200);
  for (const slot of schedule.body.data) assert.deepEqual(Object.keys(slot.doctor.user).sort(), ["id", "name"]);
  assert.equal((await request("GET", `/calendars/${normal.calendarId}`)).status, 200);
  assert.equal((await fetch(base + "/appointments")).status, 401);
  assert.equal((await request("GET", `/users/${manager.id}`)).status, 200);
  assert.equal((await request("GET", `/appointments/${normal.id}`, patient)).status, 200);
  assert.equal((await request("GET", `/appointments/${normal.id}`, other)).status, 403);
  assert.equal((await request("GET", `/users/${patient.id}/appointments`, other)).status, 403);
  assert.equal((await request("GET", `/appointments/${normal.id}`, doctor)).status, 200);
  assert.equal((await request("GET", `/appointments/${normal.id}`, otherDoctor)).status, 403);
  const assigned = await request("GET", "/appointments", doctor); assert.ok(assigned.body.data.every((a: any) => a.doctorId === doctor.id)); assert.equal(assigned.body.data.length, 1);
  assert.equal((await request("GET", "/appointments", patient)).status, 403);
  const replacement = await slot();
  const denied: [string, string, object?][] = [
    ["POST", "/appointments", { patientId: patient.id, doctorId: doctor.id, calendarId: replacement.id, reason: "Unauthorized booking" }],
    ...["CANCELLED", "COMPLETED", "NO_SHOW"].map(status => ["PUT", `/appointments/${normal.id}`, { ...identity(normal), status }] as [string, string, object]),
    ["POST", `/appointments/${normal.id}/reschedule`, { ...identity(normal), newCalendarId: replacement.id }],
    ["DELETE", `/appointments/${normal.id}`], ["POST", "/calendars", { doctorId: doctor.id, startTime: "2037-12-01T10:00Z", endTime: "2037-12-01T10:30Z" }],
    ["PUT", `/calendars/${replacement.id}`, { startTime: "2037-12-01T10:00Z" }], ["DELETE", `/calendars/${replacement.id}`],
    ["POST", "/doctors", {}], ["POST", "/receptionists", {}], ["POST", "/managers", {}],
    ["PUT", `/users/${patient.id}`, { name: "Denied" }], ["PUT", `/users/${manager.id}`, { name: "Denied" }], ["DELETE", `/users/${patient.id}`],
    ["PUT", `/doctors/${doctor.id}`, { specialization: "ENT" }], ["DELETE", `/doctors/${doctor.id}`],
    ["POST", "/users/me/close", { currentPassword: "irrelevant", confirmed: true, requestId: "00000000-0000-4000-8000-000000000001" }],
  ];
  const before = JSON.stringify(await db.appointment.findMany({ orderBy: { id: "asc" } }));
  for (const [method, path, body] of denied) assert.equal((await request(method, path, manager, body)).status, 403, method + " " + path);
  assert.equal(JSON.stringify(await db.appointment.findMany({ orderBy: { id: "asc" } })), before);
  assert.equal((await request("GET", "/users")).status, 403); assert.equal((await request("GET", `/users/${patient.id}`)).status, 403);
  console.log("PASS manager clinic-wide list/detail/status filters, minimal payloads, schedule reads, patient/doctor scope and 18 forbidden mutations");
  const broken = await fixture(); const c = await db.calendar.findUniqueOrThrow({ where: { id: broken.calendarId } });
  assert.equal((await request("POST", "/calendars/block", manager, { doctorId: doctor.id, startTime: c.startTime.toISOString(), endTime: c.endTime.toISOString() })).status, 201);
  const disrupted = (await request("GET", `/appointments/${broken.id}`)).body; minimal(disrupted); assert.ok(disrupted.disruption);
  for (const extra of [{}, { legacyDisruption: true }]) assert.equal((await request("PUT", `/appointments/${broken.id}`, manager, { ...identity(disrupted), ...extra, status: "CANCELLED" })).status, 409);
  assert.equal((await request("PUT", `/appointments/${broken.id}`, manager, { ...identity(broken), ...disrupted.disruption, status: "CANCELLED" })).status, 409);
  const cancelled = await request("PUT", `/appointments/${broken.id}`, manager, { ...identity(disrupted), ...disrupted.disruption, status: "CANCELLED" }); assert.equal(cancelled.status, 200); minimal(cancelled.body);
  assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: c.id } })).isBlocked, true);
  const legacy = await fixture("NEEDS_RESCHEDULING"); assert.equal((await request("PUT", `/appointments/${legacy.id}`, manager, { ...identity(legacy), expectedVersion: 2, legacyDisruption: true, status: "CANCELLED" })).status, 409);
  assert.equal((await request("PUT", `/appointments/${legacy.id}`, manager, { ...identity(legacy), legacyDisruption: true, status: "CANCELLED" })).status, 200);
  const recovery = await fixture("NEEDS_RESCHEDULING"), newSlot = await slot(); assert.equal((await request("GET", `/appointments/${recovery.id}/reschedule-options`)).status, 200);
  assert.equal((await request("POST", `/appointments/${recovery.id}/reschedule`, manager, { ...identity(recovery), expectedVersion: 2, newCalendarId: newSlot.id })).status, 409);
  const move = await request("POST", `/appointments/${recovery.id}/reschedule`, manager, { ...identity(recovery), newCalendarId: newSlot.id }); assert.equal(move.status, 200); minimal(move.body);
  assert.equal(move.body.id, recovery.id); assert.equal(move.body.status, "CONFIRMED"); assert.equal(move.body.version, 2); assert.equal(move.body.rescheduleCount, 1);
  assert.equal((await request("POST", `/appointments/${recovery.id}/reschedule`, manager, { ...identity(move.body), newCalendarId: replacement.id })).status, 403);
  const old = await db.calendar.findUniqueOrThrow({ where: { id: recovery.calendarId } }); assert.equal(old.isBlocked, true); assert.equal(old.isBooked, false);
  assert.equal(await db.appointmentRescheduleHistory.count({ where: { appointmentId: recovery.id } }), 1);
  for (const status of ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "NEEDS_RESCHEDULING"] as const) {
    await fixture(status);
    const filtered = await request("GET", "/appointments?status=" + status);
    assert.equal(filtered.status, 200);
    const expected = await db.appointment.findMany({ where: { status }, orderBy: { id: "asc" }, select: { id: true } });
    assert.deepEqual(filtered.body.data.map((a: any) => a.id), expected.map(a => a.id));
    assert.ok(filtered.body.data.length > 0);
  }
  console.log("PASS notification-backed and legacy cancellation, disrupted recovery, stale version rejection, reservation/block preservation; ordinary move remains forbidden after recovery");
});
