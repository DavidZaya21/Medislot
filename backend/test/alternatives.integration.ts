import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Role, Specialization, type AppointmentStatus } from "@prisma/client";
import jwt from "jsonwebtoken";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const minute = 60_000;
test("alternatives HTTP: eligibility, ranking, Warsaw windows, permissions, anchoring and read-only behavior", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/medislot_alternatives_test");
  process.env.DATABASE_URL = url.href; process.env.JWT_SECRET = "alternatives-test";
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const db = app.get(PrismaService);
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
  assert.equal(await db.user.count(), 0);
  let seq = 0;
  async function user(role: Role, specialization: Specialization | null = null) {
    return db.user.create({ data: { role, specialization, name: "Synthetic " + ++seq, email: `alternatives${seq}@example.test`, password: "unused" } });
  }
  const admin = await user(Role.ADMIN), rec = await user(Role.RECEPTIONIST), manager = await user(Role.MANAGER);
  const a = await user(Role.DOCTOR, Specialization.CARDIOLOGY), b = await user(Role.DOCTOR, Specialization.CARDIOLOGY), c = await user(Role.DOCTOR, Specialization.CARDIOLOGY);
  const wrong = await user(Role.DOCTOR, Specialization.NEUROLOGY), unknown = await user(Role.DOCTOR);
  const periods = new Map<number, number>();
  for (const doctor of [a,b,c,wrong,unknown]) periods.set(doctor.id, (await db.schedulePeriod.create({ data: {
    doctorId: doctor.id, publishedById: admin.id, startDate: new Date("1999-01-01"), endDate: new Date("2035-12-31"),
    workingWeekdays: [1,2,3,4,5,6,7], dailyStartTime: "00:00", dailyEndTime: "23:59", slotDurationMinutes: 30, excludedDates: [], removedSlotIds: [],
  } })).id);
  async function slot(doctorId: number, start: string, duration = 30, flags: { booked?: boolean; blocked?: boolean; manual?: boolean } = {}) {
    return db.calendar.create({ data: { doctorId, startTime: new Date(start), endTime: new Date(Date.parse(start) + duration * minute),
      isBooked: !!flags.booked, isBlocked: !!flags.blocked, schedulePeriodId: flags.manual ? null : periods.get(doctorId)! } });
  }
  async function fixture(doctorId: number, start: string, status: AppointmentStatus = "NEEDS_RESCHEDULING") {
    const patient = await user(Role.PATIENT);
    const old = await slot(doctorId, start, 30, { booked: true, blocked: status === "NEEDS_RESCHEDULING" });
    const appointment = await db.appointment.create({ data: { patientId: patient.id, doctorId, calendarId: old.id, status, reason: "Synthetic disrupted appointment" } });
    return { patient, old, appointment };
  }
  type Actor = { id: number; role: Role };
  async function request(path: string, actor?: Actor, body?: object) {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(actor ? { Authorization: "Bearer " + jwt.sign({ authVersion: 1, sub: actor.id, role: actor.role }, process.env.JWT_SECRET!, { expiresIn: "1h" }) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }
  const alternatives = (id: number, actor?: Actor) => request(`/appointments/${id}/alternatives`, actor);
  const f = await fixture(a.id, "2030-01-07T10:00:00Z");
  const earlyB1 = await slot(b.id, "2030-01-07T09:45:00Z"), earlyC = await slot(c.id, "2030-01-07T09:45:00Z"), earlyB2 = await slot(b.id, "2030-01-07T09:45:00Z");
  await slot(b.id, "2030-01-07T10:15:00Z");
  const closest = await slot(c.id, "2030-01-07T09:55:00Z");
  const later1 = await slot(a.id, "2030-01-08T08:00:00Z"), later2 = await slot(a.id, "2030-01-08T08:00:00Z"), later3 = await slot(a.id, "2030-01-08T09:00:00Z");
  await slot(a.id, "2030-01-09T08:00:00Z");
  for (const bad of [
    await slot(wrong.id, "2030-01-07T10:00:00Z"), await slot(unknown.id, "2030-01-07T10:00:00Z"),
    await slot(b.id, "2030-01-07T10:00:00Z", 15), await slot(b.id, "2030-01-07T10:00:00Z", 30, { blocked: true }),
    await slot(b.id, "2030-01-07T10:00:00Z", 30, { booked: true }), await slot(b.id, "2030-01-07T10:00:00Z", 30, { manual: true }),
  ]) assert.ok(bad.id);
  const before = JSON.stringify(await Promise.all([db.appointment.findMany({ orderBy: { id: "asc" } }), db.calendar.findMany({ orderBy: { id: "asc" } }), db.appointmentRescheduleHistory.findMany()]));
  const result = await alternatives(f.appointment.id, f.patient); assert.equal(result.status, 200);
  assert.deepEqual(result.body.keepYourDay.map((s: { id: number }) => s.id), [closest.id, earlyB1.id, earlyB2.id]);
  assert.deepEqual(result.body.keepYourDoctor.map((s: { id: number }) => s.id), [later1.id, later2.id, later3.id]);
  assert.equal(result.body.appointment.version, 1); assert.equal(result.body.appointment.calendarId, f.old.id);
  assert.deepEqual(result.body.window, { startDate: "2030-01-07", endDate: "2030-01-21", timeZone: "Europe/Warsaw" });
  assert.equal(before, JSON.stringify(await Promise.all([db.appointment.findMany({ orderBy: { id: "asc" } }), db.calendar.findMany({ orderBy: { id: "asc" } }), db.appointmentRescheduleHistory.findMany()])));
  await db.calendar.update({ where: { id: closest.id }, data: { isBlocked: true } });
  for (let i = 0; i < 2; i++) assert.deepEqual((await alternatives(f.appointment.id, rec)).body.keepYourDay.map((s: { id: number }) => s.id), [earlyB1.id, earlyB2.id, earlyC.id]);
  const outsider = await user(Role.PATIENT);
  for (const actor of [outsider, a, admin]) {
    const denied = await alternatives(f.appointment.id, actor); assert.equal(denied.status, 403); assert.deepEqual(Object.keys(denied.body).sort(), ["code", "message"]);
  }
  assert.equal((await alternatives(f.appointment.id, manager)).status, 200);
  assert.equal((await alternatives(f.appointment.id)).status, 401);
  assert.equal((await request('/appointments/not-a-number/alternatives', rec)).status, 400);
  assert.equal((await alternatives(2147483647, rec)).status, 404);
  for (const status of ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const) {
    const other = await fixture(a.id, "2030-02-01T10:00:00Z", status);
    assert.equal((await alternatives(other.appointment.id, other.patient)).status, 409);
  }
  t.diagnostic("HTTP 200/400/401/403/404/409, independent 3-slot limits, proximity and deterministic ties; exact before/after read-only snapshots passed");

  // A CONFIRMED conflict excludes intersections only; NEEDS_RESCHEDULING does not.
  const conflict = await fixture(a.id, "2030-02-10T10:00:00Z");
  const conflictSlot = await slot(wrong.id, "2030-02-10T10:00:00Z", 30, { booked: true });
  await db.appointment.create({ data: { patientId: conflict.patient.id, doctorId: wrong.id, calendarId: conflictSlot.id, status: "CONFIRMED", reason: "Confirmed conflict" } });
  const beforeVisit = await slot(b.id, "2030-02-10T09:30:00Z"), afterVisit = await slot(b.id, "2030-02-10T10:30:00Z");
  await slot(b.id, "2030-02-10T09:45:00Z"); await slot(b.id, "2030-02-10T10:15:00Z");
  assert.deepEqual((await alternatives(conflict.appointment.id, conflict.patient)).body.keepYourDay.map((s: { id: number }) => s.id), [beforeVisit.id, afterVisit.id]);
  await db.appointment.updateMany({ where: { patientId: conflict.patient.id, calendarId: conflictSlot.id }, data: { status: "NEEDS_RESCHEDULING" } });
  assert.equal((await alternatives(conflict.appointment.id, conflict.patient)).body.keepYourDay.length, 3);
  const missing = await fixture(unknown.id, "2030-02-20T10:00:00Z");
  await slot(b.id, "2030-02-20T10:00:00Z"); const missingSame = await slot(unknown.id, "2030-02-21T10:00:00Z");
  const missingResult = await alternatives(missing.appointment.id, missing.patient);
  assert.deepEqual(missingResult.body.keepYourDay, []); assert.deepEqual(missingResult.body.keepYourDoctor.map((s: { id: number }) => s.id), [missingSame.id]);

  // Check actual UTC instants on both 23-hour and 25-hour Warsaw dates.
  for (const [anchor, midnight, lastSameDay, nextMidnight, lastDay14, day15] of [
    ["2030-03-30T23:30:00Z", "2030-03-30T23:00:00Z", "2030-03-31T21:30:00Z", "2030-03-31T22:00:00Z", "2030-04-14T21:30:00Z", "2030-04-14T22:00:00Z"],
    ["2030-10-26T22:30:00Z", "2030-10-26T22:00:00Z", "2030-10-27T22:30:00Z", "2030-10-27T23:00:00Z", "2030-11-10T22:30:00Z", "2030-11-10T23:00:00Z"],
  ]) {
    const dst = await fixture(a.id, anchor);
    const first = await slot(b.id, midnight), last = await slot(b.id, lastSameDay);
    await slot(b.id, nextMidnight); await slot(b.id, new Date(Date.parse(midnight) - 30 * minute).toISOString());
    const next = await slot(a.id, nextMidnight), end = await slot(a.id, lastDay14);
    const beyond = await slot(a.id, day15); await slot(a.id, lastSameDay); // Same day/current doctor is manual only.
    const response = await alternatives(dst.appointment.id, dst.patient);
    assert.deepEqual(response.body.keepYourDay.map((s: { id: number }) => s.id), [first.id, last.id]);
    assert.deepEqual(response.body.keepYourDoctor.map((s: { id: number }) => s.id), [next.id, end.id]);
    const manual = await request(`/appointments/${dst.appointment.id}/reschedule-options`, dst.patient);
    assert.ok(manual.body.data.some((s: { id: number }) => s.id === beyond.id));
  }
  const past = await fixture(a.id, "2000-01-01T10:00:00Z");
  const pastResult = await alternatives(past.appointment.id, past.patient);
  assert.deepEqual(pastResult.body.keepYourDay, []); assert.deepEqual(pastResult.body.keepYourDoctor, []);
  assert.ok((await request(`/appointments/${past.appointment.id}/reschedule-options`, past.patient)).body.data.length > 0);
  // Partly elapsed window: old date is yesterday, but future day-1 recovery remains usable.
  const recent = await fixture(a.id, new Date(Date.now() - 86_400_000).toISOString());
  const future = await slot(a.id, new Date(Date.now() + 86_400_000).toISOString());
  const expired = await slot(b.id, new Date(Date.now() - 3_600_000).toISOString());
  const recentResult = await alternatives(recent.appointment.id, recent.patient);
  assert.ok(recentResult.body.keepYourDoctor.some((s: { id: number }) => s.id === future.id));
  assert.equal(recentResult.body.keepYourDay.some((s: { id: number }) => s.id === expired.id), false);
  t.diagnostic("Duration/specialization, null specialization same-doctor, CONFIRMED-only conflicts, back-to-back visits, future filtering, DST/date boundaries, inclusive day 14 and elapsed windows passed");

  // Move, disrupt again, and prove the new doctor/time is the anchor, not the history's first slot.
  const moved = await request(`/appointments/${f.appointment.id}/reschedule`, f.patient, { currentCalendarId: f.old.id, expectedVersion: 1, newCalendarId: earlyB1.id });
  assert.equal(moved.status, 200);
  const blocked = await request('/calendars/block', admin, { doctorId: b.id, startTime: earlyB1.startTime.toISOString(), endTime: earlyB1.endTime.toISOString() }); assert.equal(blocked.status, 201);
  const nextB = await slot(b.id, "2030-01-09T09:00:00Z");
  const anchored = await alternatives(f.appointment.id, f.patient);
  assert.equal(anchored.body.appointment.doctorId, b.id); assert.equal(anchored.body.appointment.calendarId, earlyB1.id); assert.equal(anchored.body.appointment.version, 3);
  assert.ok(anchored.body.keepYourDoctor.some((s: { id: number }) => s.id === nextB.id));
  assert.ok(anchored.body.keepYourDoctor.every((s: { doctorId: number }) => s.doctorId === b.id));
  assert.equal(await db.appointmentRescheduleHistory.count({ where: { appointmentId: f.appointment.id } }), 1);
  t.diagnostic("Previously moved and newly disrupted appointment anchors recommendations to current doctor/calendar/version; history unchanged");
});
