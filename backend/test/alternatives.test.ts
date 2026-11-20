import assert from "node:assert/strict";
import test from "node:test";
import { rankAlternatives, recommendationWindow } from "../src/common/rescheduling-recommendations";

const slot = (id: number, doctorId: number, start: string) => ({ id, doctorId, startTime: new Date(start) });

test("alternatives rank independent capped groups with deterministic proximity/time/doctor/slot ties", () => {
  const anchor = new Date("2030-01-07T10:00:00Z");
  const slots = [slot(7, 3, "2030-01-07T10:15:00Z"), slot(6, 3, "2030-01-07T09:45:00Z"),
    slot(5, 2, "2030-01-07T09:45:00Z"), slot(4, 2, "2030-01-07T09:45:00Z"),
    slot(8, 1, "2030-01-07T11:00:00Z"), slot(9, 1, "2030-01-08T09:00:00Z"),
    slot(11, 1, "2030-01-08T08:00:00Z"), slot(10, 1, "2030-01-08T08:00:00Z"),
    slot(12, 1, "2030-01-09T08:00:00Z"), slot(13, 2, "2030-01-08T08:00:00Z")];
  for (const input of [slots, [...slots].reverse()]) {
    const result = rankAlternatives(input, 1, anchor);
    assert.deepEqual(result.keepYourDay.map(s => s.id), [4, 5, 6]);
    assert.deepEqual(result.keepYourDoctor.map(s => s.id), [10, 11, 9]);
  }
});

test("Warsaw recommendation window uses civil days across spring and autumn DST, including day 14", () => {
  for (const [anchor, startDate, start, nextDay, end] of [
    ["2030-03-30T23:30:00Z", "2030-03-31", "2030-03-30T23:00:00.000Z", "2030-03-31T22:00:00.000Z", "2030-04-14T22:00:00.000Z"],
    ["2030-10-26T22:30:00Z", "2030-10-27", "2030-10-26T22:00:00.000Z", "2030-10-27T23:00:00.000Z", "2030-11-10T23:00:00.000Z"],
  ]) {
    const bounds = recommendationWindow(new Date(anchor));
    assert.equal(bounds.startDate, startDate); assert.equal(bounds.start.toISOString(), start);
    assert.equal(bounds.nextDay.toISOString(), nextDay); assert.equal(bounds.endExclusive.toISOString(), end);
    const last = slot(1, 1, new Date(bounds.endExclusive.getTime() - 1).toISOString());
    const after = slot(2, 1, end);
    assert.deepEqual(rankAlternatives([after, last], 1, new Date(anchor)).keepYourDoctor.map(s => s.id), [1]);
    assert.equal(rankAlternatives([slot(3, 2, new Date(bounds.nextDay.getTime() - 1).toISOString()), slot(4, 2, nextDay)], 1, new Date(anchor)).keepYourDay.length, 1);
  }
});

test("repeated Warsaw autumn hour ranks actual instants, without conflating equal wall times", () => {
  const result = rankAlternatives([
    slot(1, 2, "2030-10-27T01:15:00Z"), // 02:15 CET, 45 minutes after anchor
    slot(2, 2, "2030-10-27T00:15:00Z"), // 02:15 CEST, 15 minutes before anchor
  ], 1, new Date("2030-10-27T00:30:00Z"));
  assert.deepEqual(result.keepYourDay.map(s => s.id), [2, 1]);
});
