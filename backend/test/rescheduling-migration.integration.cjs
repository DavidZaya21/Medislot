const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {Client}=require('pg');
(async()=>{
 const url=new URL(process.env.MEDISLOT_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medislot_reschedule_test');
 const db=new Client({connectionString:url.href});await db.connect();
 try{
  await db.query('CREATE SCHEMA rescheduling_migration_test');await db.query('SET search_path TO rescheduling_migration_test');
  await db.query(`CREATE TABLE "User" (id INTEGER PRIMARY KEY);INSERT INTO "User" VALUES (1);
    CREATE TABLE "Calendar" (id INTEGER PRIMARY KEY,"isBooked" BOOLEAN,"isBlocked" BOOLEAN);INSERT INTO "Calendar" VALUES (2,true,true);
    CREATE TABLE "Appointment" (id INTEGER PRIMARY KEY,"calendarId" INTEGER REFERENCES "Calendar"(id),reason TEXT,status TEXT,"createdAt" TIMESTAMP);
    INSERT INTO "Appointment" VALUES (3,2,'Original reason','NEEDS_RESCHEDULING','2026-01-01');`);
  const before=(await db.query('SELECT * FROM "Appointment"')).rows;
  const slots=(await db.query('SELECT * FROM "Calendar"')).rows;
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../prisma/migrations/20261120000000_appointment_rescheduling/migration.sql'),'utf8'));
  assert.deepEqual((await db.query('SELECT * FROM "Appointment"')).rows,before.map(row=>({...row,version:1})));
  assert.deepEqual((await db.query('SELECT * FROM "Calendar"')).rows,slots);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM "AppointmentRescheduleHistory"')).rows[0].count,0);
  console.log('PASS: rescheduling migration preserves all original appointment/slot contents, adds version=1 and creates empty history');
 }finally{await db.query('ROLLBACK');await db.query('SET search_path TO public');await db.query('DROP SCHEMA IF EXISTS rescheduling_migration_test CASCADE');await db.end()}
})().catch(e=>{console.error(e);process.exitCode=1});
