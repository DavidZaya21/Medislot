import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Prisma, Role, type EmailJob } from "@prisma/client";
import jwt from "jsonwebtoken";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { FollowUpsService } from "../src/follow-ups/follow-ups.service";
import { EmailWorker } from "../src/email/worker";
import { EmailFailure, LEASE_MS, type EmailMessage, type EmailTransport } from "../src/email/policy";
import { MailpitTransport } from "../src/email/mailpit-transport";

test("durable disruption notifications, leases/retries, Mailpit capture and approved deletion detachment", async t => {
 const url=new URL(process.env.MEDISLOT_TEST_DATABASE_URL??"");assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/medislot_notifications_test");
 process.env.DATABASE_URL=url.href;process.env.JWT_SECRET="notification-test";
 const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});const db=app.get(PrismaService);
 t.after(async()=>{try{await app.close()}finally{await db.$disconnect()}});app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true}));await app.listen(0,"127.0.0.1");const base=await app.getUrl();assert.equal(await db.user.count(),0);
 let sequence=0;async function user(role:Role){return db.user.create({data:{name:"Notice "+ ++sequence,email:`notice${sequence}@example.test`,password:"unused",role}})}
 const admin=await user(Role.ADMIN),manager=await user(Role.MANAGER),rec=await user(Role.RECEPTIONIST),doctor=await user(Role.DOCTOR),patient=await user(Role.PATIENT),other=await user(Role.PATIENT);
 const period=await db.schedulePeriod.create({data:{doctorId:doctor.id,publishedById:admin.id,startDate:new Date("2030-01-01"),endDate:new Date("2035-12-31"),workingWeekdays:[1,2,3,4,5,6,7],dailyStartTime:"00:00",dailyEndTime:"23:59",slotDurationMinutes:30,excludedDates:[],removedSlotIds:[]}});
 type Actor={id:number;role:Role};async function request(method:string,path:string,actor?:Actor,body?:object){const response=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(actor?{Authorization:"Bearer "+jwt.sign({sub:actor.id,role:actor.role},process.env.JWT_SECRET!,{expiresIn:"1h"})}:{})},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json().catch(()=>null)}}
 let day=0;async function fixture(owner=patient){const start=new Date(Date.parse("2030-01-07T10:00:00Z")+day++*86400000);const slot=await db.calendar.create({data:{doctorId:doctor.id,schedulePeriodId:period.id,startTime:start,endTime:new Date(+start+1800000),isBooked:true}});const appointment=await db.appointment.create({data:{doctorId:doctor.id,patientId:owner.id,calendarId:slot.id,reason:"PRIVATE VISIT REASON"}});return{slot,appointment,owner}}
 const block=(f:Awaited<ReturnType<typeof fixture>>)=>request("POST","/calendars/block",admin,{doctorId:doctor.id,startTime:f.slot.startTime.toISOString(),endTime:f.slot.endTime.toISOString()});
 const noticeFor=(id:number)=>db.notification.findFirstOrThrow({where:{appointmentRef:id},orderBy:{id:"desc"},include:{emailJob:true}});
 async function cancel(f:Awaited<ReturnType<typeof fixture>>){return request("PUT",`/appointments/${f.appointment.id}`,rec,{status:"CANCELLED",reason:f.appointment.reason})}
 // Each insertion point must roll back the status and slot updates too.
 for(const table of ["Notification","EmailJob"]){const f=await fixture();await db.$executeRawUnsafe(`CREATE FUNCTION fail_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$`);await db.$executeRawUnsafe(`CREATE TRIGGER fail_notice BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION fail_notice()`);try{assert.equal((await block(f)).status,500);assert.equal((await db.appointment.findUniqueOrThrow({where:{id:f.appointment.id}})).status,"CONFIRMED");assert.equal((await db.calendar.findUniqueOrThrow({where:{id:f.slot.id}})).isBlocked,false);assert.equal(await db.notification.count(),0);assert.equal(await db.emailJob.count(),0)}finally{await db.$executeRawUnsafe(`DROP TRIGGER fail_notice ON "${table}"`);await db.$executeRawUnsafe("DROP FUNCTION fail_notice()")}}
 const f=await fixture();const simultaneous=await Promise.all([block(f),block(f)]);assert.ok(simultaneous.every(r=>r.status===201));assert.deepEqual(simultaneous.map(r=>r.body.appointmentsNeedingRescheduling).sort(),[0,1]);const notice=await noticeFor(f.appointment.id);assert.equal(notice.disruptionVersion,2);assert.ok(notice.emailJob);assert.equal(await db.notification.count(),1);assert.equal(await db.emailJob.count(),1);assert.equal(JSON.stringify(notice).includes(f.appointment.reason),false);
 const beforeRead=await db.appointment.findUniqueOrThrow({where:{id:f.appointment.id}}),beforeJob=await db.emailJob.findUniqueOrThrow({where:{notificationId:notice.id}});
 assert.equal((await request("GET","/notifications",patient)).status,200);assert.equal((await request("GET","/notifications",other)).body.data.length,0);assert.equal((await request("PATCH",`/notifications/${notice.id}/read`,other)).status,404);assert.equal((await request("PATCH","/notifications/2147483647/read",patient)).status,404);assert.equal((await request("GET","/notifications")).status,401);
 for(const actor of [admin,manager,doctor,rec]){assert.equal((await request("GET","/notifications",actor)).status,403);assert.equal((await request("PATCH",`/notifications/${notice.id}/read`,actor)).status,403)}
 const read=await request("PATCH",`/notifications/${notice.id}/read`,patient,{resolvedAt:new Date().toISOString()});assert.equal(read.status,200);assert.equal(read.body.resolvedAt,null);assert.equal((await request("PATCH",`/notifications/${notice.id}/read`,patient)).body.readAt,read.body.readAt);assert.deepEqual(await db.appointment.findUniqueOrThrow({where:{id:f.appointment.id}}),beforeRead);assert.deepEqual(await db.emailJob.findUniqueOrThrow({where:{notificationId:notice.id}}),beforeJob);assert.equal((await request("GET","/notifications?unread=true",patient)).body.data.length,0);assert.equal((await request("GET","/notifications?page=0",patient)).status,400);
 const replacement=await db.calendar.create({data:{doctorId:doctor.id,schedulePeriodId:period.id,startTime:new Date(+f.slot.startTime+3600000),endTime:new Date(+f.slot.endTime+3600000)}});
 assert.equal((await request("POST",`/appointments/${f.appointment.id}/reschedule`,patient,{currentCalendarId:f.slot.id,newCalendarId:replacement.id,expectedVersion:2})).status,200);assert.ok((await db.notification.findUniqueOrThrow({where:{id:notice.id}})).resolvedAt);assert.equal((await db.emailJob.findUniqueOrThrow({where:{notificationId:notice.id}})).status,"SKIPPED");
 assert.equal((await request("POST","/calendars/block",manager,{doctorId:doctor.id,startTime:replacement.startTime.toISOString(),endTime:replacement.endTime.toISOString()})).status,201);const newer=await noticeFor(f.appointment.id);assert.notEqual(newer.id,notice.id);assert.equal(newer.disruptionVersion,4);assert.equal(newer.slotStartTime.toISOString(),replacement.startTime.toISOString());assert.equal(await db.notification.count({where:{appointmentRef:f.appointment.id}}),2);assert.equal((await cancel(f)).status,200);
 // A failed initial booking must not add any disruption records.
 const counts=[await db.notification.count(),await db.emailJob.count()];assert.equal((await request("POST","/appointments",other,{patientId:other.id,doctorId:doctor.id,calendarId:replacement.id,reason:"Another valid visit"})).status,409);assert.deepEqual([await db.notification.count(),await db.emailJob.count()],counts);
 t.diagnostic("Atomic insertion rollback, concurrent/repeat blocking, recovery/redisruption identity, snapshots, ownership/read idempotence, cancellation and failed initial booking exclusion passed");

 await t.test("recipient-scoped action/unread pagination preserves read and resolved history", async () => {
  const owner = await user(Role.PATIENT), outsider = await user(Role.PATIENT);
  const fixtures = [];
  for (let index = 0; index < 21; index++) {
   const fixtureForOwner = await fixture(owner); assert.equal((await block(fixtureForOwner)).status, 201);
   fixtures.push({ ...fixtureForOwner, notice: await noticeFor(fixtureForOwner.appointment.id) });
  }
  const privateFixture = await fixture(outsider); await block(privateFixture); const privateNotice = await noticeFor(privateFixture.appointment.id);
  for (const value of fixtures.slice(0, 2)) assert.equal((await request("PATCH", `/notifications/${value.notice.id}/read`, owner)).status, 200);
  assert.equal((await cancel(fixtures[0])).status, 200); assert.equal((await cancel(fixtures[2])).status, 200);
  for (const [filter, count] of [["", 21], ["&unread=true", 19], ["&needsAction=true", 19], ["&needsAction=false", 2], ["&needsAction=true&unread=false", 1]] as const) {
   const collected: number[] = [];
   for (let page = 1; page <= Math.ceil(count / 5); page++) {
    const response = await request("GET", `/notifications?page=${page}&pageSize=5${filter}&recipientId=${outsider.id}`, owner);
    assert.equal(response.status, 200); assert.deepEqual(response.body.meta, { page, pageSize: 5, total: count, totalPages: Math.ceil(count / 5) });
    collected.push(...response.body.data.map((row: { id: number }) => row.id));
    assert.ok(response.body.data.every((row: { readAt: string | null; resolvedAt: string | null }) =>
      (!filter.includes("needsAction=true") || row.resolvedAt === null) && (!filter.includes("needsAction=false") || row.resolvedAt !== null) &&
      (!filter.includes("unread=true") || row.readAt === null) && (!filter.includes("unread=false") || row.readAt !== null)));
   }
   assert.equal(new Set(collected).size, count); assert.equal(collected.includes(privateNotice.id), false);
  }
  const readUnresolved = fixtures[1].notice.id;
  assert.equal((await request("GET", "/notifications?needsAction=true&unread=false", owner)).body.data[0].id, readUnresolved);
  const firstRead = await request("PATCH", `/notifications/${readUnresolved}/read`, owner);
  assert.equal((await request("PATCH", `/notifications/${readUnresolved}/read`, owner)).body.readAt, firstRead.body.readAt);
  assert.equal(firstRead.body.resolvedAt, null); assert.ok(firstRead.body.href);
  assert.equal((await request("GET", "/notifications?page=99&needsAction=true", owner)).body.data.length, 0);
  for (const invalid of ["needsAction=invalid", "needsAction=true&needsAction=false", "unread=invalid", "page=0", "pageSize=101"]) assert.equal((await request("GET", "/notifications?" + invalid, owner)).status, 400);
  assert.equal((await request("PATCH", `/notifications/${readUnresolved}/read`, outsider)).status, 404);
  assert.equal((await request("GET", "/notifications?needsAction=true")).status, 401);
  for (const actor of [admin, manager, doctor, rec]) assert.equal((await request("GET", "/notifications?needsAction=true", actor)).status, 403);
  assert.equal((await request("GET", "/notifications?needsAction=true", outsider)).body.meta.total, 1);
 });
 // Worker tests use a controllable clock rather than waiting six real minutes.
 let now=new Date();const clock=()=>new Date(now);let sent:EmailMessage[]=[];
 app.get(FollowUpsService).clock=clock;
 const ok:EmailTransport={async send(message){sent.push(message);return{messageId:message.messageId}}};
 const worker=(transport=ok)=>new EmailWorker(db,transport,"http://localhost:3350",clock);
 async function queued(){const g=await fixture();assert.equal((await block(g)).status,201);return{...g,notice:await noticeFor(g.appointment.id)}}
 async function isolate(g:Awaited<ReturnType<typeof queued>>){await db.emailJob.updateMany({where:{notificationId:{not:g.notice.id},status:{in:["PENDING","PROCESSING"]}},data:{status:"SKIPPED",claimToken:null,lockedUntil:null}});const job=await db.emailJob.findUniqueOrThrow({where:{notificationId:g.notice.id}});now=new Date(Math.max(+new Date(),+job.nextAttemptAt)+1);return job}
 let g=await queued();await isolate(g);let tries=0;sent=[];
 const temporary:EmailTransport={async send(message){sent.push(message);tries++;throw new EmailFailure(tries===1?"TEMPORARY":"AMBIGUOUS")}};
 let w=worker(temporary);assert.equal(await w.runOnce(),true);let job=await db.emailJob.findUniqueOrThrow({where:{notificationId:g.notice.id}});assert.equal(job.attemptCount,1);assert.equal(job.status,"PENDING");assert.equal(+job.nextAttemptAt-+now,60000);assert.equal(await w.runOnce(),false);
 await request("PATCH",`/notifications/${g.notice.id}/read`,patient);
 await db.user.update({where:{id:patient.id},data:{email:"changed@example.test"}});now=new Date(+job.nextAttemptAt);assert.equal(await w.runOnce(),true);job=await db.emailJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(job.attemptCount,2);assert.equal(+job.nextAttemptAt-+now,300000);assert.equal(sent[1].to,"changed@example.test");
 now=new Date(+job.nextAttemptAt);await w.runOnce();job=await db.emailJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(job.status,"FAILED");assert.equal(+job.failedAt!,+now);assert.ok((await request("GET","/rescheduling/followUps",rec)).body.data.some((row:{notificationId:number;reasons:string[]})=>row.notificationId===g.notice.id&&row.reasons.includes("EMAIL_FAILED")));assert.equal(job.attemptCount,3);now=new Date(+now+3600000);assert.equal(await w.runOnce(),false);assert.equal((await db.appointment.findUniqueOrThrow({where:{id:g.appointment.id}})).status,"NEEDS_RESCHEDULING");assert.equal((await db.notification.findUniqueOrThrow({where:{id:g.notice.id}})).resolvedAt,null);
 g=await queued();await isolate(g);await worker({async send(){throw new EmailFailure("PERMANENT_RECIPIENT")}}).runOnce();job=await db.emailJob.findUniqueOrThrow({where:{notificationId:g.notice.id}});assert.equal(job.status,"FAILED");assert.equal(job.attemptCount,1);
 // One active transport call despite concurrent workers; resolution during the external call is harmless.
 g=await queued();await isolate(g);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),hit=new Promise<void>(r=>entered=r);let calls=0;
 const held:EmailTransport={async send(message){calls++;entered();await gate;return{messageId:message.messageId}}};w=worker(held);const first=w.runOnce();await hit;assert.equal(await worker(held).runOnce(),false);assert.equal(calls,1);
 const active=await db.emailJob.findUniqueOrThrow({where:{notificationId:g.notice.id}});now=new Date(+now+LEASE_MS/2);assert.equal((await w.renew({...active,claimToken:active.claimToken!})).count,1);now=new Date(+now+LEASE_MS/2+1);assert.equal(await worker(held).runOnce(),false);
 assert.equal((await cancel(g)).status,200);release();await first;job=await db.emailJob.findUniqueOrThrow({where:{notificationId:g.notice.id}});assert.equal(job.status,"SENT");assert.ok((await db.notification.findUniqueOrThrow({where:{id:g.notice.id}})).resolvedAt);assert.equal((await db.appointment.findUniqueOrThrow({where:{id:g.appointment.id}})).status,"CANCELLED");
 // Failure completion concurrent with resolution cannot requeue that disruption.
 g=await queued();await isolate(g);w=worker();const inflight=await w.claim();assert.ok(inflight);assert.ok(await w.prepare(inflight));
 await Promise.all([cancel(g),w.complete(inflight,{failure:"TEMPORARY",permanent:false})]);assert.equal((await db.emailJob.findUniqueOrThrow({where:{id:inflight.id}})).status,"SKIPPED");
 g=await queued();await isolate(g);const expiredResolved=await worker().claim();assert.ok(expiredResolved);await worker().prepare(expiredResolved);now=new Date(+now+LEASE_MS+1);
 await Promise.all([cancel(g),worker().recoverExpired()]);assert.equal((await db.emailJob.findUniqueOrThrow({where:{id:expiredResolved.id}})).status,"SKIPPED");
 // Cancellation after claim but before final preparation skips unsent work.
 g=await queued();await isolate(g);w=worker();const claimed=await w.claim();assert.ok(claimed);await cancel(g);assert.equal(await w.prepare(claimed),null);assert.equal((await db.emailJob.findUniqueOrThrow({where:{id:claimed.id}})).status,"SKIPPED");
 // Completion really waits on PostgreSQL, and the wall-clock lease expires during that wait.
 g=await queued();await isolate(g);
 const wallWorker=new EmailWorker(db,ok,"http://localhost:3350");
 const waitingClaim=await wallWorker.claim();assert.ok(waitingClaim);
 let unlockNotice!:()=>void,noticeLocked!:()=>void;
 const lockReady=new Promise<void>(r=>noticeLocked=r),lockGate=new Promise<void>(r=>unlockNotice=r);
 const blocker=db.$transaction(async tx=>{
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Notification" WHERE id = ${g.notice.id} FOR UPDATE`);
  noticeLocked();await lockGate;
 },{timeout:10000});
 await lockReady;
 let pendingCompletion:ReturnType<EmailWorker["complete"]>|undefined;
 try {
  const expires=new Date(Date.now()+1500);
  await db.emailJob.update({where:{id:waitingClaim.id},data:{lockedUntil:expires}});
  const beforeCompletion=await db.emailJob.findUniqueOrThrow({where:{id:waitingClaim.id}});
  pendingCompletion=wallWorker.complete(waitingClaim,{messageId:"must-not-complete-expired-claim"});
  let observedWait=false;const deadline=Date.now()+1000;
  while(Date.now()<deadline){
   const waiters=await db.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT count(*) AS count FROM pg_stat_activity
    WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%Notification%' AND query LIKE '%FOR UPDATE%'`);
   if(Number(waiters[0].count)>0){observedWait=true;break}
   await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(observedWait,true,"completion did not visibly wait on PostgreSQL notification lock");
  assert.ok(Date.now()<+expires,"completion must start waiting before lease expiry");
  while(Date.now()<=+expires)await new Promise(r=>setTimeout(r,10));
  unlockNotice();await blocker;
  assert.equal((await pendingCompletion).count,0);
  assert.deepEqual(await db.emailJob.findUniqueOrThrow({where:{id:waitingClaim.id}}),beforeCompletion);
  t.diagnostic("REAL PostgreSQL lock waiter observed before expiry; lock released after expiry; completion count=0 and job/token/attempt/status unchanged");
 } finally {unlockNotice();await blocker;await pendingCompletion}
 // Crash after provider acceptance: leave the lease unfinished. Expiry preserves limits and rejects its stale completion token.
 g=await queued();await isolate(g);w=worker();const old=await w.claim();assert.ok(old);const message=await w.prepare(old);assert.ok(message);await ok.send(message);now=new Date(+now+LEASE_MS+1);await worker().recoverExpired();job=await db.emailJob.findUniqueOrThrow({where:{id:old.id}});assert.equal(job.attemptCount,1);assert.equal(job.status,"PENDING");assert.equal((await w.complete(old,{messageId:"stale"})).count,0);
 now=new Date(+job.nextAttemptAt);const second=await worker().claim();assert.ok(second);assert.notEqual(second.claimToken,old.claimToken);assert.equal(second.attemptCount,2);assert.equal((await worker().complete(old,{messageId:"stale"})).count,0);await worker().complete(second,{failure:"TEMPORARY",permanent:false});
 job=await db.emailJob.findUniqueOrThrow({where:{id:old.id}});now=new Date(+job.nextAttemptAt);const third=await worker().claim();assert.ok(third);assert.equal(third.attemptCount,3);now=new Date(+now+LEASE_MS+1);await worker().recoverExpired();job=await db.emailJob.findUniqueOrThrow({where:{id:old.id}});assert.equal(job.status,"FAILED");assert.equal(job.attemptCount,3);assert.equal(await worker().claim(),null);
 t.diagnostic("1-minute/5-minute retries, current email each attempt, permanent rejection, exhaustion, independent notice/state preservation, concurrent workers, cancellation before/during send, expired leases and stale tokens passed");

 // Capture real SMTP in Mailpit. The fake crash test above demonstrates the accepted-but-unrecorded ambiguity.
 const mailpit=process.env.MEDISLOT_MAILPIT_HTTP;assert.ok(mailpit);g=await queued();await isolate(g);const smtp=new MailpitTransport("127.0.0.1",1025);sent=[];
 await worker(smtp).runOnce();job=await db.emailJob.findUniqueOrThrow({where:{notificationId:g.notice.id}});assert.equal(job.status,"SENT");const captured=await(await fetch(mailpit+"/api/v1/messages")).json();assert.ok(captured.total>=1);assert.ok(captured.messages.some((m:{Subject:string})=>m.Subject==="Your appointment needs rescheduling"));assert.equal(job.attemptCount,1);
 // Real Mailpit acceptance followed by a simulated process crash yields a second captured SMTP message on recovery, as documented.
 const h=await queued();await isolate(h);w=worker(smtp);const lost=await w.claim();assert.ok(lost);const accepted=await w.prepare(lost);assert.ok(accepted);await smtp.send(accepted);const beforeDuplicate=(await(await fetch(mailpit+"/api/v1/messages")).json()).total;
 now=new Date(+now+LEASE_MS+1);await worker(smtp).recoverExpired();job=await db.emailJob.findUniqueOrThrow({where:{id:lost.id}});now=new Date(+job.nextAttemptAt);await worker(smtp).runOnce();assert.ok((await(await fetch(mailpit+"/api/v1/messages")).json()).total>beforeDuplicate);
 await cancel(g);await cancel(h);
 // A fresh OS worker process recovers a durable accepted-but-uncompleted job.
 const restart=await queued();await isolate(restart);const reserved=await worker(smtp).claim();assert.ok(reserved);const outbound=await worker(smtp).prepare(reserved);assert.ok(outbound);await smtp.send(outbound);
 await db.emailJob.update({where:{id:reserved.id},data:{lockedUntil:new Date(Date.now()-120000)}});
 const child=spawn(process.execPath,[resolve(__dirname,"../src/email/main.js")],{env:{...process.env,DATABASE_URL:url.href,MAIL_MODE:"mailpit",SMTP_HOST:"127.0.0.1",SMTP_PORT:"1025",APP_BASE_URL:"http://localhost:3350"},stdio:"ignore"});
 let exit!:()=>void;const exited=new Promise<void>(r=>exit=r);child.once("exit",()=>exit());
 try {
  const deadline=Date.now()+10000;let delivered=false;
  while(Date.now()<deadline){const state=await db.emailJob.findUniqueOrThrow({where:{id:reserved.id}});if(state.status==="SENT"){assert.equal(state.attemptCount,2);delivered=true;break}await new Promise(r=>setTimeout(r,25))}
  assert.equal(delivered,true,"fresh worker process did not recover durable job");
 }finally{child.kill("SIGTERM");await exited}
 await cancel(restart);
 t.diagnostic("A fresh email-worker OS process recovered the durable expired job, used attempt 2 and completed real SMTP capture");
 // Approved deletion: preserve records, stop unsent jobs and detach, rather than preventing deletion because notices exist.
 const disposable=await user(Role.PATIENT);const deleted=await queuedFor(disposable);await isolate(deleted);await cancel(deleted);const nId=deleted.notice.id,jId=deleted.notice.emailJob!.id;
 assert.equal((await request("DELETE",`/users/${disposable.id}`,admin)).status,200);const detached=await db.notification.findUniqueOrThrow({where:{id:nId}});assert.equal(detached.recipientId,null);assert.equal(detached.appointmentId,null);assert.ok(detached.resolvedAt);assert.equal((await db.emailJob.findUniqueOrThrow({where:{id:jId}})).status,"SKIPPED");assert.equal(await db.user.findUnique({where:{id:disposable.id}}),null);
 async function queuedFor(owner:Actor){const originalUser=await db.user.findUniqueOrThrow({where:{id:owner.id}});const f=await fixture(originalUser);await block(f);return{...f,notice:await noticeFor(f.appointment.id)}}
 const appDelete=await queued();await isolate(appDelete);await cancel(appDelete);assert.equal((await request("DELETE",`/appointments/${appDelete.appointment.id}`,admin)).status,200);assert.equal((await db.notification.findUniqueOrThrow({where:{id:appDelete.notice.id}})).appointmentId,null);assert.ok(await db.emailJob.findUnique({where:{notificationId:appDelete.notice.id}}));
 t.diagnostic("Real Mailpit SMTP acceptance captured; accepted-then-crashed SMTP duplicate reproduced; deletion preserves and detaches records without a new notification-history deletion block");
});
