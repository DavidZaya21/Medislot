import assert from "node:assert/strict";
import test from "node:test";

import { SessionsController } from "../src/sessions/sessions.controller";
import { SessionsService } from "../src/sessions/sessions.service";
import { createSpy } from "./helpers";

test("POST /sessions creates a session", async () => {
  const response = { token: "jwt-token" };
  const createSession = createSpy(async (email: string, password: string) => response);
  const service = { createSession: createSession.fn } as unknown as SessionsService;
  const controller = new SessionsController(service);

  const result = await controller.createSession({
    email: "anna@example.com",
    password: "password123",
  });

  assert.deepStrictEqual(result, response);
  assert.deepStrictEqual(createSession.calls, [["anna@example.com", "password123"]]);
});
