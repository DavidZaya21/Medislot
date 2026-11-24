import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Role, type AppointmentStatus } from "@prisma/client";
import jwt from "jsonwebtoken";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const minute = 60_000;
test("initial booking alternatives: same-doctor ranking, eligibility, identity, privacy, DST and read-only retrieval", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/medislot_booking_alternatives_test");
  process.env.DATABASE_URL = url.href; process.env.JWT_SECRET = "booking-alternatives-test";
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false }); const db = app.get(PrismaService);
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
  assert.equal(await db.user.count(), 0); let seq = 0;
  async function user(role: Role) { return db.user.create({ data: { role, name: "Synthetic " + ++seq, email: `booking-alt${seq}@example.test`, password: "unused" } }); }
  const admin = await user(Role.ADMIN), rec = await user(Role.RECEPTIONIST), manager = await user(Role.MANAGER);
  const a = await user(Role.DOCTOR), b = await user(Role.DOCTOR), patient = await user(Role.PATIENT), other = await user(Role.PATIENT);
  const periods = new Map<number, number>();
  for (const d of [a,b]) periods.set(d.id, (await db.schedulePeriod.create({ data: { doctorId: d.id, publishedById: admin.id,
    startDate: new Date("1999-01-01"), endDate: new Date("2035-12-31"), workingWeekdays: [1,2,3,4,5,6,7], dailyStartTime: "00:00", dailyEndTime: "23:59", slotDurationMinutes: 30, excludedDates: [], removedSlotIds: [] } })).id);
  async function slot(start: string, flags: { doctorId?: number; duration?: number; booked?: boolean; blocked?: boolean; manual?: boolean } = {}) {
    const doctorId = flags.doctorId ?? a.id;
    return db.calendar.create({ data: { doctorId, startTime: new Date(start), endTime: new Date(Date.parse(start) + (flags.duration ?? 30) * minute),
      isBooked: !!flags.booked, isBlocked: !!flags.blocked, schedulePeriodId: flags.manual ? null : periods.get(doctorId)! } });
  }
  async function appointment(patientId: number, calendar: Awaited<ReturnType<typeof slot>>, status: AppointmentStatus = "CONFIRMED") {
    return db.appointment.create({ data: { patientId, calendarId: calendar.id, doctorId: calendar.doctorId, status, reason: "PRIVATE OTHER PATIENT VISIT" } });
  }
  type Actor = { id: number; role: Role };
  async function request(path: string, actor?: Actor, body?: object) {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(actor ? { Authorization: "Bearer " + jwt.sign({ authVersion: 1, sub: actor.id, role: actor.role }, process.env.JWT_SECRET!, { expiresIn: "1h" }) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }
  const original = await slot("2030-01-07T10:00:00Z", { booked: true }); await appointment(other.id, original);
  const early1 = await slot("2030-01-07T09:45:00Z"), early2 = await slot("2030-01-07T09:45:00Z"), late = await slot("2030-01-07T10:15:00Z");
  await slot("2030-01-07T11:00:00Z");
  const later1 = await slot("2030-01-08T09:00:00Z"), later2 = await slot("2030-01-08T09:00:00Z"), later3 = await slot("2030-01-09T09:00:00Z"); await slot("2030-01-10T09:00:00Z");
  for (const flags of [{ doctorId: b.id }, { duration: 15 }, { blocked: true }, { booked: true }, { manual: true }]) await slot("2030-01-07T10:00:00Z", flags);
  const path = `/calendars/${original.id}/alternatives`;
  const snapshot = async () => JSON.stringify(await Promise.all([db.calendar.findMany({ orderBy: { id: "asc" } }),db.appointment.findMany({ orderBy: { id: "asc" } }),db.appointmentRescheduleHistory.findMany()]));
  const before = await snapshot();
  for (const actor of [patient,rec,admin]) {
    const response = await request(path + (actor.role === "PATIENT" ? `?patientId=${other.id}` : `?patientId=${patient.id}`), actor);
    assert.equal(response.status, 200); assert.equal(response.body.patientId, patient.id);
    assert.deepEqual(response.body.sameDay.map((s: { id: number }) => s.id), [early1.id, early2.id, late.id]);
    assert.deepEqual(response.body.laterDates.map((s: { id: number }) => s.id), [later1.id,later2.id,later3.id]);
    assert.equal(response.body.requestedSlot.id, original.id); assert.equal(response.body.requestedSlot.doctorId, a.id);
    const serialized = JSON.stringify(response.body); assert.equal(serialized.includes(other.email), false); assert.equal(serialized.includes("PRIVATE OTHER PATIENT VISIT"), false);
    assert.equal("appointments" in response.body.requestedSlot, false); assert.equal("password" in response.body.requestedSlot.doctor.user, false);
  }
  assert.equal(await snapshot(), before); assert.equal(await db.appointment.count({ where: { patientId: patient.id } }), 0);
  for (const actor of [manager,a]) assert.equal((await request(path+`?patientId=${patient.id}`,actor)).status,403);
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path,rec)).status,400);
  for (const value of ['0','-1','abc','2147483648']) assert.equal((await request(path+'?patientId='+value,rec)).status,400);
  assert.equal((await request(path+`?patientId=${a.id}`,admin)).status,404);
  assert.equal((await request('/calendars/2147483647/alternatives',patient)).status,404);
  assert.equal((await request('/calendars/invalid/alternatives',patient)).status,400);
  // Client-supplied doctor/duration/time cannot alter the derived anchor or eligibility.
  const derived = await request(path+`?doctorId=${b.id}&duration=15&startTime=1999-01-01`,patient);
  assert.deepEqual(derived.body.sameDay.map((s: { id: number }) => s.id),[early1.id,early2.id,late.id]);
  t.diagnostic("Patient identity overrides query, authorized staff/denied roles, privacy, derived anchor, independent caps and deterministic ties; exact read-only snapshot passed");

  const conflictOriginal = await slot("2030-02-10T10:00:00Z",{booked:true});
  const conflict = await slot("2030-02-10T10:00:00Z",{doctorId:b.id,booked:true}); const appConflict = await appointment(patient.id,conflict);
  const beforeVisit = await slot("2030-02-10T09:30:00Z"), afterVisit = await slot("2030-02-10T10:30:00Z");
  await slot("2030-02-10T09:45:00Z"); await slot("2030-02-10T10:15:00Z");
  const conflictPath=`/calendars/${conflictOriginal.id}/alternatives`;
  assert.deepEqual((await request(conflictPath,patient)).body.sameDay.map((s: { id: number })=>s.id),[beforeVisit.id,afterVisit.id]);
  // A spoofed patientId must not use the other patient's conflict-free schedule.
  assert.deepEqual((await request(conflictPath+`?patientId=${other.id}`,patient)).body.sameDay.map((s: { id: number })=>s.id),[beforeVisit.id,afterVisit.id]);
  await db.appointment.update({where:{id:appConflict.id},data:{status:"NEEDS_RESCHEDULING"}});
  assert.equal((await request(conflictPath,patient)).body.sameDay.length,3);

  for (const [anchor,first,last,next,end,beyond] of [
    ['2030-03-30T23:30:00Z','2030-03-30T23:00:00Z','2030-03-31T21:30:00Z','2030-03-31T22:00:00Z','2030-04-14T21:30:00Z','2030-04-14T22:00:00Z'],
    ['2030-10-26T22:30:00Z','2030-10-26T22:00:00Z','2030-10-27T22:30:00Z','2030-10-27T23:00:00Z','2030-11-10T22:30:00Z','2030-11-10T23:00:00Z'],
  ]) {
    const source = await slot(anchor,{booked:true});const firstSlot = await slot(first),lastSlot = await slot(last),nextSlot = await slot(next),endSlot = await slot(end);await slot(beyond);
    await slot(new Date(Date.parse(first)-1800000).toISOString());
    const response = await request(`/calendars/${source.id}/alternatives`,patient);
    assert.deepEqual(response.body.sameDay.map((s: { id: number })=>s.id),[firstSlot.id,lastSlot.id]);
    assert.deepEqual(response.body.laterDates.map((s: { id: number })=>s.id),[nextSlot.id,endSlot.id]);
  }
  const past = await slot('2000-01-01T10:00:00Z',{booked:true});const pastResponse = await request(`/calendars/${past.id}/alternatives`,patient);
  assert.deepEqual(pastResponse.body.sameDay,[]);assert.deepEqual(pastResponse.body.laterDates,[]);
  const recent = await slot(new Date(Date.now()-86400000).toISOString(),{booked:true}); const future = await slot(new Date(Date.now()+3600000).toISOString());
  await slot(new Date(Date.now()-3600000).toISOString());
  const partial = await request(`/calendars/${recent.id}/alternatives`,patient);
  assert.ok([...partial.body.sameDay,...partial.body.laterDates].some((s: { id: number })=>s.id===future.id));
  assert.ok([...partial.body.sameDay,...partial.body.laterDates].every((s: { startTime: string })=>Date.parse(s.startTime)>Date.now()));
  const overlapResult = await request('/appointments',patient,{patientId:patient.id,doctorId:b.id,calendarId:conflict.id,reason:'Valid booking reason'});
  assert.equal(overlapResult.body.code,'SLOT_UNAVAILABLE'); // Already-booked slots remain a recognizable availability failure.
  const freeOverlap = await slot(conflict.startTime.toISOString(),{doctorId:b.id});
  await db.appointment.update({where:{id:appConflict.id},data:{status:'CONFIRMED'}});
  const unrelated = await request('/appointments',patient,{patientId:patient.id,doctorId:b.id,calendarId:freeOverlap.id,reason:'Valid booking reason'});
  assert.equal(unrelated.status,409);assert.equal(unrelated.body.code,'CONFLICT');
  const invalid = await request('/appointments',patient,{patientId:patient.id,doctorId:a.id,calendarId:early1.id,reason:'x'});assert.equal(invalid.status,400);
  assert.equal(await db.appointmentRescheduleHistory.count(),0);
  t.diagnostic("Duration, original exclusion, same doctor with null specialization, CONFIRMED-only overlap/back-to-back, Warsaw DST and inclusive day 14, expired/partial windows, and distinct non-availability error codes passed");
});
