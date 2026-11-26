import { statusRequestFixture } from "./status-request-fixture";
import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { Role, Prisma } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { UsersService } from "../src/users/users.service";
import { FollowUpsService } from "../src/follow-ups/follow-ups.service";
import { EmailWorker } from "../src/email/worker";
import { MailpitTransport } from "../src/email/mailpit-transport";

test("patient closure: HTTP, preserved history, boundaries, rollback, races, tokens and capture-only email", async t => {
 const url=new URL(process.env.MEDISLOT_TEST_DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/medislot_closure_test");process.env.DATABASE_URL=url.href;process.env.JWT_SECRET="closure-test";
 const app=await NestFactory.create(AppModule,{logger:false}), db=app.get(PrismaService),users=app.get(UsersService);
 app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true}));await app.listen(0,"127.0.0.1");const base=await app.getUrl();t.after(async()=>{await app.close();await db.$disconnect()});
 const password="ClosureTest123!",hash=await bcrypt.hash(password,4);let seq=0;
 const user=(role:Role=Role.PATIENT)=>db.user.create({data:{name:"Synthetic "+ ++seq,email:`closure${seq}@example.test`,password:hash,role,phone:role===Role.PATIENT?"+48500100200":null,specialization:role===Role.DOCTOR?"ENT":null}});
 const admin=await user(Role.ADMIN), rec=await user(Role.RECEPTIONIST),mgr=await user(Role.MANAGER),doctor=await user(Role.DOCTOR), patient=await user(),other=await user();
 const token=(u:{id:number;role:Role;authVersion:number})=>jwt.sign({sub:u.id,role:u.role,authVersion:u.authVersion},"closure-test",{expiresIn:"1h"});
 const request=async(method:string,path:string,actor?:typeof patient|string,body?:object)=>{body=await statusRequestFixture(db,method,path,body);const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(actor?{Authorization:"Bearer "+(typeof actor==="string"?actor:token(actor))}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json().catch(()=>null)}};
 const payload=()=>({currentPassword:password,confirmed:true,requestId:randomUUID()});
 const close=(p:typeof patient,b=payload())=>request("POST","/users/me/close",p,b);
 const period=await db.schedulePeriod.create({data:{doctorId:doctor.id,publishedById:admin.id,startDate:new Date("2020-01-01"),endDate:new Date("2040-12-31"),workingWeekdays:[1],dailyStartTime:"00:00",dailyEndTime:"23:59",slotDurationMinutes:30,excludedDates:[],removedSlotIds:[]}});
 const slot=(start:Date,end=new Date(+start+1800000))=>db.calendar.create({data:{doctorId:doctor.id,schedulePeriodId:period.id,startTime:start,endTime:end}});
 const appointment=async(p=patient,start=new Date(Date.now()+86400000),status:"CONFIRMED"|"NEEDS_RESCHEDULING"|"CANCELLED"|"COMPLETED"|"NO_SHOW"="CONFIRMED",blocked=false,end?:Date)=>{
  const c=await slot(start,end);await db.calendar.update({where:{id:c.id},data:{isBooked:status==="CONFIRMED"||status==="NEEDS_RESCHEDULING",isBlocked:blocked}});
  return db.appointment.create({data:{patientId:p.id,doctorId:doctor.id,calendarId:c.id,status,reason:"Retained private visit reason"},include:{calendar:true}});
 };
 const notice=async(a:Awaited<ReturnType<typeof appointment>>)=>db.notification.create({data:{recipientId:a.patientId,appointmentId:a.id,appointmentRef:a.id,calendarRef:a.calendarId,disruptionVersion:a.version,doctorName:doctor.name,slotStartTime:a.calendar.startTime,slotEndTime:a.calendar.endTime,emailJob:{create:{}}},include:{emailJob:true}});
 // Real current-password confirmation and actor restrictions. An arbitrary userId is not accepted as a target.
 assert.equal((await request("POST","/users/me/close",undefined,payload())).status,401);
 for(const actor of [admin,rec,mgr,doctor])assert.equal((await close(actor)).status,403);
 assert.equal((await close(patient,{...payload(),currentPassword:"wrong"})).status,401);
 assert.equal((await close(patient,{...payload(),confirmed:false})).status,400);
 assert.equal((await request("DELETE",`/users/${patient.id}`,admin)).status,409);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:patient.id}})).closedAt,null);
 const future=await appointment(), blocked=await appointment(patient,new Date(Date.now()+172800000),"CONFIRMED",true);
 const ongoing=await appointment(patient,new Date(Date.now()-60000),"CONFIRMED",false,new Date(Date.now()+60000));
 const ended=await appointment(patient,new Date(Date.now()-3600000));
 const disrupted=await appointment(patient,new Date(Date.now()-7200000),"NEEDS_RESCHEDULING",true);
 const terminal=await Promise.all(["CANCELLED","COMPLETED","NO_SHOW"].map(s=>appointment(patient,new Date(Date.now()+259200000),s as "CANCELLED"|"COMPLETED"|"NO_SHOW")));
 const n=await notice(disrupted);
 const history=await db.appointmentRescheduleHistory.create({data:{appointmentId:future.id,appointmentVersion:1,previousDoctorId:doctor.id,newDoctorId:doctor.id,previousCalendarId:future.calendarId,newCalendarId:future.calendarId,previousStartTime:future.calendar.startTime,previousEndTime:future.calendar.endTime,newStartTime:future.calendar.startTime,newEndTime:future.calendar.endTime,reason:"PATIENT_REQUESTED",actorId:patient.id}});
 const contact=await db.contactAttempt.create({data:{notificationId:n.id,actorId:rec.id,actorRef:rec.id,appointmentVersion:1,currentCalendarId:disrupted.calendarId,outcome:"NO_ANSWER",note:"Retained identifying note",idempotencyKey:randomUUID()}});
 const stable=await db.appointment.findMany({where:{id:{in:[ongoing.id,ended.id,...terminal.map(a=>a.id)]}},orderBy:{id:"asc"}});
 // Fail at the last write: all preceding cancellation, release, notice and job updates must roll back.
 const snapshot=()=>Promise.all([db.user.findUnique({where:{id:patient.id}}),db.appointment.findMany({where:{patientId:patient.id},orderBy:{id:"asc"}}),db.calendar.findMany({orderBy:{id:"asc"}}),db.notification.findMany(),db.emailJob.findMany()]);
 const before=await snapshot();await db.$executeRawUnsafe(`CREATE FUNCTION fail_closure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'forced closure failure'; END IF; RETURN NEW; END $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER fail_closure BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION fail_closure()`);
 assert.equal((await close(patient)).status,500);assert.deepEqual(await snapshot(),before);
 await db.$executeRawUnsafe(`DROP TRIGGER fail_closure ON "User"`);await db.$executeRawUnsafe(`DROP FUNCTION fail_closure()`);
 const body=payload();const results=await Promise.all([close(patient,body),close(patient,body)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results[0].body,{closed:true});
 const closed=await db.user.findUniqueOrThrow({where:{id:patient.id}});assert.ok(closed.closedAt);assert.equal(closed.name,"Closed patient");assert.match(closed.email,/@account.invalid$/);assert.equal(closed.phone,null);assert.equal(closed.password,"!CLOSED!");assert.equal(closed.authVersion,2);
 for(const a of [future,blocked,disrupted]){const saved=await db.appointment.findUniqueOrThrow({where:{id:a.id}});assert.equal(saved.status,"CANCELLED");assert.equal(saved.version,2);assert.equal(saved.reason,a.reason);const c=await db.calendar.findUniqueOrThrow({where:{id:a.calendarId}});assert.equal(c.isBooked,false);assert.equal(c.isBlocked,a.calendar.isBlocked)}
 assert.deepEqual(await db.appointment.findMany({where:{id:{in:stable.map(a=>a.id)}},orderBy:{id:"asc"}}),stable);
 assert.deepEqual(await db.appointmentRescheduleHistory.findUnique({where:{id:history.id}}),history);assert.deepEqual(await db.contactAttempt.findUnique({where:{id:contact.id}}),contact);
 const savedNotice=await db.notification.findUniqueOrThrow({where:{id:n.id}});assert.ok(savedNotice.resolvedAt);assert.equal(savedNotice.recipientId,null);assert.equal(savedNotice.appointmentId,null);assert.equal(savedNotice.appointmentRef,disrupted.id);
 assert.equal((await db.emailJob.findUniqueOrThrow({where:{notificationId:n.id}})).status,"SKIPPED");
 const receiptBefore=await snapshot();assert.equal((await close(patient,body)).status,200);assert.deepEqual(await snapshot(),receiptBefore);
 assert.equal((await close(patient)).status,401);
 for(const path of [`/users/${patient.id}`,"/notifications","/calendars"])assert.equal((await request("GET",path,patient)).status,401);
 assert.equal((await request("POST","/sessions",undefined,{email:patient.email,password})).status,401);
 assert.equal((await request("POST","/sessions",undefined,{email:closed.email,password:"!CLOSED!"})).status,401);
 assert.equal((await request("GET","/calendars",jwt.sign({sub:other.id,role:other.role},"closure-test"))).status,401);
 assert.equal((await request("GET","/calendars",jwt.sign({sub:other.id,role:other.role,authVersion:999},"closure-test"))).status,401);
 assert.equal((await request("GET","/calendars",jwt.sign({sub:9999999,role:"PATIENT",authVersion:1},"closure-test"))).status,401);
 const registered=await request("POST","/users",undefined,{name:"New identity",email:patient.email,password});assert.equal(registered.status,201);assert.notEqual(registered.body.id,patient.id);assert.equal(await db.appointment.count({where:{patientId:registered.body.id}}),0);
 const login=await request("POST","/sessions",undefined,{email:patient.email,password});assert.equal(login.status,201);assert.equal((await request("GET",`/users/${registered.body.id}/appointments`,login.body.accessToken)).body.data.length,0);
 assert.equal((await request("GET",`/appointments/${future.id}`,admin)).status,200);
 assert.equal((await request("DELETE",`/appointments/${ended.id}`,admin)).status,409);
 assert.equal((await request("PUT",`/users/${patient.id}`,admin,{name:"Restore",email:"restore@example.test"})).status,404);
 t.diagnostic("HTTP closure 200; wrong password/old token 401, missing confirmation 400, nonpatient 403; preserved unchanged ongoing/ended/terminal records and histories; replay makes zero changes; original email registers isolated new identity");
 // Closure waits on doctor lock, crosses a start boundary, then preserves the now-in-progress visit.
 const crossingPatient=await user(), crossing=await appointment(crossingPatient,new Date(Date.now()+1200),"CONFIRMED",false,new Date(Date.now()+60000));
 let release!:()=>void,locked!:()=>void;const hold=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>locked=r);
 const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${doctor.id} FOR UPDATE`;locked();await hold},{timeout:10000});await ready;
 const crossingClose=close(crossingPatient);await new Promise(r=>setTimeout(r,1600));release();await blocker;assert.equal((await crossingClose).status,200);assert.equal((await db.appointment.findUniqueOrThrow({where:{id:crossing.id}})).status,"CONFIRMED");
 // Both acquisition orders: booking/move/block/contact wins before closure, or is rejected after closure.
 for(const operation of ["booking","move","block","contact"] as const)for(const closureFirst of [false,true]){
  const p=await user(),a=await appointment(p),target=await slot(new Date(Date.now()+10*86400000+seq*3600000));
  let identity:object={};if(operation==="contact"){
   await db.appointment.update({where:{id:a.id},data:{status:"NEEDS_RESCHEDULING"}});const nn=await notice({...a,status:"NEEDS_RESCHEDULING"});identity={notificationId:nn.id,disruptionVersion:1,currentCalendarId:a.calendarId,expectedVersion:1,idempotencyKey:randomUUID(),outcome:"NO_ANSWER"};
   app.get(FollowUpsService).clock=()=>new Date("2030-01-01T11:00:00Z");
  }
  const op=()=>operation==="booking"?request("POST","/appointments",rec,{patientId:p.id,doctorId:doctor.id,calendarId:target.id,reason:"Staff booking"}):operation==="move"?request("POST",`/appointments/${a.id}/reschedule`,rec,{currentCalendarId:a.calendarId,newCalendarId:target.id,expectedVersion:1}):operation==="block"?request("POST","/calendars/block",mgr,{doctorId:doctor.id,startTime:a.calendar.startTime.toISOString(),endTime:a.calendar.endTime.toISOString()}):request("POST",`/appointments/${a.id}/contactAttempts`,rec,identity);
  // Start both behind a real PostgreSQL row lock; FIFO acquisition makes each order explicit.
  let go!:()=>void,held!:()=>void;const gate=new Promise<void>(r=>go=r),acquired=new Promise<void>(r=>held=r);
  const lock=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${doctor.id} FOR UPDATE`;held();await gate},{timeout:10000});await acquired;
  const first=closureFirst?close(p):op();await new Promise(r=>setTimeout(r,75));const second=closureFirst?op():close(p);await new Promise(r=>setTimeout(r,75));go();await lock;
  const [r1,r2]=await Promise.all([first,second]);const cr=closureFirst?r1:r2,orr=closureFirst?r2:r1;assert.equal(cr.status,200,operation+JSON.stringify(cr));
  assert.equal(orr.status,operation==="block"?201:closureFirst?409:operation==="move"?200:201,operation+JSON.stringify(orr));
  assert.equal(await db.appointment.count({where:{patientId:p.id,status:{in:["CONFIRMED","NEEDS_RESCHEDULING"]}}}),0);
  assert.equal(await db.notification.count({where:{recipientId:p.id,resolvedAt:null}}),0);
 }
 t.diagnostic("PostgreSQL lock-wait boundary and concurrent booking/move/block/contact in both orders passed");
 // A previously claimed but not prepared email is fenced. Only synthetic Mailpit is used for delivery.
 const emailPatient=await user(),emailApp=await appointment(emailPatient,new Date(Date.now()+86400000),"NEEDS_RESCHEDULING"),emailNotice=await notice(emailApp);
 await db.emailJob.updateMany({where:{id:{not:emailNotice.emailJob!.id},status:"PENDING"},data:{status:"SKIPPED"}});
 const worker=new EmailWorker(db,new MailpitTransport("127.0.0.1",1025),"http://localhost:3350");const claim=await worker.claim();assert.equal(claim?.notificationId,emailNotice.id);
 assert.equal((await close(emailPatient)).status,200);assert.equal(await worker.prepare(claim!),null);assert.equal((await worker.complete(claim!,{failure:"TEMPORARY",permanent:false})).count,0);
 // Preparation is the point of no recall: closure must stop retries but cannot unsend the accepted message.
 const inFlightPatient=await user(),inFlightApp=await appointment(inFlightPatient,new Date(Date.now()+86400000),"NEEDS_RESCHEDULING"),inFlightNotice=await notice(inFlightApp);
 const activeClaim=await worker.claim();assert.equal(activeClaim?.notificationId,inFlightNotice.id);const message=await worker.prepare(activeClaim!);assert.ok(message);
 assert.equal((await close(inFlightPatient)).status,200);const accepted=await new MailpitTransport("127.0.0.1",1025).send(message!);assert.equal((await worker.complete(activeClaim!,accepted)).count,0);
 assert.equal((await worker.renew(activeClaim!)).count,0);
 assert.equal((await db.emailJob.findUniqueOrThrow({where:{id:activeClaim!.id}})).status,"SKIPPED");assert.equal((await request("GET","/notifications",inFlightPatient)).status,401);
 // Actual contention on the notification row orders worker preparation versus closure both ways.
 for (const closureFirst of [true, false]) {
  const p = await user(), a = await appointment(p, new Date(Date.now()+86400000), "NEEDS_RESCHEDULING"), n = await notice(a);
  const c = await worker.claim(); assert.equal(c?.notificationId,n.id);
  let unblock!:()=>void, acquired!:()=>void;
  const gate=new Promise<void>(r=>unblock=r),ready=new Promise<void>(r=>acquired=r);
  const holder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Notification" WHERE id=${n.id} FOR UPDATE`;acquired();await gate},{timeout:10000});await ready;
  const first=closureFirst?close(p):worker.prepare(c!);await new Promise(r=>setTimeout(r,100));
  const second=closureFirst?worker.prepare(c!):close(p);await new Promise(r=>setTimeout(r,100));unblock();await holder;
  const [r1,r2]=await Promise.all([first,second]);const cr=(closureFirst?r1:r2) as {status:number},prepared=closureFirst?r2:r1;
  assert.equal(cr.status,200);assert.equal(prepared===null,closureFirst);
  const job=await db.emailJob.findUniqueOrThrow({where:{id:c!.id}});assert.equal(job.status,"SKIPPED");assert.equal(job.claimToken,null);assert.equal((await worker.renew(c!)).count,0);
 }
 const targetPatient=await user(),actorPatient=await user();
 assert.equal((await request("POST","/users/me/close",actorPatient,{...payload(),userId:targetPatient.id,patientId:targetPatient.id})).status,200);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:targetPatient.id}})).closedAt,null);
 assert.equal((await request("DELETE",`/users/${doctor.id}`,admin)).status,409);
 const legacyDoctor=await user(Role.DOCTOR),legacyPatient=await user();
 const legacySlot=await db.calendar.create({data:{doctorId:legacyDoctor.id,startTime:new Date(Date.now()-7200000),endTime:new Date(Date.now()-3600000),isBooked:true}});
 const legacyVisit=await db.appointment.create({data:{doctorId:legacyDoctor.id,patientId:legacyPatient.id,calendarId:legacySlot.id,reason:"Retained without move history"}});
 assert.equal((await close(legacyPatient)).status,200);
 const retainedSnapshot=()=>Promise.all([
   db.user.findMany({orderBy:{id:"asc"}}),db.appointment.findMany({orderBy:{id:"asc"}}),db.calendar.findMany({orderBy:{id:"asc"}}),
   db.notification.findMany({orderBy:{id:"asc"}}),db.emailJob.findMany({orderBy:{id:"asc"}}),db.contactAttempt.findMany({orderBy:{id:"asc"}}),db.appointmentRescheduleHistory.findMany({orderBy:{id:"asc"}}),
 ]);
 const retainedBefore=await retainedSnapshot();
 for(const path of [`/doctors/${legacyDoctor.id}`,`/users/${legacyDoctor.id}`,`/users/${legacyPatient.id}`,`/appointments/${legacyVisit.id}`,`/calendars/${legacySlot.id}`]) {
   const denied=await request("DELETE",path,admin);assert.equal(denied.status,409,path+JSON.stringify(denied));assert.deepEqual(await retainedSnapshot(),retainedBefore,path+" changed retained data");
 }
 assert.ok(await db.appointment.findUnique({where:{id:legacyVisit.id}}));
 // The closure commits while both deletion endpoints wait for the same doctor lock.
 // In particular /users must not retain a pre-wait Serializable snapshot of closedAt.
 for(const route of ["users","doctors"]){
   const d=await user(Role.DOCTOR),p=await user();
   const c=await db.calendar.create({data:{doctorId:d.id,startTime:new Date(Date.now()-7200000),endTime:new Date(Date.now()-3600000),isBooked:true}});
   const a=await db.appointment.create({data:{doctorId:d.id,patientId:p.id,calendarId:c.id,reason:"Retained concurrent legacy visit"}});
   let release!:()=>void, acquired!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>acquired=r);
   const holder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${d.id} FOR UPDATE`;acquired();await gate},{timeout:10000});await ready;
   const closing=close(p);await new Promise(r=>setTimeout(r,100));const deleting=request("DELETE",`/${route}/${d.id}`,admin);await new Promise(r=>setTimeout(r,100));release();await holder;
   assert.equal((await closing).status,200);assert.equal((await deleting).status,409);assert.deepEqual(await db.appointment.findUnique({where:{id:a.id}}),a);assert.ok(await db.calendar.findUnique({where:{id:c.id}}));assert.ok(await db.user.findUnique({where:{id:d.id}}));
 }
 t.diagnostic("Closed-patient ended legacy history without move records: doctor/user/patient/appointment/calendar deletion all return 409 with zero changes; both doctor deletion routes recheck closure after real lock waits");

 t.diagnostic("Worker preparation/closure contended on a real notification-row lock in both orders; caller identity overrides supplied target IDs; doctor deletion cannot erase closed-patient history");
 t.diagnostic("Unprepared claim suppressed/fenced; already prepared synthetic message accepted by Mailpit demonstrates documented no-recall limitation");
});
