import { statusRequestFixture } from "./status-request-fixture";
import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {NestFactory} from "@nestjs/core";
import {ValidationPipe} from "@nestjs/common";
import {Role} from "@prisma/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import {AppModule} from "../src/app.module";
import {PrismaService} from "../src/prisma/prisma.service";
import {FollowUpsService} from "../src/follow-ups/follow-ups.service";
import {followUpDeadline} from "../src/follow-ups/follow-up-policy";

// All writes are guarded to a disposable database. No email worker is started here.
test("reception follow-up: timing, contacts, role matrix, races, privacy and retention",async t=>{
 const url=new URL(process.env.MEDISLOT_TEST_DATABASE_URL??"");assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/medislot_followups_test");process.env.DATABASE_URL=url.href;process.env.JWT_SECRET="followup-test";
 const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false}),db=app.get(PrismaService),service=app.get(FollowUpsService);
 t.after(async()=>{await app.close();await db.$disconnect()});app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true}));await app.listen(0,"127.0.0.1");const base=await app.getUrl();
 let seq=0;const user=async(role:Role,phone:string|null=null)=>db.user.create({data:{name:"Synthetic "+ ++seq,email:`follow${seq}@example.test`,password:await bcrypt.hash("TestPassword123!",4),role,phone,specialization:role===Role.DOCTOR?"ENT":null}});
 const admin=await user(Role.ADMIN),rec=await user(Role.RECEPTIONIST),manager=await user(Role.MANAGER),doctor=await user(Role.DOCTOR),patient=await user(Role.PATIENT,"+48500100200"),other=await user(Role.PATIENT);
 const period=await db.schedulePeriod.create({data:{doctorId:doctor.id,publishedById:admin.id,startDate:new Date("2020-01-01"),endDate:new Date("2035-12-31"),workingWeekdays:[1,2,3,4,5,6,7],dailyStartTime:"00:00",dailyEndTime:"23:59",slotDurationMinutes:30,excludedDates:[],removedSlotIds:[]}});
 type Actor={id:number;role:Role};const headers=(actor?:Actor)=>({"Content-Type":"application/json",...(actor?{Authorization:"Bearer "+jwt.sign({ authVersion: 1, sub:actor.id,role:actor.role},"followup-test")}:{})});
 const request=async(method:string,path:string,actor?:Actor,body?:object)=>{body=await statusRequestFixture(db,method,path,body);const r=await fetch(base+path,{method,headers:headers(actor),body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json().catch(()=>null)}};
 let day=0;
 const slot=async(start=new Date(Date.parse("2030-01-07T10:00Z")+day++*86400000))=>db.calendar.create({data:{doctorId:doctor.id,startTime:start,endTime:new Date(+start+1800000),schedulePeriodId:period.id}});
 async function fixture(owner=patient,start?:Date){const calendar=await slot(start);const a=await db.appointment.create({data:{doctorId:doctor.id,patientId:owner.id,calendarId:calendar.id,reason:"PRIVATE VISIT REASON"}});await db.calendar.update({where:{id:calendar.id},data:{isBooked:true}});assert.equal((await request("POST","/calendars/block",manager,{doctorId:doctor.id,startTime:calendar.startTime.toISOString(),endTime:calendar.endTime.toISOString()})).status,201);const notice=await db.notification.findFirstOrThrow({where:{appointmentId:a.id}});return{calendar,a,notice,identity:{notificationId:notice.id,disruptionVersion:2,currentCalendarId:calendar.id,expectedVersion:2}};}
 const f=await fixture();assert.equal(+f.notice.followUpDeadlineAt!,+followUpDeadline(f.calendar.startTime,f.notice.createdAt));
 service.clock=()=>new Date(+f.notice.createdAt+1000);
 // Empty recommendation groups do NOT create an escalation.
 assert.equal((await request("GET","/rescheduling/followUps",rec)).body.meta.total,0);
 assert.equal((await request("GET",`/appointments/${f.a.id}/alternatives`,manager)).status,200);
 assert.equal((await request("GET","/rescheduling/followUps",patient)).status,403);assert.equal((await request("GET","/rescheduling/followUps",doctor)).status,403);assert.equal((await request("GET","/rescheduling/followUps")).status,401);
 await db.emailJob.update({where:{notificationId:f.notice.id},data:{status:"FAILED",failedAt:new Date(+f.notice.createdAt+500)}});
 for(const actor of [rec,manager,admin]){const r=await request("GET","/rescheduling/followUps",actor);assert.equal(r.status,200);assert.equal(r.body.meta.total,1);assert.deepEqual(r.body.data[0].reasons,["EMAIL_FAILED"]);assert.equal(r.body.data[0].patient.phone,patient.phone);assert.equal(JSON.stringify(r.body).includes("PRIVATE VISIT REASON"),false);assert.equal(r.body.data[0].actions.reschedule,actor.role!==Role.ADMIN);assert.equal(+new Date(r.body.data[0].scheduledDeadlineAt),+f.notice.followUpDeadlineAt!);}
 // Controlled noon permits contact; appointments and notice state are unchanged.
 service.clock=()=>new Date("2030-01-01T11:00:00Z");
 const payload={...f.identity,outcome:"NO_ANSWER",note:"Try again manually tomorrow",idempotencyKey:randomUUID()};
 const before=await db.appointment.findUniqueOrThrow({where:{id:f.a.id}});const noticeBefore=await db.notification.findUniqueOrThrow({where:{id:f.notice.id}});
 for(const actor of [admin,doctor,patient])assert.equal((await request("POST",`/appointments/${f.a.id}/contactAttempts`,actor,payload)).status,403);
 const contacts=await Promise.all([request("POST",`/appointments/${f.a.id}/contactAttempts`,rec,payload),request("POST",`/appointments/${f.a.id}/contactAttempts`,rec,payload)]);assert.ok(contacts.every(r=>r.status===201));assert.equal(contacts[0].body.id,contacts[1].body.id);assert.equal(await db.contactAttempt.count(),1);
 assert.equal((await request("POST",`/appointments/${f.a.id}/contactAttempts`,rec,{...payload,note:"Different"})).status,409);
 assert.deepEqual(await db.appointment.findUniqueOrThrow({where:{id:f.a.id}}),before);assert.deepEqual(await db.notification.findUniqueOrThrow({where:{id:f.notice.id}}),noticeBefore);
 await request("PATCH",`/notifications/${f.notice.id}/read`,patient);assert.equal((await request("GET","/rescheduling/followUps",rec)).body.meta.total,1);
 for(const actor of [rec,manager,admin]){const r=await request("GET",`/rescheduling/followUps/${f.notice.id}/contactAttempts`,actor);assert.equal(r.status,200);assert.equal(r.body.data[0].actorId,rec.id);}
 for(const actor of [patient,doctor])assert.equal((await request("GET",`/rescheduling/followUps/${f.notice.id}/contactAttempts`,actor)).status,403);
 for(const body of [{...payload,idempotencyKey:randomUUID(),expectedVersion:1},{...payload,idempotencyKey:randomUUID(),note:"x".repeat(501)},{...payload,idempotencyKey:randomUUID(),outcome:"DONE"}])assert.ok([400,409].includes((await request("POST",`/appointments/${f.a.id}/contactAttempts`,rec,body)).status));
 const beforeHours=(await request("GET","/rescheduling/followUps",rec)).body.data.find((r:{notificationId:number})=>r.notificationId===f.notice.id);
 service.clock=()=>new Date("2030-01-01T19:00:00Z");const afterHours=(await request("GET","/rescheduling/followUps",rec)).body.data.find((r:{notificationId:number})=>r.notificationId===f.notice.id);assert.equal(afterHours.contactAllowedNow,false);assert.equal(afterHours.nextContactAllowedAt,"2030-01-02T07:00:00.000Z");assert.equal(afterHours.phoneContactDueAt,beforeHours.phoneContactDueAt);assert.equal(afterHours.scheduledDeadlineAt,beforeHours.scheduledDeadlineAt);assert.equal((await request("POST",`/appointments/${f.a.id}/contactAttempts`,rec,{...payload,idempotencyKey:randomUUID()})).status,409);service.clock=()=>new Date("2030-01-01T11:00:00Z");
 const missing=await fixture(other);assert.equal((await request("POST",`/appointments/${missing.a.id}/contactAttempts`,manager,{...payload,...missing.identity,idempotencyKey:randomUUID()})).status,409);
 await request("PUT",`/users/${patient.id}`,patient,{name:patient.name,email:patient.email,phone:"+442079460018"});
 assert.equal((await request("GET","/rescheduling/followUps",rec)).body.data.find((r:{notificationId:number})=>r.notificationId===f.notice.id).patient.phone,"+442079460018");
 // Manager can recover disrupted visits but cannot move a confirmed appointment or read it afterward.
 const replacement=await slot();const moved=await request("POST",`/appointments/${f.a.id}/reschedule`,manager,{currentCalendarId:f.calendar.id,newCalendarId:replacement.id,expectedVersion:2});assert.equal(moved.status,200);assert.equal(moved.body.historyEntry.actorId,manager.id);
 assert.equal((await request("GET",`/appointments/${f.a.id}`,manager)).status,200);assert.equal((await request("POST",`/appointments/${f.a.id}/reschedule`,manager,{currentCalendarId:replacement.id,newCalendarId:(await slot()).id,expectedVersion:3})).status,403);
 assert.equal((await request("POST",`/appointments/${f.a.id}/contactAttempts`,rec,{...payload,idempotencyKey:randomUUID()})).status,409);
 assert.equal((await request("POST",`/appointments/${f.a.id}/contactAttempts`,rec,payload)).body.id,contacts[0].body.id);
 assert.equal((await request("PUT",`/appointments/${f.a.id}`,manager,{status:"CANCELLED",reason:"PRIVATE VISIT REASON",...f.identity})).status,409);
 // Redisruption has a new case and stale cancellation cannot affect it.
 await request("POST","/calendars/block",manager,{doctorId:doctor.id,startTime:replacement.startTime.toISOString(),endTime:replacement.endTime.toISOString()});
 assert.equal((await request("PUT",`/appointments/${f.a.id}`,rec,{status:"CANCELLED",reason:"PRIVATE VISIT REASON",...f.identity})).status,409);
 const second=await db.notification.findFirstOrThrow({where:{appointmentId:f.a.id,resolvedAt:null}});assert.equal(await db.contactAttempt.count({where:{notificationId:second.id}}),0);
 assert.equal((await request("PUT",`/appointments/${f.a.id}`,manager,{status:"CANCELLED",reason:"PRIVATE VISIT REASON",notificationId:second.id,disruptionVersion:4,currentCalendarId:replacement.id,expectedVersion:4})).status,200);
 assert.equal((await db.notification.findUniqueOrThrow({where:{id:second.id}})).resolvedAt!==null,true);
 // Phone registration/profile validation and no leakage in generic or nested serializations.
 for(const phone of ["bad","500100200",123])assert.equal((await request("POST","/users",undefined,{name:"Test Phone",email:"badphone@example.test",password:"Password123!",phone})).status,400);
 const registered=await request("POST","/users",undefined,{name:"Phone Owner",email:"phone@example.test",password:"Password123!",phone:"+48 500 100 200"});assert.equal(registered.status,201);assert.equal(registered.body.phone,"+48500100200");const phoneOwner={id:registered.body.id,role:Role.PATIENT};
 assert.equal((await request("PUT",`/users/${phoneOwner.id}`,phoneOwner,{name:"Phone Owner",email:"phone@example.test",phone:"+442079460018"})).body.phone,"+442079460018");
 assert.equal((await request("GET",`/users/${phoneOwner.id}`,other)).status,403);assert.equal("phone" in (await request("GET",`/users/${phoneOwner.id}`,admin)).body,false);
 for(const path of ["/doctors","/calendars","/users?role=PATIENT"]){const r=await request("GET",path,rec);assert.equal(JSON.stringify(r.body).includes("+48500100200"),false);assert.equal(JSON.stringify(r.body).includes('"phone"'),false);}
 assert.equal((await request("GET",`/appointments/${f.a.id}`,admin)).body.patient.phone,undefined);
 assert.equal((await request("GET","/rescheduling/followUps?page=0",rec)).status,400);
 // Contact failure rolls back; actor deletion detaches without blocking the account.
 const dedicated=await user(Role.RECEPTIONIST);const g=await fixture();const contact={...g.identity,outcome:"REACHED_PATIENT",idempotencyKey:randomUUID()};
 assert.equal((await request("POST",`/appointments/${g.a.id}/contactAttempts`,dedicated,contact)).status,201);
 assert.equal((await request("POST",`/appointments/${g.a.id}/contactAttempts`,manager,{...contact,outcome:"BUSY",idempotencyKey:randomUUID()})).status,201);
 assert.equal((await request("DELETE",`/users/${dedicated.id}`,admin)).status,200);assert.equal((await db.contactAttempt.findFirstOrThrow({where:{notificationId:g.notice.id,actorRef:dedicated.id}})).actorId,null);
 assert.equal((await request("PUT",`/appointments/${g.a.id}`,rec,{...g.identity,status:"CANCELLED",reason:"PRIVATE VISIT REASON"})).status,200);
 assert.equal((await request("DELETE",`/appointments/${g.a.id}`,admin)).status,409);assert.equal((await db.notification.findUniqueOrThrow({where:{id:g.notice.id}})).appointmentId,g.a.id);assert.equal((await request("GET",`/rescheduling/followUps/${g.notice.id}/contactAttempts`,admin)).body.meta.total,2);
 // Replays survive appointment/patient/doctor detachment and perform no logical writes.
 const replayPayload={...contact,outcome:"BUSY",idempotencyKey:randomUUID()};
 const replayPatient=await user(Role.PATIENT,"+48500100200"),replayFixture=await fixture(replayPatient),replayBody={...replayPayload,...replayFixture.identity};
 const firstReplay=await request("POST",`/appointments/${replayFixture.a.id}/contactAttempts`,rec,replayBody);assert.equal(firstReplay.status,201);
 await request("PUT",`/appointments/${replayFixture.a.id}`,rec,{...replayFixture.identity,status:"CANCELLED",reason:"PRIVATE VISIT REASON"});
 await request("DELETE",`/appointments/${replayFixture.a.id}`,admin);
 assert.equal((await request("DELETE",`/users/${replayPatient.id}`,admin)).status,409);
 assert.equal((await request("POST","/users/me/close",replayPatient,{currentPassword:"TestPassword123!",confirmed:true,requestId:randomUUID()})).status,200);
 assert.equal((await db.notification.findUniqueOrThrow({where:{id:replayFixture.notice.id}})).recipientId,null);
 const preserved=()=>Promise.all([db.notification.findUnique({where:{id:replayFixture.notice.id}}),db.contactAttempt.findMany({where:{notificationId:replayFixture.notice.id}}),db.emailJob.findUnique({where:{notificationId:replayFixture.notice.id}})]);
 const replayBefore=JSON.stringify(await preserved());
 // Reject any unexpected UPDATE/INSERT/DELETE on retained tables during the HTTP replay.
 await db.$executeRawUnsafe(`CREATE FUNCTION reject_replay_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'replay attempted a write'; END $$`);
 for(const table of ["Notification","ContactAttempt","EmailJob"])await db.$executeRawUnsafe(`CREATE TRIGGER reject_replay_write BEFORE INSERT OR UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION reject_replay_write()`);
 try{
  const replay=await request("POST",`/appointments/${replayFixture.a.id}/contactAttempts`,rec,replayBody);assert.equal(replay.status,201);assert.deepEqual(replay.body,firstReplay.body);
  assert.equal((await request("POST",`/appointments/${replayFixture.a.id}/contactAttempts`,rec,{...replayBody,note:"Changed"})).status,409);
  assert.equal((await request("POST",`/appointments/${replayFixture.a.id+9999}/contactAttempts`,rec,replayBody)).status,409);
  assert.equal((await request("POST",`/appointments/${replayFixture.a.id}/contactAttempts`,manager,replayBody)).status,409);
  for(const actor of [admin,patient,doctor])assert.equal((await request("POST",`/appointments/${replayFixture.a.id}/contactAttempts`,actor,replayBody)).status,403);
 }finally{
  for(const table of ["Notification","ContactAttempt","EmailJob"])await db.$executeRawUnsafe(`DROP TRIGGER reject_replay_write ON "${table}"`);
  await db.$executeRawUnsafe(`DROP FUNCTION reject_replay_write()`);
 }
 assert.equal(JSON.stringify(await preserved()),replayBefore);
 // Recovery/contact and cancellation/contact serialize on the same doctor/patient rows.
 const race=await fixture(),raceTarget=await slot();const raceResults=await Promise.all([
  request("POST",`/appointments/${race.a.id}/contactAttempts`,rec,{...race.identity,outcome:"BUSY",idempotencyKey:randomUUID()}),
  request("POST",`/appointments/${race.a.id}/reschedule`,patient,{currentCalendarId:race.calendar.id,newCalendarId:raceTarget.id,expectedVersion:2})]);
 assert.equal(raceResults[1].status,200);assert.ok([201,409].includes(raceResults[0].status));assert.equal(await db.contactAttempt.count({where:{notificationId:race.notice.id}}),raceResults[0].status===201?1:0);
 const cancelRace=await fixture();const cr=await Promise.all([
  request("POST",`/appointments/${cancelRace.a.id}/contactAttempts`,manager,{...cancelRace.identity,outcome:"VOICEMAIL_LEFT",idempotencyKey:randomUUID()}),
  request("PUT",`/appointments/${cancelRace.a.id}`,rec,{...cancelRace.identity,status:"CANCELLED",reason:"PRIVATE VISIT REASON"})]);assert.equal(cr[1].status,200);assert.ok([201,409].includes(cr[0].status));
 await db.emailJob.update({where:{notificationId:cancelRace.notice.id},data:{status:"FAILED",failedAt:service.clock()}});
 assert.equal((await request("GET","/rescheduling/followUps",rec)).body.data.some((row:{notificationId:number})=>row.notificationId===cancelRace.notice.id),false);
 const rollback=await fixture();const snapshot=JSON.stringify(await Promise.all([db.appointment.findUnique({where:{id:rollback.a.id}}),db.notification.findUnique({where:{id:rollback.notice.id}})]));
 await db.$executeRawUnsafe(`CREATE FUNCTION fail_contact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced contact failure'; END $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER fail_contact BEFORE INSERT ON "ContactAttempt" FOR EACH ROW EXECUTE FUNCTION fail_contact()`);
 try{assert.equal((await request("POST",`/appointments/${rollback.a.id}/contactAttempts`,rec,{...rollback.identity,outcome:"NO_ANSWER",idempotencyKey:randomUUID()})).status,500)}finally{await db.$executeRawUnsafe(`DROP TRIGGER fail_contact ON "ContactAttempt"`);await db.$executeRawUnsafe(`DROP FUNCTION fail_contact()`)}
 assert.equal(await db.contactAttempt.count({where:{notificationId:rollback.notice.id}}),0);assert.equal(JSON.stringify(await Promise.all([db.appointment.findUnique({where:{id:rollback.a.id}}),db.notification.findUnique({where:{id:rollback.notice.id}})])),snapshot);
 // Queue counts, stable ties and pages refer to the same active case set.
 for(let i=0;i<21;i++)await fixture();const queue=await request("GET","/rescheduling/followUps?pageSize=100",rec);const paged:number[]=[];
 for(let p=1;p<=Math.ceil(queue.body.meta.total/5);p++){const response=await request("GET",`/rescheduling/followUps?page=${p}&pageSize=5`,admin);assert.equal(response.body.meta.total,queue.body.meta.total);paged.push(...response.body.data.map((row:{notificationId:number})=>row.notificationId));}
 assert.deepEqual(paged,queue.body.data.map((row:{notificationId:number})=>row.notificationId));
 // Real case discovery includes resolved/detached history and un-escalated active cases.
 for(const actor of [rec,manager,admin]){
  const active=await request("GET","/rescheduling/followUps/cases?status=ACTIVE&pageSize=100",actor);assert.equal(active.status,200);assert.ok(active.body.data.every((row:{resolvedAt:string|null})=>row.resolvedAt===null));
  const resolved=await request("GET","/rescheduling/followUps/cases?status=RESOLVED&pageSize=100",actor);assert.equal(resolved.status,200);assert.ok(resolved.body.data.every((row:{resolvedAt:string|null})=>row.resolvedAt!==null));
  const detached=resolved.body.data.find((row:{notificationId:number})=>row.notificationId===replayFixture.notice.id);assert.ok(detached);assert.equal(detached.appointmentId,null);assert.equal(detached.patientName,null);assert.equal(detached.contactCount,1);
  const collected:number[]=[];for(let page=1;page<=Math.ceil(resolved.body.meta.total/2);page++){const response=await request("GET",`/rescheduling/followUps/cases?status=RESOLVED&pageSize=2&page=${page}`,actor);assert.equal(response.body.meta.total,resolved.body.meta.total);collected.push(...response.body.data.map((row:{notificationId:number})=>row.notificationId));}assert.deepEqual(collected,resolved.body.data.map((row:{notificationId:number})=>row.notificationId));
 }
 for(const actor of [patient,doctor])assert.equal((await request("GET","/rescheduling/followUps/cases?status=RESOLVED",actor)).status,403);
 assert.equal((await request("GET","/rescheduling/followUps/cases")).status,401);
 for(const query of ["status=invalid","page=0","pageSize=101"])assert.equal((await request("GET","/rescheduling/followUps/cases?"+query,admin)).status,400);
 // Admin-only manager filtering reuses the user list without exposing passwords/phones.
 const managers=await request("GET","/users?role=MANAGER&page=1&pageSize=1",admin);assert.equal(managers.status,200);assert.equal(managers.body.data[0].role,"MANAGER");assert.equal("password" in managers.body.data[0],false);assert.equal("phone" in managers.body.data[0],false);
 for(const actor of [rec,manager,patient,doctor])assert.equal((await request("GET","/users?role=MANAGER",actor)).status,403);
 assert.equal((await request("GET","/users?role=MANAGER")).status,401);
 for(const query of ["page=0","page=invalid","pageSize=101"])assert.equal((await request("GET","/users?role=MANAGER&"+query,admin)).status,400);
 // A real PostgreSQL lock wait records the disruption after the wait, not transaction start.
 const [{now:beforeWait}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 const waitSlot=await slot(new Date(+beforeWait+48*3600000+2000)),waitApp=await db.appointment.create({data:{doctorId:doctor.id,patientId:patient.id,calendarId:waitSlot.id,reason:"Wait test"}});let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),hit=new Promise<void>(r=>entered=r);
 const holder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${doctor.id} FOR UPDATE`;entered();await gate},{timeout:10000});await hit;
 const pending=request("POST","/calendars/block",admin,{doctorId:doctor.id,startTime:waitSlot.startTime.toISOString(),endTime:waitSlot.endTime.toISOString()});let observed=false;let transactionStart:Date|null=null;for(let i=0;i<100;i++){const [{count,started}]=await db.$queryRaw<{count:number;started:Date|null}[]>`SELECT COUNT(*)::int AS count, MIN(xact_start) AS started FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%User%' AND query LIKE '%FOR UPDATE%'`;if(count>0){observed=true;transactionStart=started;break}await new Promise(r=>setTimeout(r,10))}assert.equal(observed,true,"blocking request must visibly wait on doctor lock");assert.ok(transactionStart&&+waitSlot.startTime-+transactionStart>48*3600000,"transaction must begin above 48 hours remaining");
 const boundary=+waitSlot.startTime-48*3600000;
 for(;;){const [{now}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;if(+now>boundary+20)break;await new Promise(r=>setTimeout(r,10))}
 const [{releaseAt}]=await db.$queryRaw<{releaseAt:Date}[]>`SELECT clock_timestamp() AS "releaseAt"`;release();await holder;assert.equal((await pending).status,201);const waited=await db.notification.findFirstOrThrow({where:{appointmentId:waitApp.id}});assert.ok(+waited.createdAt>=+releaseAt-2, `recorded=${waited.createdAt.toISOString()} release=${releaseAt.toISOString()}`);assert.equal(+waited.followUpDeadlineAt!,+waited.createdAt+4*3600000);assert.equal(+waited.followUpDeadlineAt!,+followUpDeadline(waitSlot.startTime,waited.createdAt));
 const legacy=await fixture();await db.notification.update({where:{id:legacy.notice.id},data:{followUpDeadlineAt:null,legacyFollowUpEscalatedAt:new Date("2029-12-31T22:00:00Z")}});
 const legacyRow=(await request("GET","/rescheduling/followUps?pageSize=100",rec)).body.data.find((row:{notificationId:number})=>row.notificationId===legacy.notice.id);
 assert.equal(legacyRow.scheduledDeadlineAt,null);assert.equal(legacyRow.recordedAt,null);assert.equal(legacyRow.timingBasis,"LEGACY_UNKNOWN");assert.ok(legacyRow.reasons.includes("LEGACY_FALLBACK"));assert.equal(legacyRow.phoneContactDueAt,"2030-01-01T07:00:00.000Z");
 t.diagnostic("Exact deadline persistence after real doctor-lock wait; terminal failure immediate, no recommendation escalation, role matrix, current phones/privacy, contact idempotency/state independence, manager recovery/cancellation and redisruption protection passed");
});
