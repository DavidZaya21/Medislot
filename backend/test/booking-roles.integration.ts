import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

test("booking roles exclude admin without altering existing reads or lifecycle actions", async t => {
 const url=new URL(process.env.MEDISLOT_TEST_DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/medislot_booking_roles_test");process.env.DATABASE_URL=url.href;process.env.JWT_SECRET="booking-roles-test";
 const app=await NestFactory.create(AppModule,{logger:false});app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true}));await app.listen(0,"127.0.0.1");const base=await app.getUrl(),db=app.get(PrismaService);t.after(async()=>{await app.close();await db.$disconnect()});
 let seq=0;const user=(role:Role)=>db.user.create({data:{name:"Synthetic "+ ++seq,email:`booking-role-${seq}@example.test`,password:"unusable",role,specialization:role==="DOCTOR"?"ENT":null}});
 const admin=await user(Role.ADMIN),rec=await user(Role.RECEPTIONIST),patient=await user(Role.PATIENT),other=await user(Role.PATIENT),manager=await user(Role.MANAGER),doctor=await user(Role.DOCTOR);
 type Actor={id:number;role:Role};async function call(method:string,path:string,actor?:Actor,body?:object){const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(actor?{Authorization:"Bearer "+jwt.sign({sub:actor.id,role:actor.role,authVersion:1},"booking-roles-test")}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json().catch(()=>null)}}
 const period=await db.schedulePeriod.create({data:{doctorId:doctor.id,publishedById:admin.id,startDate:new Date("2037-01-01"),endDate:new Date("2037-12-31"),workingWeekdays:[1],dailyStartTime:"08:00",dailyEndTime:"17:00",slotDurationMinutes:30,excludedDates:[],removedSlotIds:[]}});
 let day=0;const slot=()=>{const start=Date.parse("2037-02-01T10:00Z")+ ++day*86400000;return db.calendar.create({data:{doctorId:doctor.id,schedulePeriodId:period.id,startTime:new Date(start),endTime:new Date(start+1800000)}})};
 const available=await slot(),alternative=await slot();const body=(id:number)=>({patientId:other.id,doctorId:doctor.id,calendarId:id,reason:"Synthetic preserved reason"});
 const snapshot=async()=>JSON.stringify(await Promise.all([db.appointment.findMany({orderBy:{id:"asc"}}),db.calendar.findMany({orderBy:{id:"asc"}}),db.appointmentStatusTransition.findMany(),db.appointmentRescheduleHistory.findMany(),db.notification.findMany(),db.emailJob.findMany()]));
 let before=await snapshot();for(const actor of [admin,manager,doctor])assert.equal((await call("POST","/appointments",actor,body(available.id))).status,403);assert.equal((await call("POST","/appointments",undefined,body(available.id))).status,401);assert.equal(await snapshot(),before);
 assert.equal(await db.appointment.count(),0);assert.equal(await db.appointmentStatusTransition.count(),0);assert.equal((await db.calendar.findUniqueOrThrow({where:{id:available.id}})).isBooked,false);
 console.log("PASS ADMIN/MANAGER/DOCTOR 403; unauthenticated 401; zero appointments, reservation changes, audit/history/notices/jobs");
 const booked=await call("POST","/appointments",patient,body(available.id));assert.equal(booked.status,201);assert.equal(booked.body.patientId,patient.id);assert.equal(booked.body.version,1);
 assert.equal((await call("POST","/appointments",rec,body(available.id))).status,409);
 const suggestions=await call("GET",`/calendars/${available.id}/alternatives?patientId=${other.id}`,admin);assert.equal(suggestions.status,200);assert.ok([...suggestions.body.sameDay,...suggestions.body.laterDates].some(s=>s.id===alternative.id));
 before=await snapshot();for(const id of [available.id,alternative.id])assert.equal((await call("POST","/appointments",admin,body(id))).status,403);assert.equal(await snapshot(),before);
 const assisted=await call("POST","/appointments",rec,body(alternative.id));assert.equal(assisted.status,201);assert.equal(assisted.body.patientId,other.id);
 const ownAlternative=await slot();assert.equal((await call("POST","/appointments",patient,body(ownAlternative.id))).status,201);
 assert.equal(await db.appointmentStatusTransition.count(),0);assert.equal(await db.appointmentRescheduleHistory.count(),0);
 console.log("PASS patient self-booking ignores supplied other identity; receptionist booking and alternative bookings 201; admin taken/alternative submission 403 with identical database snapshot");
 const list=await call("GET","/appointments",admin);assert.equal(list.status,200);assert.equal(list.body.data.length,3);assert.equal((await call("GET","/appointments?status=CONFIRMED",admin)).status,200);assert.equal((await call("GET",`/appointments/${booked.body.id}`,admin)).status,200);
 const cancelled=await call("PUT",`/appointments/${booked.body.id}`,admin,{status:"CANCELLED",expectedVersion:booked.body.version,currentCalendarId:booked.body.calendarId});assert.equal(cancelled.status,200);assert.equal(cancelled.body.reason,booked.body.reason);
 for(const status of ["COMPLETED","NO_SHOW"]){const c=await db.calendar.create({data:{doctorId:doctor.id,startTime:new Date("2020-01-01T10:00Z"),endTime:new Date("2020-01-01T10:30Z"),isBooked:true}});const a=await db.appointment.create({data:{doctorId:doctor.id,patientId:patient.id,calendarId:c.id,reason:"Synthetic ended visit"}});const r=await call("PUT",`/appointments/${a.id}`,admin,{status,expectedVersion:1,currentCalendarId:c.id});assert.equal(r.status,200);assert.equal(r.body.status,status);assert.equal((await db.calendar.findUniqueOrThrow({where:{id:c.id}})).isBooked,true)}
 assert.equal(await db.appointmentStatusTransition.count(),3);assert.equal(await db.emailJob.count(),0);
 console.log("PASS admin list/detail/filter 200; cancellation/Complete/No-show 200 with three legitimate status audits and preserved historical reservations; no email processing");
});
