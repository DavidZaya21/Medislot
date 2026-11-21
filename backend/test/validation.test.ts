import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateAppointmentDto } from "../src/appointments/appointments.dto";
import { CalendarAlternativesQueryDto, CreateCalendarDto } from "../src/calendars/calendars.dto";
import { PatientRegistrationDto } from "../src/users/users.dto";

async function validateDto<T extends object>(dtoClass: new () => T, input: object) {
  const dto = plainToInstance(dtoClass, input);
  return validate(dto);
}

test("patient registration rejects invalid email", async () => {
  const errors = await validateDto(PatientRegistrationDto, {
    name: "Anna Kowalska",
    email: "not-an-email",
    password: "password123",
  });

  assert.ok(errors.some((error) => error.property === "email"));
});

test("calendar creation rejects non-positive doctor id", async () => {
  const errors = await validateDto(CreateCalendarDto, {
    doctorId: 0,
    startTime: "2026-05-22T10:00:00Z",
    endTime: "2026-05-22T10:30:00Z",
  });

  assert.ok(errors.some((error) => error.property === "doctorId"));
});

test("appointment creation rejects too-short reason", async () => {
  const errors = await validateDto(CreateAppointmentDto, {
    patientId: 1,
    doctorId: 5,
    calendarId: 3,
    reason: "bad",
  });

  assert.ok(errors.some((error) => error.property === "reason"));
});

test("booking alternatives preserve an omitted patientId through repeated validation transforms", async () => {
  for (const input of [{}, { patientId: undefined }]) {
    const first = plainToInstance(CalendarAlternativesQueryDto, input);
    const second = plainToInstance(CalendarAlternativesQueryDto, first);
    assert.equal(second.patientId, undefined);
    assert.deepEqual(await validate(second), []);
  }
});
