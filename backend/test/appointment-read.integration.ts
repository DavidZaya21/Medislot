import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Role, type Appointment } from "@prisma/client";
import bcrypt from "bcrypt";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

test("appointment reads enforce patient ownership, doctor assignment and route roles over HTTP", async (t) => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/medislot_appointment_read_test", "Use a fresh disposable database");
  process.env.DATABASE_URL = url.href;
  process.env.JWT_SECRET = "appointment-read-integration-test";
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const db = app.get(PrismaService);
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  assert.equal(await db.user.count(), 0);
  const password = "read-test-password", hash = await bcrypt.hash(password, 4);
  async function seed(role: Role, suffix: string) {
    const user = await db.user.create({ data: { role, name: "Test " + suffix, email: suffix + "@example.test", password: hash } });
    const response = await fetch(base + "/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password }) });
    assert.equal(response.status, 201);
    return { user, token: (await response.json()).accessToken as string };
  }
  const patient1 = await seed(Role.PATIENT, "patient1"), patient2 = await seed(Role.PATIENT, "patient2");
  const doctor1 = await seed(Role.DOCTOR, "doctor1"), doctor2 = await seed(Role.DOCTOR, "doctor2");
  const admin = await seed(Role.ADMIN, "admin"), receptionist = await seed(Role.RECEPTIONIST, "receptionist"), manager = await seed(Role.MANAGER, "manager");
  const appointments: Appointment[] = [];
  for (const [patient, doctor] of [[patient1, doctor1], [patient2, doctor2]]) {
    const startTime = new Date(Date.now() + 86_400_000);
    const calendar = await db.calendar.create({ data: { doctorId: doctor.user.id, startTime, endTime: new Date(startTime.getTime() + 1_800_000), isBooked: true } });
    appointments.push(await db.appointment.create({ data: { patientId: patient.user.id, doctorId: doctor.user.id, calendarId: calendar.id, reason: "Private synthetic visit details" } }));
  }
  const cases = [
    { caller: patient1, statuses: [200, 403] }, { caller: patient2, statuses: [403, 200] },
    { caller: doctor1, statuses: [200, 403] }, { caller: doctor2, statuses: [403, 200] },
    { caller: admin, statuses: [200, 200] }, { caller: receptionist, statuses: [200, 200] },
    { caller: manager, statuses: [403, 403] }, { caller: null, statuses: [401, 401] },
  ];
  for (const { caller, statuses } of cases) {
    for (let i = 0; i < appointments.length; i++) {
      const response = await fetch(`${base}/appointments/${appointments[i].id}`, { headers: caller ? { Authorization: "Bearer " + caller.token } : {}, signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      assert.equal(response.status, statuses[i]);
      if (response.status === 200) {
        assert.equal(body.id, appointments[i].id);
        assert.equal(body.patientId, appointments[i].patientId);
        assert.equal(body.doctorId, appointments[i].doctorId);
        assert.equal(body.reason, appointments[i].reason);
        assert.equal(body.version, 1);
        assert.equal("password" in body.patient, false);
      } else {
        assert.deepEqual(Object.keys(body).sort(), ["code", "message"]);
        assert.equal(body.code, response.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED");
        const serialized = JSON.stringify(body);
        for (const privateValue of [appointments[i].reason, patient1.user.email, patient2.user.email, doctor1.user.name, doctor2.user.name]) {
          assert.equal(serialized.includes(privateValue), false);
        }
      }
    }
    t.diagnostic(`${caller?.user.role ?? "Unauthenticated"}: appointment 1/2 HTTP ${statuses.join("/")}; denied responses contain no appointment details`);
  }
});
