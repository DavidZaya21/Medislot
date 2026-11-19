const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const path = require("node:path");

const file = path.resolve(__dirname, "../app/lib/clinicTime.ts");
const compiled = new Module(file, module);
compiled.filename = file;
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { clinicDate, clinicTime, clinicDateTime, clinicLocalToISO } = compiled.exports;

for (const zone of ["Europe/Warsaw", "America/New_York"]) {
  process.env.TZ = zone;
  assert.equal(clinicLocalToISO("2030-01-07T09:00"), "2030-01-07T08:00:00.000Z");
  assert.equal(clinicLocalToISO("2030-07-01T09:00"), "2030-07-01T07:00:00.000Z");
  for (const invalid of ["2026-03-29T02:30", "2026-10-25T02:30", "2026-02-30T09:00"]) {
    assert.throws(() => clinicLocalToISO(invalid));
  }
  for (const [instant, date, time] of [
    ["2030-01-06T23:00:00Z", "2030-01-07", "00:00"],
    ["2030-01-07T22:59:00Z", "2030-01-07", "23:59"],
    ["2030-06-30T22:00:00Z", "2030-07-01", "00:00"],
    ["2030-07-01T21:59:00Z", "2030-07-01", "23:59"],
    ["2026-03-29T01:30:00Z", "2026-03-29", "03:30"],
    ["2026-10-25T01:30:00Z", "2026-10-25", "02:30"],
  ]) {
    assert.equal(clinicDate(instant), date);
    assert.equal(clinicTime(instant), time);
    assert.equal(clinicDateTime(instant), date + " " + time);
  }
}
console.log("PASS: clinic formatting is independent of device timezone, including midnight, summer/winter and DST transitions");
