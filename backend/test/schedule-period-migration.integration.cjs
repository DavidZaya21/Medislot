const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

(async () => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/medislot_publish_test");
  const db = new Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query('CREATE SCHEMA migration_preservation_test');
    await db.query('SET LOCAL search_path TO migration_preservation_test');
    await db.query(`
      CREATE TABLE "User" (id INTEGER PRIMARY KEY);
      CREATE TABLE "Calendar" (
        id INTEGER PRIMARY KEY, "doctorId" INTEGER REFERENCES "User"(id),
        "startTime" TIMESTAMP NOT NULL, "endTime" TIMESTAMP NOT NULL, "isBooked" BOOLEAN NOT NULL);
      CREATE TABLE "Appointment" (
        id INTEGER PRIMARY KEY, "calendarId" INTEGER REFERENCES "Calendar"(id));
      INSERT INTO "User" VALUES (1);
      INSERT INTO "Calendar" VALUES (2, 1, '2030-01-07 08:00', '2030-01-07 08:30', true);
      INSERT INTO "Appointment" VALUES (3, 2);
    `);
    const before = (await db.query('SELECT * FROM "Calendar"')).rows[0];
    await db.query(fs.readFileSync(path.resolve(__dirname,
      "../../prisma/migrations/20261118000000_schedule_periods/migration.sql"), "utf8"));
    const { schedulePeriodId, ...after } = (await db.query('SELECT * FROM "Calendar"')).rows[0];
    assert.equal(schedulePeriodId, null);
    assert.deepEqual(after, before);
    assert.deepEqual((await db.query('SELECT * FROM "Appointment"')).rows, [{ id: 3, calendarId: 2 }]);
    console.log("PASS: migration preserves an existing booked slot and appointment; legacy period reference remains NULL");
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
