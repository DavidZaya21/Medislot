import assert from "node:assert/strict";
import test from "node:test";

import { ReceptionistsController } from "../src/receptionists/receptionists.controller";
import { ReceptionistsService } from "../src/receptionists/receptionists.service";
import { createSpy } from "./helpers";

test("POST /receptionists creates a receptionist", async () => {
  const response = { id: 9, role: "RECEPTIONIST" };
  const createReceptionist = createSpy(async (input: unknown) => response);
  const service = {
    createReceptionist: createReceptionist.fn,
  } as unknown as ReceptionistsService;
  const controller = new ReceptionistsController(service);
  const body = {
    name: "Reception User",
    email: "reception@example.com",
    password: "password123",
  };

  const result = await controller.createReceptionist(body);

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(createReceptionist.calls, [[body]]);
});
