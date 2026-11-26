import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { Role, type AppointmentStatus } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { AppointmentLifecycle } from "../src/common/appointment-lifecycle";
import { EmailWorker } from "../src/email/worker";
import { MailpitTransport } from "../src/email/mailpit-transport";

test("appointment lifecycle: exact boundaries, ownership, audits, closed accounts, races and rollback", async t => {
 const url=new URL(process.env.MEDISLOT_TEST_DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/medislot_lifecycle_test");process.env.DATABASE_URL=url.href;process.env.JWT_SECRET="lifecycle-test";
 const app=await NestFactory.create(AppModule,{logger:false}),db=app.get(PrismaService),lifecycle=app.get(AppointmentLifecycle);let now=Date.parse("2031-01-06T10:00:00Z");lifecycle.now=()=>new Date(now);
 app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true}));await app.listen(0,"127.0.0.1");const base=await app.getUrl();t.after(async()=>{await app.close();await db.$disconnect()});
 const hash=await bcrypt.hash("LifecycleTest123!",4);let seq=0;const user=(role:Role=Role.PATIENT)=>db.user.create({data:{name:"Synthetic "+ ++seq,email:`lifecycle${seq}@example.test`,password:hash,role,specialization:role===Role.DOCTOR?"ENT":null}});
 const admin=await user(Role.ADMIN),rec=await user(Role.RECEPTIONIST),manager=await user(Role.MANAGER),doctor=await user(Role.DOCTOR),otherDoctor=await user(Role.DOCTOR),patient=await user(),otherPatient=await user();
 type Actor={id:number;role:Role};const request=async(method:string,path:string,actor?:Actor,body?:object)=>{const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(actor?{Authorization:"Bearer "+jwt.sign({sub:actor.id,role:actor.role,authVersion:1},"lifecycle-test",{expiresIn:"1h"})}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json().catch(()=>null)}};
 const period=await db.schedulePeriod.create({data:{doctorId:doctor.id,publishedById:admin.id,startDate:new Date("2031-01-01"),endDate:new Date("2032-12-31"),workingWeekdays:[1],dailyStartTime:"00:00",dailyEndTime:"23:59",slotDurationMinutes:30,excludedDates:[],removedSlotIds:[]}});
 const fixture=async(start=now+86400000,owner=patient,status:AppointmentStatus="CONFIRMED",blocked=false,d=doctor,published=true)=>{
  const c=await db.calendar.create({data:{doctorId:d.id,schedulePeriodId:published?period.id:null,startTime:new Date(start),endTime:new Date(start+1800000),isBooked:true,isBlocked:blocked}});
  return db.appointment.create({data:{doctorId:d.id,patientId:owner.id,calendarId:c.id,status,reason:"Original reason remains private"},include:{calendar:true}});
 };
 const identity=(a:{calendarId:number;version:number})=>({currentCalendarId:a.calendarId,expectedVersion:a.version});
 const put=(a:{id:number;calendarId:number;version:number},status:AppointmentStatus,actor:Actor=rec,extra:object={})=>request("PUT",`/appointments/${a.id}`,actor,{...identity(a),status,...extra});
 const block=(a:Awaited<ReturnType<typeof fixture>>)=>request("POST","/calendars/block",manager,{doctorId:a.doctorId,startTime:a.calendar.startTime.toISOString(),endTime:a.calendar.endTime.toISOString()});
 const activeCase=async(a:Awaited<ReturnType<typeof fixture>>)=>{const n=await db.notification.findFirstOrThrow({where:{appointmentId:a.id,resolvedAt:null}});const current=await db.appointment.findUniqueOrThrow({where:{id:a.id}});return{...identity(current),notificationId:n.id,disruptionVersion:n.disruptionVersion}};
 const a=await fixture();assert.equal((await request("GET","/appointments",patient)).status,403);assert.equal((await request("GET","/appointments")).status,401);
 const foreign=await fixture(now+86400000,otherPatient,"CONFIRMED",false,otherDoctor);
 const listed=await request("GET","/appointments",doctor);assert.equal(listed.status,200);assert.ok(listed.body.data.every((x:{doctorId:number})=>x.doctorId===doctor.id));assert.equal((await request("GET",`/appointments/${foreign.id}`,doctor)).status,403);
 assert.equal((await put(a,"CANCELLED",otherPatient)).status,403);assert.equal((await put(a,"CANCELLED",otherDoctor)).status,403);assert.equal((await put(a,"CANCELLED",manager)).status,403);
 assert.equal((await request("PUT",`/appointments/${a.id}`,patient,{status:"CANCELLED"})).status,400);
 const cancelled=await put(a,"CANCELLED",patient,{reason:"Attempted overwrite"});assert.equal(cancelled.status,200);assert.equal(cancelled.body.reason,a.reason);assert.equal(cancelled.body.version,2);assert.equal(cancelled.body.rescheduleCount,0);assert.equal((await db.calendar.findUniqueOrThrow({where:{id:a.calendarId}})).isBooked,false);
 const event=await db.appointmentStatusTransition.findFirstOrThrow({where:{appointmentId:a.id}});assert.equal(event.actorId,patient.id);assert.equal(event.fromStatus,"CONFIRMED");assert.equal(event.toStatus,"CANCELLED");assert.equal(+event.createdAt,now);
 for(const status of ["CANCELLED","COMPLETED","NO_SHOW","CONFIRMED"] as AppointmentStatus[])assert.equal((await put({...a,version:2},status)).status,status==="CONFIRMED"?400:409);
 // Exact boundaries: one millisecond before start may cancel; exactly at start cannot.
 const before=await fixture(now+1),start=await fixture(now);assert.equal((await put(before,"CANCELLED")).status,200);assert.equal((await put(start,"CANCELLED")).status,409);
 for(const status of ["COMPLETED","NO_SHOW"] as const){
  const atEnd=await fixture(now-1800000),tooSoon=await fixture(now-1799999);
  assert.equal((await put(tooSoon,status)).status,409);assert.equal((await put(atEnd,status,patient)).status,403);assert.equal((await put(atEnd,status,manager)).status,403);assert.equal((await put(atEnd,status,otherDoctor)).status,403);
  assert.equal((await put(atEnd,status,doctor)).status,200);assert.equal((await db.calendar.findUniqueOrThrow({where:{id:atEnd.calendarId}})).isBooked,true);
  assert.equal((await put({...atEnd,version:2},"CANCELLED")).status,409);
 }
 // Positive role matrix as well as the ownership/time denials above.
 for(const actor of [admin,rec,doctor]){
   const ordinary=await fixture(now+86400000*(++seq));assert.equal((await put(ordinary,"CANCELLED",actor)).status,200);
   for(const outcome of ["COMPLETED","NO_SHOW"] as const){const visit=await fixture(now-1800000);assert.equal((await put(visit,outcome,actor)).status,200)}
 }
 // Past, exact-start, in-progress and legacy slots are never newly blocked.
 for(const offset of [-3600000,-1,0]){const old=await fixture(now+offset);const before=await db.appointment.findUniqueOrThrow({where:{id:old.id}});await block(old);assert.deepEqual(await db.appointment.findUnique({where:{id:old.id}}),before);assert.equal((await db.calendar.findUniqueOrThrow({where:{id:old.calendarId}})).isBlocked,false)}
 const future=await fixture(now+10*86400000);assert.equal((await block(future)).status,201);const caseId=await activeCase(future);assert.equal((await block(future)).body.appointmentsNeedingRescheduling,0);assert.equal(await db.appointmentStatusTransition.count({where:{appointmentId:future.id}}),1);
 for(const actor of [patient,rec,admin,doctor,manager])assert.equal((await put({...future,version:2},"CANCELLED",actor)).status,409);
 now=+future.calendar.endTime+1;const cancelledCase=await put({...future,version:2},"CANCELLED",patient,caseId);assert.equal(cancelledCase.status,200);assert.equal((await db.calendar.findUniqueOrThrow({where:{id:future.calendarId}})).isBlocked,true);assert.equal((await db.calendar.findUniqueOrThrow({where:{id:future.calendarId}})).isBooked,false);assert.equal((await db.emailJob.findFirstOrThrow({where:{notification:{appointmentRef:future.id}}})).status,"SKIPPED");assert.ok((await db.notification.findFirstOrThrow({where:{appointmentRef:future.id}})).resolvedAt);
 // Every supported role can cancel a current disruption, using its exact identity.
 for(const actor of [rec,admin,doctor,manager]){const x=await fixture(now+86400000*(seq++));await block(x);assert.equal((await put({...x,version:2},"CANCELLED",actor,await activeCase(x))).status,200)}
 // Closure retains ongoing/ended visits and allows staff to record outcomes afterward.
 const closedPatient=await user(),ended=await fixture(now-1800000,closedPatient),ongoing=await fixture(now-1,closedPatient),closingFuture=await fixture(now+86400000,closedPatient);
 const close=()=>request("POST","/users/me/close",closedPatient,{currentPassword:"LifecycleTest123!",confirmed:true,requestId:randomUUID()});assert.equal((await close()).status,200);
 assert.equal((await db.appointment.findUniqueOrThrow({where:{id:ongoing.id}})).status,"CONFIRMED");assert.equal((await put(ended,"COMPLETED",doctor)).status,200);now=+ongoing.calendar.endTime;assert.equal((await put(ongoing,"NO_SHOW",rec)).status,200);assert.equal((await db.appointment.findUniqueOrThrow({where:{id:closingFuture.id}})).status,"CANCELLED");assert.equal(await db.appointmentStatusTransition.count({where:{appointmentId:closingFuture.id,actorId:closedPatient.id}}),1);
 // Status audit failures roll back cancellation, blocking and closure (including notifications/jobs).
 const snapshot=()=>Promise.all([db.user.findMany({orderBy:{id:"asc"}}),db.appointment.findMany({orderBy:{id:"asc"}}),db.calendar.findMany({orderBy:{id:"asc"}}),db.appointmentStatusTransition.findMany({orderBy:{id:"asc"}}),db.notification.findMany({orderBy:{id:"asc"}}),db.emailJob.findMany({orderBy:{id:"asc"}})]);
 const fail=await fixture(now+86400000),closeFailPatient=await user(),closeFail=await fixture(now+86400000,closeFailPatient);
 const recoveryFail=await fixture(now+500*86400000);await block(recoveryFail);
 const recoveryTarget=await db.calendar.create({data:{doctorId:doctor.id,schedulePeriodId:period.id,startTime:new Date(now+501*86400000),endTime:new Date(now+501*86400000+1800000)}});
 const recover=()=>request("POST",`/appointments/${recoveryFail.id}/reschedule`,rec,{currentCalendarId:recoveryFail.calendarId,newCalendarId:recoveryTarget.id,expectedVersion:2});
 const old=await snapshot();
 await db.$executeRawUnsafe(`CREATE FUNCTION fail_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced status audit failure'; END $$`);await db.$executeRawUnsafe(`CREATE TRIGGER fail_status_audit BEFORE INSERT ON "AppointmentStatusTransition" FOR EACH ROW EXECUTE FUNCTION fail_status_audit()`);
 assert.equal((await put(fail,"CANCELLED")).status,500);assert.deepEqual(await snapshot(),old);assert.equal((await block(fail)).status,500);assert.deepEqual(await snapshot(),old);assert.equal((await request("POST","/users/me/close",closeFailPatient,{currentPassword:"LifecycleTest123!",confirmed:true,requestId:randomUUID()})).status,500);assert.deepEqual(await snapshot(),old);
 assert.equal((await recover()).status,500);assert.deepEqual(await snapshot(),old);
 await db.$executeRawUnsafe(`DROP TRIGGER fail_status_audit ON "AppointmentStatusTransition"`);await db.$executeRawUnsafe(`DROP FUNCTION fail_status_audit()`);
 await db.$executeRawUnsafe(`CREATE FUNCTION fail_move_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced move history failure'; END $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER fail_move_history BEFORE INSERT ON "AppointmentRescheduleHistory" FOR EACH ROW EXECUTE FUNCTION fail_move_history()`);
 assert.equal((await recover()).status,500);assert.deepEqual(await snapshot(),old);
 await db.$executeRawUnsafe(`DROP TRIGGER fail_move_history ON "AppointmentRescheduleHistory"`);await db.$executeRawUnsafe(`DROP FUNCTION fail_move_history()`);
 assert.equal((await recover()).status,200);assert.equal(await db.appointmentStatusTransition.count({where:{appointmentId:recoveryFail.id}}),2);assert.equal(await db.appointmentRescheduleHistory.count({where:{appointmentId:recoveryFail.id}}),1);
 // ABA: a move away and back is still a new version; old cancellation cannot affect it.
 const aba=await fixture(now+20*86400000),replacement=await db.calendar.create({data:{doctorId:doctor.id,schedulePeriodId:period.id,startTime:new Date(now+21*86400000),endTime:new Date(now+21*86400000+1800000)}});
 const move=(currentCalendarId:number,newCalendarId:number,expectedVersion:number)=>request("POST",`/appointments/${aba.id}/reschedule`,rec,{currentCalendarId,newCalendarId,expectedVersion});assert.equal((await move(aba.calendarId,replacement.id,1)).status,200);assert.equal((await move(replacement.id,aba.calendarId,2)).status,200);assert.equal((await put(aba,"CANCELLED")).status,409);assert.equal(await db.appointmentRescheduleHistory.count({where:{appointmentId:aba.id}}),2);assert.equal(await db.appointmentStatusTransition.count({where:{appointmentId:aba.id}}),0);
 // Real lock waiter crosses cancellation start: time must be evaluated after lock acquisition.
 const waits=await fixture(now+1);let release!:()=>void,ready!:()=>void;const gate=new Promise<void>(r=>release=r),held=new Promise<void>(r=>ready=r);const holder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${doctor.id} FOR UPDATE`;ready();await gate},{timeout:10000});await held;const pending=put(waits,"CANCELLED");await new Promise(r=>setTimeout(r,100));now=+waits.calendar.startTime;release();await holder;assert.equal((await pending).status,409);
 // A blocking lock waiter also crosses the start boundary and must leave the slot unchanged.
 const waitingBlock=await fixture(now+1);let releaseBlock!:()=>void,readyBlock!:()=>void;const blockGate=new Promise<void>(r=>releaseBlock=r),blockHeld=new Promise<void>(r=>readyBlock=r);
 const blockHolder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${doctor.id} FOR UPDATE`;readyBlock();await blockGate},{timeout:10000});await blockHeld;
 const blocking=block(waitingBlock);await new Promise(r=>setTimeout(r,100));now=+waitingBlock.calendar.startTime;releaseBlock();await blockHolder;const blockedAfterWait=await blocking;assert.equal(blockedAfterWait.body.blockedSlots,0);assert.equal((await db.appointment.findUniqueOrThrow({where:{id:waitingBlock.id}})).status,"CONFIRMED");assert.equal(await db.appointmentStatusTransition.count({where:{appointmentId:waitingBlock.id}}),0);
 // Concurrent outcomes and cancellation-vs-blocking serialize; at most one action wins.
 const race=await fixture(now-1800000);const outcomes=await Promise.all([put(race,"COMPLETED",doctor),put(race,"NO_SHOW",rec)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);assert.equal(await db.appointmentStatusTransition.count({where:{appointmentId:race.id}}),1);
 const racedBlock=await fixture(now+86400000*30);const pair=await Promise.all([put(racedBlock,"CANCELLED",patient),block(racedBlock)]);assert.equal(pair[1].status,201);assert.ok([200,409].includes(pair[0].status));const final=await db.appointment.findUniqueOrThrow({where:{id:racedBlock.id}});assert.ok(["CANCELLED","NEEDS_RESCHEDULING"].includes(final.status));
 // No hard deletion may erase appointments or audit actors.
 for(const path of [`/appointments/${a.id}`,`/appointments/${aba.id}`,`/users/${patient.id}`,`/users/${doctor.id}`,`/doctors/${doctor.id}`,`/users/${rec.id}`])assert.equal((await request("DELETE",path,admin)).status,409,path);
 // Explicit legacy fallback: cancellation does not depend on available replacements
 // and never manufactures an old disruption/notice or email job.
 const legacyFixture=async()=>{
   const d=await user(Role.DOCTOR);await db.user.update({where:{id:d.id},data:{specialization:null}});
   const p=await user();const a=await fixture(Date.parse("2020-01-01T10:00:00Z"),p,"NEEDS_RESCHEDULING",true,d,false);
   return{d,p,a};
 };
 for(const kind of ["patient","admin","rec","doctor","manager"]){
   const{d,p,a}=await legacyFixture(),actor=kind==="patient"?p:kind==="doctor"?d:kind==="admin"?admin:kind==="rec"?rec:manager;
   const options=await request("GET",`/appointments/${a.id}/reschedule-options`,rec);assert.equal(options.status,200);assert.equal(options.body.data.length,0);assert.equal(options.body.appointment.disruption,null);
   for(const staff of [rec,manager,admin]){
     const discovered=await request("GET","/rescheduling/followUps/legacyAppointments?pageSize=100",staff);assert.equal(discovered.status,200);assert.ok(discovered.body.data.some((row:{id:number;disruption:unknown})=>row.id===a.id&&row.disruption===null));
   }
   for(const denied of [p,d])assert.equal((await request("GET","/rescheduling/followUps/legacyAppointments",denied)).status,403);
   assert.equal((await request("GET","/rescheduling/followUps/legacyAppointments")).status,401);assert.equal((await request("GET","/rescheduling/followUps/legacyAppointments?page=0",rec)).status,400);
   const notices=await db.notification.count(),jobs=await db.emailJob.count();
   assert.equal((await put(a,"CANCELLED",actor)).status,409);
   const result=await put(a,"CANCELLED",actor,{legacyDisruption:true});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.reason,a.reason);
   const events=await db.appointmentStatusTransition.findMany({where:{appointmentId:a.id}});assert.equal(events.length,1);assert.equal(events[0].fromStatus,"NEEDS_RESCHEDULING");assert.equal(events[0].toStatus,"CANCELLED");assert.equal(events[0].actorId,actor.id);assert.equal(+events[0].createdAt,now);
   assert.equal(await db.notification.count(),notices);assert.equal(await db.emailJob.count(),jobs);assert.equal(await db.appointmentRescheduleHistory.count({where:{appointmentId:a.id}}),0);
   const slot=await db.calendar.findUniqueOrThrow({where:{id:a.calendarId}});assert.equal(slot.isBooked,false);assert.equal(slot.isBlocked,true);
 }
 const legacy=await legacyFixture();
 for(const actor of [otherPatient,doctor])assert.equal((await put(legacy.a,"CANCELLED",actor,{legacyDisruption:true})).status,403);
 assert.equal((await request("PUT",`/appointments/${legacy.a.id}`,undefined,{...identity(legacy.a),status:"CANCELLED",legacyDisruption:true})).status,401);
 for(const extra of [{expectedVersion:2},{currentCalendarId:legacy.a.calendarId+99999},{notificationId:2147483647,disruptionVersion:1}])assert.equal((await put(legacy.a,"CANCELLED",rec,{legacyDisruption:true,...extra})).status,409);
 // No bypass when a current notification exists, even if it is resolved/detached.
 const backed=await fixture(now+600*86400000);await block(backed);const backedIdentity=await activeCase(backed);
 assert.equal((await put({...backed,version:2},"CANCELLED",rec,{legacyDisruption:true})).status,409);
 assert.equal((await put({...backed,version:2},"CANCELLED",rec,{...backedIdentity,legacyDisruption:true})).status,409);
 assert.equal((await put({...backed,version:2},"CANCELLED",rec,backedIdentity)).status,200);
 const malformed=await legacyFixture();await db.notification.create({data:{appointmentRef:malformed.a.id,appointmentId:null,recipientId:null,disruptionVersion:1,calendarRef:malformed.a.calendarId,doctorName:malformed.d.name,slotStartTime:malformed.a.calendar.startTime,slotEndTime:malformed.a.calendar.endTime,resolvedAt:new Date()}});
 assert.equal((await put(malformed.a,"CANCELLED",rec,{legacyDisruption:true})).status,409);
 // A notification committed while cancellation waits cannot be skipped by the fallback.
 const changedLegacy=await legacyFixture();let releaseLegacy!:()=>void,readyLegacy!:()=>void;const legacyGate=new Promise<void>(r=>releaseLegacy=r),legacyHeld=new Promise<void>(r=>readyLegacy=r);
 const legacyHolder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${changedLegacy.d.id} FOR UPDATE`;readyLegacy();await legacyGate},{timeout:10000});await legacyHeld;
 const staleLegacy=put(changedLegacy.a,"CANCELLED",rec,{legacyDisruption:true});await new Promise(r=>setTimeout(r,80));await db.notification.create({data:{appointmentRef:changedLegacy.a.id,appointmentId:changedLegacy.a.id,recipientId:changedLegacy.p.id,disruptionVersion:1,calendarRef:changedLegacy.a.calendarId,doctorName:changedLegacy.d.name,slotStartTime:changedLegacy.a.calendar.startTime,slotEndTime:changedLegacy.a.calendar.endTime}});releaseLegacy();await legacyHolder;assert.equal((await staleLegacy).status,409);
 const competing=await legacyFixture();const duplicateLegacy=await Promise.all([put(competing.a,"CANCELLED",competing.p,{legacyDisruption:true}),put(competing.a,"CANCELLED",manager,{legacyDisruption:true})]);assert.deepEqual(duplicateLegacy.map(r=>r.status).sort(),[200,409]);assert.equal(await db.appointmentStatusTransition.count({where:{appointmentId:competing.a.id}}),1);
 // Existing recovery remains available; either recovery or cancellation wins, never both.
 for(const cancelFirst of [true,false]){
   const x=await legacyFixture();const periodX=await db.schedulePeriod.create({data:{doctorId:x.d.id,publishedById:admin.id,startDate:new Date("2038-01-01"),endDate:new Date("2038-12-31"),workingWeekdays:[1],dailyStartTime:"10:00",dailyEndTime:"11:00",slotDurationMinutes:30,excludedDates:[],removedSlotIds:[]}});
   const target=await db.calendar.create({data:{doctorId:x.d.id,schedulePeriodId:periodX.id,startTime:new Date("2038-01-04T10:00:00Z"),endTime:new Date("2038-01-04T10:30:00Z")}});
   let release!:()=>void,ready!:()=>void;const gate=new Promise<void>(r=>release=r),held=new Promise<void>(r=>ready=r);const holder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${x.d.id} FOR UPDATE`;ready();await gate},{timeout:10000});await held;
   const cancel=()=>put(x.a,"CANCELLED",x.p,{legacyDisruption:true}),move=()=>request("POST",`/appointments/${x.a.id}/reschedule`,rec,{currentCalendarId:x.a.calendarId,newCalendarId:target.id,expectedVersion:1});
   const first=cancelFirst?cancel():move();await new Promise(r=>setTimeout(r,75));const second=cancelFirst?move():cancel();await new Promise(r=>setTimeout(r,75));release();await holder;
   assert.deepEqual((await Promise.all([first,second])).map(r=>r.status),[200,409]);assert.equal(await db.appointmentStatusTransition.count({where:{appointmentId:x.a.id}}),1);assert.equal(await db.appointmentRescheduleHistory.count({where:{appointmentId:x.a.id}}),cancelFirst?0:1);
 }
 t.diagnostic("Legacy cancellation without replacements passed for all five authorized roles; ownership/assignment, stale identity, concurrent notification creation, current-notice bypass prevention and recovery/cancel races passed; only a current cancellation audit was written");
 // Capture-only delivery for a live future disruption; retrieval/selection makes no holds.
 const email=await fixture(now+40*86400000);await block(email);const n=await db.notification.findFirstOrThrow({where:{appointmentId:email.id}});await db.emailJob.updateMany({where:{notificationId:{not:n.id},status:"PENDING"},data:{status:"SKIPPED"}});const worker=new EmailWorker(db,new MailpitTransport("127.0.0.1",1025),"http://localhost:3350");assert.equal(await worker.runOnce(),true);assert.equal((await db.emailJob.findUniqueOrThrow({where:{notificationId:n.id}})).status,"SENT");
 t.diagnostic("Fresh HTTP role/ownership, exact start/end, current case, closed-patient outcomes, future-only block, reason/version/reservation preservation, immutable terminal outcomes, ABA, lock wait/races, audit rollback, deletion guards and synthetic Mailpit passed");
});
