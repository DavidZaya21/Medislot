import assert from "node:assert/strict";
import test from "node:test";

import { HealthController } from "../src/health/health.controller";

test("GET /health returns ok status", () => {
  const controller = new HealthController();

  assert.deepStrictEqual(controller.getHealth(), { status: "ok" });
});
