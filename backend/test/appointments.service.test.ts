import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { Role } from "@prisma/client";

import { AppointmentsService } from "../src/appointments/appointments.service";

test("appointment creation rejects past calendar slots", async () => {
  const prisma = {
    user: {
      findUnique: async () => ({ id: 1, role: Role.PATIENT }),
      findFirst: async () => ({ id: 5 }),
    },
    calendar: {
      findUnique: async () => ({
        id: 3,
        doctorId: 5,
        startTime: new Date("2020-01-01T10:00:00.000Z"),
        isBooked: false,
      }),
    },
    $transaction: async () => {
      throw new Error("past slot should fail before transaction");
    },
  };
  const service = new AppointmentsService(prisma as never);

  await assert.rejects(
    () =>
      service.requestAppointment(
        {
          patientId: 1,
          doctorId: 5,
          calendarId: 3,
          reason: "Regular clinic visit",
        },
        { userId: 1, role: Role.PATIENT },
      ),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.deepStrictEqual(error.getResponse(), {
        message: "Cannot book an appointment in the past",
        code: "CONFLICT",
      });
      return true;
    },
  );
});

for (const scenario of [
  { status: "CANCELLED", end: "2020-01-01", message: "immutable" },
  { status: "CONFIRMED", end: "2099-01-01", message: "scheduled end" },
]) test(`locked appointment review rejects ${scenario.status} / ${scenario.end}`, async () => {
  const current = {id:2,patientId:3,doctorId:5,calendarId:6,version:1,status:scenario.status,
    patient:{closedAt:null},calendar:{endTime:new Date(scenario.end),startTime:new Date("2020-01-01")}};
  const tx = {$queryRaw:async()=>[{id:5}],user:{findUnique:async({where}:{where:{id:number}})=>where.id===1?{id:1,role:Role.ADMIN,closedAt:null}:{id:3,role:Role.PATIENT,closedAt:null}},
    appointment:{findUnique:async()=>current,update:async()=>{throw Error("rejected transition wrote data")}}};
  const service = new AppointmentsService({appointment:tx.appointment,$transaction:async(fn:(db:unknown)=>unknown)=>fn(tx)} as never);
  await assert.rejects(()=>service.reviewAppointment(2,{status:"COMPLETED",currentCalendarId:6,expectedVersion:1},{userId:1,role:Role.ADMIN}),error=>{
    assert.ok(error instanceof ConflictException);assert.match(error.message,new RegExp(scenario.message));return true;
  });
});

test("booking service rejects admin, manager and doctor before reading or writing", async () => {
  const service = new AppointmentsService({} as never);
  for (const role of [Role.ADMIN, Role.MANAGER, Role.DOCTOR]) {
    await assert.rejects(() => service.requestAppointment({ patientId: 1, doctorId: 2, calendarId: 3, reason: "Forbidden booking" }, { userId: 4, role }), (error: any) => error.getStatus() === 403);
  }
});
