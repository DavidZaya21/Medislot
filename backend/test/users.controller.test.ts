import assert from "node:assert/strict";
import test from "node:test";
import { AppointmentStatus, Role } from "@prisma/client";

import { UsersController } from "../src/users/users.controller";
import { UsersService } from "../src/users/users.service";
import { createSpy } from "./helpers";

test("POST /users registers a patient", async () => {
  const response = { id: 1, name: "Anna Kowalska" };
  const registerPatient = createSpy(async (input: unknown) => response);
  const service = { registerPatient: registerPatient.fn } as unknown as UsersService;
  const controller = new UsersController(service);
  const body = {
    name: "Anna Kowalska",
    email: "anna@example.com",
    password: "password123",
  };

  const result = await controller.registerPatient(body);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(registerPatient.calls, [[body]]);
});

test("GET /users lists users", async () => {
  const response = { data: [{ id: 1, role: Role.PATIENT }] };
  const listUsers = createSpy(async (role?: Role) => response);
  const service = { listUsers: listUsers.fn } as unknown as UsersService;
  const controller = new UsersController(service);

  const result = await controller.listUsers({ role: Role.RECEPTIONIST });

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(listUsers.calls, [[Role.RECEPTIONIST]]);
});

test("GET /users/:userId returns a user", async () => {
  const response = { id: 7, name: "Jan Nowak" };
  const getUserById = createSpy(async (userId: number) => response);
  const service = { getUserById: getUserById.fn } as unknown as UsersService;
  const controller = new UsersController(service);

  const result = await controller.getUserById(7);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(getUserById.calls, [[7]]);
});

test("PUT /users/:userId updates a user", async () => {
  const response = { id: 7, name: "Updated Anna" };
  const updateUserById = createSpy(async (userId: number, input: unknown) => response);
  const service = { updateUserById: updateUserById.fn } as unknown as UsersService;
  const controller = new UsersController(service);
  const body = { name: "Updated Anna", email: "updated@example.com" };

  const result = await controller.updateUserById(7, body);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(updateUserById.calls, [[7, body]]);
});

test("DELETE /users/:userId deletes a user", async () => {
  const deleteUserById = createSpy(async (userId: number) => undefined);
  const service = { deleteUserById: deleteUserById.fn } as unknown as UsersService;
  const controller = new UsersController(service);

  await controller.deleteUserById(7);

  assert.deepStrictEqual(deleteUserById.calls, [[7]]);
});

test("GET /users/:userId/appointments lists user appointments", async () => {
  const response = { data: [{ id: 10, status: AppointmentStatus.CONFIRMED }] };
  const listAppointmentsByUser = createSpy(
    async (userId: number, status?: AppointmentStatus) => response,
  );
  const service = {
    listAppointmentsByUser: listAppointmentsByUser.fn,
  } as unknown as UsersService;
  const controller = new UsersController(service);

  const result = await controller.listAppointmentsByUser(7, {
    status: AppointmentStatus.CONFIRMED,
  });

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(listAppointmentsByUser.calls, [[7, AppointmentStatus.CONFIRMED]]);
});
