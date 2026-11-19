const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
(async () => {
  const url = new URL(process.env.MEDISLOT_TEST_DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/medislot_block_test');
  const db = new Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('CREATE SCHEMA block_migration_test');
    await db.query('SET LOCAL search_path TO block_migration_test');
    await db.query(`CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED','CANCELLED','COMPLETED','NO_SHOW');
      CREATE TABLE "Calendar" (id INTEGER PRIMARY KEY, "isBooked" BOOLEAN NOT NULL);
      CREATE TABLE "Appointment" (id INTEGER PRIMARY KEY, "calendarId" INTEGER REFERENCES "Calendar"(id), status "AppointmentStatus", reason TEXT);
      INSERT INTO "Calendar" VALUES (1,true),(2,false);
      INSERT INTO "Appointment" VALUES (3,1,'CONFIRMED','Keep original details');`);
    const before = (await db.query('SELECT * FROM "Appointment"')).rows;
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations/20261119000000_calendar_blocking/migration.sql'), 'utf8'));
    assert.deepEqual((await db.query('SELECT * FROM "Calendar" ORDER BY id')).rows,
      [{ id: 1, isBooked: true, isBlocked: false }, { id: 2, isBooked: false, isBlocked: false }]);
    assert.deepEqual((await db.query('SELECT * FROM "Appointment"')).rows, before);
    console.log('PASS: blocking migration preserves existing slots, booking flags, appointment status and reason; defaults isBlocked to false');
  } finally { await db.query('ROLLBACK'); await db.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
