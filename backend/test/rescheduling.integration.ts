import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Role, Specialization, type Appointment, type AppointmentStatus } from "@prisma/client";
import jwt from "jsonwebtoken";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const minute = 60_000, day = 86_400_000;

test("transactional rescheduling: eligibility, versions, history and deterministic races", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/medislot_reschedule_test");
  process.env.DATABASE_URL = url.href;
  process.env.JWT_SECRET = "rescheduling-integration-test";
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const db = app.get(PrismaService);
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
  assert.equal(await db.user.count(), 0);
  let sequence = 0;
  async function user(role: Role, specialization: Specialization | null = null) {
    return db.user.create({ data: { name: "Test " + ++sequence, email: `user${sequence}@example.test`, password: "unused", role, specialization } });
  }
  const token = (u: { id: number; role: Role }) => jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  const admin = await user(Role.ADMIN), receptionist = await user(Role.RECEPTIONIST), manager = await user(Role.MANAGER);
  const a = await user(Role.DOCTOR, Specialization.CARDIOLOGY), b = await user(Role.DOCTOR, Specialization.CARDIOLOGY);
  const wrong = await user(Role.DOCTOR, Specialization.NEUROLOGY), unknown = await user(Role.DOCTOR);
  const e = await user(Role.DOCTOR, Specialization.CARDIOLOGY), f = await user(Role.DOCTOR, Specialization.CARDIOLOGY);
  const periods = new Map<number, number>();
  for (const doctor of [a, b, wrong, unknown, e, f]) {
    const period = await db.schedulePeriod.create({ data: { doctorId: doctor.id, publishedById: admin.id,
      startDate: new Date(Date.now() - day * 3), endDate: new Date(Date.now() + day * 300),
      workingWeekdays: [1,2,3,4,5,6,7], dailyStartTime: "00:00", dailyEndTime: "23:59", slotDurationMinutes: 30,
      excludedDates: [], removedSlotIds: [] } });
    periods.set(doctor.id, period.id);
  }
  async function slot(doctorId: number, start: number, duration = 30, flags: { published?: boolean; isBlocked?: boolean; isBooked?: boolean } = {}) {
    return db.calendar.create({ data: { doctorId, startTime: new Date(start), endTime: new Date(start + duration * minute),
      schedulePeriodId: flags.published === false ? null : periods.get(doctorId)!, isBlocked: flags.isBlocked ?? false, isBooked: flags.isBooked ?? false } });
  }
  let scenario = 0;
  const future = () => Date.now() + (++scenario + 10) * day;
  async function fixture(doctorId = a.id, start = future(), status: AppointmentStatus = "CONFIRMED") {
    const patient = await user(Role.PATIENT);
    const old = await slot(doctorId, start, 30, { isBooked: true, isBlocked: status === "NEEDS_RESCHEDULING" });
    const appointment = await db.appointment.create({ data: { patientId: patient.id, doctorId, calendarId: old.id, status, reason: "Preserve original clinical reason" } });
    return { patient, old, appointment };
  }
  async function request(method: string, path: string, body?: object, actor?: { id: number; role: Role }) {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: "Bearer " + token(actor) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const move = (appointment: Pick<Appointment, "id" | "calendarId" | "version">, newCalendarId: number, actor: { id: number; role: Role }) =>
    request("POST", `/appointments/${appointment.id}/reschedule`, { currentCalendarId: appointment.calendarId, newCalendarId, expectedVersion: appointment.version }, actor);
  const book = (patient: { id: number; role: Role }, doctorId: number, calendarId: number) => request("POST", "/appointments", { patientId: patient.id, doctorId, calendarId, reason: "Ordinary booking overlap test" }, patient);
  const block = (doctorId: number, start: Date, end: Date) => request("POST", "/calendars/block", { doctorId, startTime: start.toISOString(), endTime: end.toISOString() }, admin);
  const current = (id: number) => db.appointment.findUniqueOrThrow({ where: { id } });
  const historyCount = (id: number) => db.appointmentRescheduleHistory.count({ where: { appointmentId: id } });

  // Same doctor, matching specialization, immutable clinical reason, multiple moves, ABA.
  const first = await fixture(); const target = await slot(a.id, first.old.startTime.getTime() + 2 * day);
  const moved = await move(first.appointment, target.id, first.patient);
  assert.equal(moved.status, 200); assert.equal(moved.body.id, first.appointment.id); assert.equal(moved.body.version, 2);
  assert.equal(moved.body.rescheduleCount, 1);
  assert.equal(moved.body.reason, first.appointment.reason); assert.equal(moved.body.historyEntry.reason, "PATIENT_REQUESTED");
  assert.equal(moved.body.historyEntry.actorId, first.patient.id);
  assert.ok(Math.abs(Date.parse(moved.body.historyEntry.createdAt) - Date.now()) < minute);
  assert.equal(moved.body.historyEntry.previousStartTime, first.old.startTime.toISOString());
  assert.equal(moved.body.historyEntry.newStartTime, target.startTime.toISOString());
  assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: first.old.id } })).isBooked, false);
  const returned = await move(await current(first.appointment.id), first.old.id, first.patient);
  assert.equal(returned.status, 200); assert.equal(returned.body.version, 3); assert.equal(await historyCount(first.appointment.id), 2);
  const aba = await move(first.appointment, target.id, first.patient);
  assert.equal(aba.status, 409); assert.match(aba.body.message, /Reload/); assert.equal(await historyCount(first.appointment.id), 2);
  const changed = await request("PUT", `/appointments/${first.appointment.id}`, { status: "CONFIRMED", reason: first.appointment.reason }, receptionist);
  assert.equal(changed.status, 200); assert.equal(changed.body.version, 4);
  assert.equal((await move({ ...first.appointment, version: 3 }, target.id, first.patient)).status, 409);
  const third = await move(await current(first.appointment.id), target.id, receptionist);
  assert.equal(third.status, 200); assert.equal(third.body.version, 5); assert.equal(await historyCount(first.appointment.id), 3);
  assert.equal(third.body.rescheduleCount, 3);
  assert.equal(third.body.historyEntry.actorId, receptionist.id);
  assert.deepEqual((await db.appointmentRescheduleHistory.findMany({ where: { appointmentId: first.appointment.id }, orderBy: { id: "asc" } })).map(h=>h.appointmentVersion), [2,3,5]);
  for (const path of [`/appointments/${first.appointment.id}`, `/users/${first.patient.id}`, `/users/${a.id}`, `/doctors/${a.id}`, `/users/${receptionist.id}`]) {
    assert.equal((await request("DELETE", path, undefined, admin)).status, 409, path);
  }
  const beforeCompatibility = await current(first.appointment.id);
  const compatibility = await request("PUT", `/appointments/${first.appointment.id}`, {
    status: "CONFIRMED", reason: first.appointment.reason, doctorId: b.id, calendarId: first.old.id, version: 999,
  }, receptionist);
  assert.equal(compatibility.status, 200);
  assert.equal(compatibility.body.doctorId, beforeCompatibility.doctorId);
  assert.equal(compatibility.body.calendarId, beforeCompatibility.calendarId);
  assert.equal(compatibility.body.version, beforeCompatibility.version + 1);
  assert.equal(await historyCount(first.appointment.id), 3);
  const cross = await fixture(); const matching = await slot(b.id, cross.old.startTime.getTime() + 2 * day);
  const crossResult = await move(cross.appointment, matching.id, cross.patient); assert.equal(crossResult.status, 200); assert.equal(crossResult.body.doctorId, b.id);
  t.diagnostic("Same/matching doctor moves, reason/ID preservation, history snapshots/actor, multiple entries, version/status invalidation and stale ABA passed");

  // Replacement constraints, role restrictions and ownership.
  const invalid = await fixture(); const time = invalid.old.startTime.getTime() + day * 2;
  const replacements = [await slot(wrong.id, time), await slot(unknown.id, time), await slot(a.id, time, 15),
    await slot(a.id, time, 30, { published: false }), await slot(a.id, time, 30, { isBlocked: true }),
    await slot(a.id, time, 30, { isBooked: true }), await slot(a.id, Date.now() - day)];
  for (const replacement of replacements) assert.equal((await move(invalid.appointment, replacement.id, invalid.patient)).status, 409);
  assert.equal((await move(invalid.appointment, invalid.old.id, invalid.patient)).status, 409);
  assert.equal(await historyCount(invalid.appointment.id), 0); assert.equal((await current(invalid.appointment.id)).version, 1);
  const valid = await slot(a.id, time + day);
  const otherPatient = await user(Role.PATIENT);
  for (const actor of [admin, manager, a, otherPatient]) assert.equal((await move(invalid.appointment, valid.id, actor)).status, 403);
  assert.equal((await request("POST", `/appointments/${invalid.appointment.id}/reschedule`, { currentCalendarId: invalid.old.id, newCalendarId: valid.id, expectedVersion: 1 })).status, 401);
  for (const bad of [{ expectedVersion: 0 }, { newCalendarId: -1 }, { currentCalendarId: "not-an-id" }]) {
    assert.equal((await request("POST", `/appointments/${invalid.appointment.id}/reschedule`, { currentCalendarId: invalid.old.id, newCalendarId: valid.id, expectedVersion: 1, ...bad }, invalid.patient)).status, 400);
  }
  assert.equal((await request("POST", `/appointments/${invalid.appointment.id}/reschedule`, { currentCalendarId: valid.id, newCalendarId: valid.id, expectedVersion: 1 }, invalid.patient)).status, 409);
  const missing = await fixture(unknown.id); const sameMissing = await slot(unknown.id, missing.old.startTime.getTime() + 2 * day);
  assert.equal((await move(missing.appointment, await slot(a.id, time + day * 3).then(s=>s.id), missing.patient)).status, 409);
  assert.equal((await move(missing.appointment, sameMissing.id, missing.patient)).status, 200);

  // HTTP cutoffs plus exact millisecond boundaries covered by rescheduling-policy.test.ts.
  const near = await fixture(a.id, Date.now() + 23 * 60 * minute); const later = await slot(a.id, future());
  assert.equal((await move(near.appointment, later.id, near.patient)).status, 409);
  assert.equal((await move(near.appointment, later.id, receptionist)).status, 200);
  const past = await fixture(a.id, Date.now() - day); assert.equal((await move(past.appointment, later.id, receptionist)).status, 409);
  for (const status of ["CANCELLED", "COMPLETED", "NO_SHOW"] as const) {
    const inactive = await fixture(a.id, future(), status); assert.equal((await move(inactive.appointment, valid.id, inactive.patient)).status, 409);
  }
  const receptionistRecovery = await fixture(a.id, Date.now() - day, "NEEDS_RESCHEDULING");
  const recFuture = await slot(b.id, future());
  assert.equal((await move(receptionistRecovery.appointment, recFuture.id, receptionist)).status, 200);
  const disrupted = await fixture(a.id, Date.now() - day, "NEEDS_RESCHEDULING"); const soon = await slot(a.id, Date.now() + 2 * 60 * minute);
  const recovery = await move(disrupted.appointment, soon.id, disrupted.patient);
  assert.equal(recovery.status, 200); assert.equal(recovery.body.historyEntry.reason, "DOCTOR_UNAVAILABLE");
  assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: disrupted.old.id } })).isBlocked, true);
  const laterRecovery = await slot(b.id, future());
  assert.equal((await move(await current(disrupted.appointment.id), laterRecovery.id, disrupted.patient)).status, 409);
  assert.equal((await block(a.id, soon.startTime, soon.endTime)).status, 201);
  const afterBlock = await current(disrupted.appointment.id); assert.equal(afterBlock.version, 3); assert.equal(afterBlock.status, "NEEDS_RESCHEDULING");
  assert.equal((await move({ ...afterBlock, version: 2 }, laterRecovery.id, disrupted.patient)).status, 409);
  const recoveredAgain = await move(afterBlock, laterRecovery.id, disrupted.patient);
  assert.equal(recoveredAgain.status, 200); assert.equal(recoveredAgain.body.historyEntry.reason, "DOCTOR_UNAVAILABLE"); assert.equal(await historyCount(disrupted.appointment.id), 2);
  const blockedVersion = await current(disrupted.appointment.id);
  assert.equal((await block(a.id, soon.startTime, soon.endTime)).status, 201); assert.equal((await current(disrupted.appointment.id)).version, blockedVersion.version);

  // Other CONFIRMED appointments prevent overlaps; NEEDS_RESCHEDULING does not.
  const overlap = await fixture(); const overlapStart = overlap.old.startTime.getTime() + day * 3;
  const occupied = await slot(b.id, overlapStart, 30, { isBooked: true });
  const other = await db.appointment.create({ data: { patientId: overlap.patient.id, doctorId: b.id, calendarId: occupied.id, reason: "Other confirmed visit" } });
  const overlapping = await slot(e.id, overlapStart + 10 * minute); assert.equal((await move(overlap.appointment, overlapping.id, overlap.patient)).status, 409);
  assert.equal((await book(overlap.patient, e.id, overlapping.id)).status, 409);
  await block(b.id, occupied.startTime, occupied.endTime);
  assert.equal((await current(other.id)).status, "NEEDS_RESCHEDULING");
  assert.equal((await move(overlap.appointment, overlapping.id, overlap.patient)).status, 200);
  const adjacent = await slot(f.id, overlapping.endTime.getTime()); assert.equal((await book(overlap.patient, f.id, adjacent.id)).status, 201);
  const needsOnly = await fixture(a.id, future(), "NEEDS_RESCHEDULING");
  const sameTime = await slot(b.id, needsOnly.old.startTime.getTime()); assert.equal((await book(needsOnly.patient, b.id, sameTime.id)).status, 201);
  t.diagnostic("Replacement rules, missing specialization, ownership/roles, cutoffs, recovery resets, confirmed-only overlaps and back-to-back booking passed");

  // Transaction rollback after the slot and appointment updates but before history insertion.
  const rollback = await fixture(a.id, Date.now() - day, "NEEDS_RESCHEDULING"); const rollbackTarget = await slot(b.id, future());
  const beforeAppointment = await current(rollback.appointment.id);
  const beforeCalendars = await db.calendar.findMany({ where: { id: { in: [rollback.old.id, rollbackTarget.id] } }, orderBy: { id: "asc" } });
  await db.$executeRawUnsafe(`CREATE FUNCTION reject_move_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced history failure'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER reject_move_history BEFORE INSERT ON "AppointmentRescheduleHistory" FOR EACH ROW EXECUTE FUNCTION reject_move_history()');
  try {
    assert.equal((await move(rollback.appointment, rollbackTarget.id, rollback.patient)).status, 500);
    assert.deepEqual(await current(rollback.appointment.id), beforeAppointment);
    assert.deepEqual(await db.calendar.findMany({ where: { id: { in: [rollback.old.id, rollbackTarget.id] } }, orderBy: { id: "asc" } }), beforeCalendars);
    assert.equal(await historyCount(rollback.appointment.id), 0);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER reject_move_history ON "AppointmentRescheduleHistory"'); await db.$executeRawUnsafe('DROP FUNCTION reject_move_history()'); }

  // Hold a real row lock and verify both HTTP requests reached PostgreSQL's wait queue.
  async function waiters(count: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`);
      if (Number(rows[0].count) >= count) return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error("Expected " + count + " actual lock waiters");
  }
  async function race(lockUserId: number, first: () => Promise<any>, second: () => Promise<any>, ordered = false) {
    let unlock!: () => void, locked!: () => void;
    const release = new Promise<void>(r=>{unlock=r}); const acquired = new Promise<void>(r=>{locked=r});
    const held = db.$transaction(async tx=>{await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',lockUserId);locked();await release},{timeout:15000});
    await acquired;
    let requests: Promise<any>[] = [];
    try { requests.push(first()); if(ordered)await waiters(1); requests.push(second()); await waiters(2); }
    finally { unlock(); await held; }
    return Promise.all(requests);
  }
  const contenders1 = await fixture(), contenders2 = await fixture(); const shared = await slot(b.id, future());
  const contested = await race(b.id, ()=>move(contenders1.appointment,shared.id,contenders1.patient),()=>move(contenders2.appointment,shared.id,contenders2.patient));
  assert.deepEqual(contested.map(r=>r.status).sort(),[200,409]);
  assert.equal(await historyCount(contenders1.appointment.id)+await historyCount(contenders2.appointment.id),1);
  const duplicateMove = await fixture(); const targets = [await slot(a.id,future()),await slot(a.id,future())];
  assert.deepEqual((await race(a.id,()=>move(duplicateMove.appointment,targets[0].id,duplicateMove.patient),()=>move(duplicateMove.appointment,targets[1].id,duplicateMove.patient))).map(r=>r.status).sort(),[200,409]);
  assert.equal(await historyCount(duplicateMove.appointment.id),1);

  // Opposite directions lock the same doctor IDs in ascending order, never source-first.
  const ab = await fixture(a.id), ba = await fixture(b.id); const toB = await slot(b.id,future()), toA = await slot(a.id,future());
  assert.deepEqual((await race(a.id,()=>move(ab.appointment,toB.id,ab.patient),()=>move(ba.appointment,toA.id,ba.patient))).map(r=>r.status),[200,200]);

  // Disjoint doctor sets force the patient row, not the doctor locks, to serialize overlaps.
  const patientBookings = await user(Role.PATIENT); const simultaneous = future();
  const bookE = await slot(e.id,simultaneous), bookF = await slot(f.id,simultaneous+10*minute);
  const bookings = await race(patientBookings.id,()=>book(patientBookings,e.id,bookE.id),()=>book(patientBookings,f.id,bookF.id));
  assert.deepEqual(bookings.map(r=>r.status).sort(),[201,409]);
  const patientMoves = await fixture(a.id); const secondOld = await slot(b.id,patientMoves.old.startTime.getTime()+day,30);
  await db.calendar.update({where:{id:secondOld.id},data:{isBooked:true}});
  const secondAppointment = await db.appointment.create({data:{patientId:patientMoves.patient.id,doctorId:b.id,calendarId:secondOld.id,reason:"Second move source"}});
  const simultaneousMoves = future(); const moveE = await slot(e.id,simultaneousMoves), moveF = await slot(f.id,simultaneousMoves+10*minute);
  assert.deepEqual((await race(patientMoves.patient.id,()=>move(patientMoves.appointment,moveE.id,patientMoves.patient),()=>move(secondAppointment,moveF.id,patientMoves.patient))).map(r=>r.status).sort(),[200,409]);
  const mixed = await fixture(a.id); const mixedTime = future(); const mixedE = await slot(e.id,mixedTime), mixedF = await slot(f.id,mixedTime+10*minute);
  const mixedResults = await race(mixed.patient.id,()=>move(mixed.appointment,mixedE.id,mixed.patient),()=>book(mixed.patient,f.id,mixedF.id));
  assert.equal(mixedResults.filter(r=>r.status===409).length,1); assert.equal(mixedResults.filter(r=>r.status===200||r.status===201).length,1);
  t.diagnostic("Verified lock waiters: competing replacement, same-appointment moves, opposite-direction moves, overlapping bookings/moves and booking-versus-move passed");

  for (const moveFirst of [true,false]) {
    const original = await fixture(a.id); const replacement = await slot(b.id,future());
    const moving = ()=>move(original.appointment,replacement.id,original.patient);
    const blocking = ()=>block(b.id,replacement.startTime,replacement.endTime);
    const results = await race(b.id,moveFirst?moving:blocking,moveFirst?blocking:moving,true);
    assert.deepEqual(results.map(r=>r.status),moveFirst?[200,201]:[201,409]);
    const saved=await current(original.appointment.id);
    assert.equal(saved.status,moveFirst?"NEEDS_RESCHEDULING":"CONFIRMED");assert.equal(saved.version,moveFirst?3:1);
    assert.equal(await historyCount(saved.id),moveFirst?1:0);
  }
  const disruptedRace = await fixture(a.id); const disruptedRaceTarget = await slot(b.id,future());
  const oldBlockRace = await race(a.id,()=>block(a.id,disruptedRace.old.startTime,disruptedRace.old.endTime),()=>move(disruptedRace.appointment,disruptedRaceTarget.id,disruptedRace.patient),true);
  assert.deepEqual(oldBlockRace.map(r=>r.status),[201,409]);assert.equal((await current(disruptedRace.appointment.id)).version,2);
  for(const moveFirst of [true,false]){
    const source=await fixture(a.id);const destination=await slot(b.id,future());
    const moving=()=>move(source.appointment,destination.id,source.patient);
    const cancelling=()=>request("PUT",`/appointments/${source.appointment.id}`,{status:"CANCELLED",reason:"Existing cancellation policy"},receptionist);
    const results=await race(a.id,moveFirst?moving:cancelling,moveFirst?cancelling:moving,true);
    assert.deepEqual(results.map(r=>r.status),[200,409]);assert.equal(await historyCount(source.appointment.id),moveFirst?1:0);
  }
  for (const moveFirst of [true,false]) {
    const source=await fixture(a.id); const destination=await slot(b.id,future());
    const moving=()=>move(source.appointment,destination.id,source.patient);
    const deleting=()=>request("DELETE",`/appointments/${source.appointment.id}`,undefined,admin);
    const results=await race(a.id,moveFirst?moving:deleting,moveFirst?deleting:moving,true);
    assert.deepEqual(results.map(r=>r.status),moveFirst?[200,409]:[200,404]);
    assert.equal(await historyCount(source.appointment.id),moveFirst?1:0);
    assert.equal((await db.calendar.findUniqueOrThrow({where:{id:destination.id}})).isBooked,moveFirst);
  }
  t.diagnostic("Target blocking in both orders, source blocking invalidation, cancellation/deletion races, old-block preservation, history rollback and audit deletion protection passed");
});
