import test from "node:test";
import assert from "node:assert/strict";
import {followUpDeadline,contactAllowed,nextContactTime} from "../src/follow-ups/follow-up-policy";
import {warsawInstant} from "../src/common/clinic-time";
const hour=3600000;
test("follow-up thresholds use elapsed hours, exact 24/48 boundaries and past visits",()=>{
 const at=new Date("2026-03-28T12:00:00Z");
 for(const [remaining,delay] of [[48*hour+1,24*hour],[48*hour,4*hour],[24*hour,4*hour],[24*hour-1,0],[-hour,0]])assert.equal(+followUpDeadline(new Date(+at+remaining),at),+at+delay);
});
test("Warsaw 08:00 inclusive / 20:00 exclusive, DST openings and overdue preservation",()=>{
 for(const date of ["2026-03-29","2026-10-25","2030-01-07","2030-07-01"]){
  const eight=new Date(warsawInstant(date,"08:00")),twenty=new Date(warsawInstant(date,"20:00"));
  assert.equal(contactAllowed(eight),true);assert.equal(contactAllowed(new Date(+eight-1)),false);assert.equal(contactAllowed(twenty),false);assert.equal(contactAllowed(new Date(+twenty-1)),true);assert.equal(+nextContactTime(eight),+eight);
 }
 assert.equal(nextContactTime(new Date("2026-03-28T20:00:00Z")).toISOString(),"2026-03-29T06:00:00.000Z");
 assert.equal(nextContactTime(new Date("2026-10-24T20:00:00Z")).toISOString(),"2026-10-25T07:00:00.000Z");
 const overdue=new Date("2026-03-28T15:00:00Z");assert.equal(+nextContactTime(overdue),+overdue);
});
