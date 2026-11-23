import assert from "node:assert/strict";
import test from "node:test";

import { Role } from "@prisma/client";
import { CalendarsController } from "../src/calendars/calendars.controller";
import { CalendarsService } from "../src/calendars/calendars.service";
import { createSpy } from "./helpers";

test("GET /calendars lists calendar slots", async () => {
  const response = { data: [{ id: 1, isBooked: false }] };
  const listCalendarSlots = createSpy(async (query: unknown) => response);
  const service = { listCalendarSlots: listCalendarSlots.fn } as unknown as CalendarsService;
  const controller = new CalendarsController(service);
  const query = { doctorId: 5, date: "2026-05-22", isBooked: false };

  const result = await controller.listCalendarSlots(query, { userId: 1, role: Role.PATIENT });

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(listCalendarSlots.calls, [[query, { userId: 1, role: Role.PATIENT }]]);
});

test("POST /calendars creates a slot", async () => {
  const response = { id: 1, doctorId: 5 };
  const createCalendarSlot = createSpy(async (input: unknown) => response);
  const service = {
    createCalendarSlot: createCalendarSlot.fn,
  } as unknown as CalendarsService;
  const controller = new CalendarsController(service);
  const body = {
    doctorId: 5,
    startTime: "2026-05-22T10:00:00Z",
    endTime: "2026-05-22T10:30:00Z",
  };

  const result = await controller.createCalendarSlot(body);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(createCalendarSlot.calls, [[body]]);
});

test("GET /calendars/:calendarId returns a slot", async () => {
  const response = { id: 1, doctorId: 5 };
  const getCalendarSlotById = createSpy(async (calendarId: number) => response);
  const service = {
    getCalendarSlotById: getCalendarSlotById.fn,
  } as unknown as CalendarsService;
  const controller = new CalendarsController(service);

  const result = await controller.getCalendarSlotById(1, { userId: 1, role: Role.PATIENT });

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(getCalendarSlotById.calls, [[1, { userId: 1, role: Role.PATIENT }]]);
});

test("PUT /calendars/:calendarId updates a slot", async () => {
  const response = { id: 1, isBooked: true };
  const updateCalendarSlotById = createSpy(
    async (calendarId: number, input: unknown) => response,
  );
  const service = {
    updateCalendarSlotById: updateCalendarSlotById.fn,
  } as unknown as CalendarsService;
  const controller = new CalendarsController(service);
  const body = {
    startTime: "2026-05-22T10:00:00Z",
    endTime: "2026-05-22T10:30:00Z",
    isBooked: true,
  };

  const result = await controller.updateCalendarSlotById(1, body);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(updateCalendarSlotById.calls, [[1, body]]);
});

test("DELETE /calendars/:calendarId deletes a slot", async () => {
  const deleteCalendarSlotById = createSpy(async (calendarId: number) => undefined);
  const service = {
    deleteCalendarSlotById: deleteCalendarSlotById.fn,
  } as unknown as CalendarsService;
  const controller = new CalendarsController(service);

  await controller.deleteCalendarSlotById(1);

  assert.deepStrictEqual(deleteCalendarSlotById.calls, [[1]]);
});
