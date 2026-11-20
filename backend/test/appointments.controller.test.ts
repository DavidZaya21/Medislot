import assert from "node:assert/strict";
import test from "node:test";
import { AppointmentStatus, Role } from "@prisma/client";

import { AppointmentsController } from "../src/appointments/appointments.controller";
import { AppointmentsService } from "../src/appointments/appointments.service";
import { createSpy } from "./helpers";

test("GET /appointments lists appointments", async () => {
  const response = { data: [{ id: 1, status: AppointmentStatus.CONFIRMED }] };
  const listAppointments = createSpy(async (status?: AppointmentStatus) => response);
  const service = { listAppointments: listAppointments.fn } as unknown as AppointmentsService;
  const controller = new AppointmentsController(service);

  const result = await controller.listAppointments({ status: AppointmentStatus.CONFIRMED });

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(listAppointments.calls, [[AppointmentStatus.CONFIRMED]]);
});

test("POST /appointments creates an appointment", async () => {
  const response = { id: 1, status: AppointmentStatus.CONFIRMED };
  const requestAppointment = createSpy(async (input: unknown, currentUser: unknown) => response);
  const service = {
    requestAppointment: requestAppointment.fn,
  } as unknown as AppointmentsService;
  const controller = new AppointmentsController(service);
  const body = {
    patientId: 1,
    doctorId: 5,
    calendarId: 3,
    reason: "Regular clinic visit",
  };

  const currentUser = { userId: 9, role: Role.RECEPTIONIST };
  const result = await controller.requestAppointment(body, currentUser);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(requestAppointment.calls, [[body, currentUser]]);
});

test("GET /appointments/:appointmentId returns an appointment", async () => {
  const response = { id: 1, status: AppointmentStatus.CONFIRMED };
  const getAppointmentById = createSpy(async (appointmentId: number, currentUser: unknown) => response);
  const service = {
    getAppointmentById: getAppointmentById.fn,
  } as unknown as AppointmentsService;
  const controller = new AppointmentsController(service);

  const currentUser = { userId: 4, role: Role.PATIENT };
  const result = await controller.getAppointmentById(1, currentUser);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(getAppointmentById.calls, [[1, currentUser]]);
});

test("PUT /appointments/:appointmentId updates an appointment", async () => {
  const response = { id: 1, status: AppointmentStatus.COMPLETED };
  const reviewAppointment = createSpy(
    async (appointmentId: number, input: unknown) => response,
  );
  const service = {
    reviewAppointment: reviewAppointment.fn,
  } as unknown as AppointmentsService;
  const controller = new AppointmentsController(service);
  const body = {
    status: AppointmentStatus.COMPLETED,
    reason: "Visit completed successfully",
  };

  const result = await controller.reviewAppointment(1, body);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(reviewAppointment.calls, [[1, body]]);
});

test("DELETE /appointments/:appointmentId deletes an appointment", async () => {
  const deleteAppointment = createSpy(async (appointmentId: number) => undefined);
  const service = { deleteAppointment: deleteAppointment.fn } as unknown as AppointmentsService;
  const controller = new AppointmentsController(service);

  await controller.deleteAppointment(1);

  assert.deepStrictEqual(deleteAppointment.calls, [[1]]);
});
