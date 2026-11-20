import assert from "node:assert/strict";
import test from "node:test";
import { ensureMoveCutoff } from "../src/common/rescheduling-policy";

test("rescheduling cutoff boundaries and recovery rules", () => {
  const now = Date.parse("2030-01-01T10:00:00Z");
  const start = (delta: number) => new Date(now + delta);
  const day = 86_400_000;
  assert.doesNotThrow(() => ensureMoveCutoff("CONFIRMED", start(day), "PATIENT", now));
  assert.throws(() => ensureMoveCutoff("CONFIRMED", start(day - 1), "PATIENT", now));
  assert.doesNotThrow(() => ensureMoveCutoff("CONFIRMED", start(1), "RECEPTIONIST", now));
  assert.throws(() => ensureMoveCutoff("CONFIRMED", start(0), "RECEPTIONIST", now));
  for (const role of ["PATIENT", "RECEPTIONIST"] as const) {
    assert.doesNotThrow(() => ensureMoveCutoff("NEEDS_RESCHEDULING", start(-day), role, now));
    for (const status of ["CANCELLED", "COMPLETED", "NO_SHOW"] as const) {
      assert.throws(() => ensureMoveCutoff(status, start(day * 2), role, now));
    }
  }
});
