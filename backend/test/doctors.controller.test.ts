import assert from "node:assert/strict";
import test from "node:test";
import { AppointmentStatus, Specialization } from "@prisma/client";

import { DoctorsController } from "../src/doctors/doctors.controller";
import { DoctorsService } from "../src/doctors/doctors.service";
import { createSpy } from "./helpers";

test("GET /doctors lists doctors", async () => {
  const response = { data: [{ id: 5, specialization: Specialization.CARDIOLOGY }] };
  const listDoctors = createSpy(async (query?: unknown) => response);
  const service = { listDoctors: listDoctors.fn } as unknown as DoctorsService;
  const controller = new DoctorsController(service);

  const query = { search: "anna", specialization: Specialization.CARDIOLOGY };
  const result = await controller.listDoctors(query);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(listDoctors.calls, [[query]]);
});

test("POST /doctors creates a doctor", async () => {
  const response = { id: 5, role: "DOCTOR" };
  const createDoctor = createSpy(async (input: unknown) => response);
  const service = { createDoctor: createDoctor.fn } as unknown as DoctorsService;
  const controller = new DoctorsController(service);
  const body = {
    name: "Dr. Anna",
    email: "doctor@example.com",
    password: "password123",
    specialization: Specialization.CARDIOLOGY,
  };

  const result = await controller.createDoctor(body);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(createDoctor.calls, [[body]]);
});

test("GET /doctors/:doctorId returns a doctor", async () => {
  const response = { id: 5, specialization: Specialization.CARDIOLOGY };
  const getDoctorById = createSpy(async (doctorId: number) => response);
  const service = { getDoctorById: getDoctorById.fn } as unknown as DoctorsService;
  const controller = new DoctorsController(service);

  const result = await controller.getDoctorById(5);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(getDoctorById.calls, [[5]]);
});

test("PUT /doctors/:doctorId updates a doctor", async () => {
  const response = { id: 5, specialization: Specialization.NEUROLOGY };
  const updateDoctorById = createSpy(async (doctorId: number, input: unknown) => response);
  const service = { updateDoctorById: updateDoctorById.fn } as unknown as DoctorsService;
  const controller = new DoctorsController(service);
  const body = { specialization: Specialization.NEUROLOGY };

  const result = await controller.updateDoctorById(5, body);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(updateDoctorById.calls, [[5, body]]);
});

test("DELETE /doctors/:doctorId deletes a doctor", async () => {
  const deleteDoctorById = createSpy(async (doctorId: number) => undefined);
  const service = { deleteDoctorById: deleteDoctorById.fn } as unknown as DoctorsService;
  const controller = new DoctorsController(service);

  await controller.deleteDoctorById(5);

  assert.deepStrictEqual(deleteDoctorById.calls, [[5]]);
});

test("GET /doctors/:doctorId/appointments lists doctor appointments", async () => {
  const response = { data: [{ id: 12, status: AppointmentStatus.CONFIRMED }] };
  const listAppointmentsByDoctor = createSpy(
    async (doctorId: number, status?: AppointmentStatus) => response,
  );
  const service = {
    listAppointmentsByDoctor: listAppointmentsByDoctor.fn,
  } as unknown as DoctorsService;
  const controller = new DoctorsController(service);

  const result = await controller.listAppointmentsByDoctor(5, {
    status: AppointmentStatus.CONFIRMED,
  });

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(listAppointmentsByDoctor.calls, [[5, AppointmentStatus.CONFIRMED]]);
});
