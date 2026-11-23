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
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../prisma/migrations/20261121000000_disruption_notifications/migration.sql'),'utf8'));
  assert.deepEqual((await db.query('SELECT * FROM "Appointment"')).rows,before.map(row=>({...row,version:1})));
  assert.deepEqual((await db.query('SELECT * FROM "Calendar"')).rows,slots);
  for(const table of ['Notification','EmailJob']) assert.equal((await db.query('SELECT count(*)::int AS count FROM "'+table+'"')).rows[0].count,0);
  console.log('PASS: notification migration preserves existing records and fabricates no notices/jobs for pre-existing disruptions');
  await db.query(`INSERT INTO "Notification" ("recipientId","appointmentId","appointmentRef","disruptionVersion","calendarRef","doctorName","slotStartTime","slotEndTime","createdAt") VALUES (1,3,3,1,2,'Synthetic','2030-01-07 10:00','2030-01-07 10:30','2026-01-01 12:00');
    INSERT INTO "EmailJob" ("notificationId",status,"updatedAt") SELECT id,'FAILED','2026-01-01 12:05' FROM "Notification";`);
  const oldNotice=(await db.query('SELECT * FROM "Notification" ORDER BY id')).rows[0],oldJob=(await db.query('SELECT * FROM "EmailJob"')).rows[0];
  await db.query(`INSERT INTO "Notification" ("recipientId","appointmentId","appointmentRef","disruptionVersion","calendarRef","doctorName","slotStartTime","slotEndTime","createdAt","resolvedAt") VALUES (1,3,3,2,2,'Resolved legacy','2030-01-07 10:00','2030-01-07 10:30','2026-01-01 12:00','2026-01-01 13:00');`);
  const allOldNotices=(await db.query('SELECT * FROM "Notification" ORDER BY id')).rows;
  const beforeFallback=(await db.query('SELECT clock_timestamp() AS now')).rows[0].now;
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../prisma/migrations/20261123000000_reception_follow_ups/migration.sql'),'utf8'));
  const afterFallback=(await db.query('SELECT clock_timestamp() AS now')).rows[0].now;
  const migratedNotice=(await db.query('SELECT * FROM "Notification" ORDER BY id')).rows[0],migratedJob=(await db.query('SELECT * FROM "EmailJob"')).rows[0];
  const {followUpDeadlineAt,legacyFollowUpEscalatedAt,...preservedNotice}=migratedNotice,{failedAt,...preservedJob}=migratedJob;
  assert.deepEqual(preservedNotice,oldNotice);assert.deepEqual(preservedJob,oldJob);assert.equal(followUpDeadlineAt,null);const absoluteFallback=(await db.query('SELECT "legacyFollowUpEscalatedAt" AT TIME ZONE \'UTC\' AS now FROM "Notification" WHERE id=$1',[oldNotice.id])).rows[0].now;assert.ok(+absoluteFallback>=+beforeFallback-2&&+absoluteFallback<=+afterFallback+2);assert.equal(+failedAt,+oldJob.updatedAt);
  const allMigratedNotices=(await db.query('SELECT * FROM "Notification" ORDER BY id')).rows;
  assert.equal(allMigratedNotices.length,allOldNotices.length);
  for(let i=0;i<allOldNotices.length;i++){const {followUpDeadlineAt,legacyFollowUpEscalatedAt,...unchanged}=allMigratedNotices[i];assert.deepEqual(unchanged,allOldNotices[i]);assert.equal(followUpDeadlineAt,null);assert.equal(legacyFollowUpEscalatedAt===null,allOldNotices[i].resolvedAt!==null);}
  assert.deepEqual((await db.query('SELECT * FROM "Appointment"')).rows,before.map(row=>({...row,version:1})));
  assert.deepEqual((await db.query('SELECT * FROM "Calendar"')).rows,slots);assert.equal((await db.query('SELECT phone FROM "User"')).rows[0].phone,null);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM "ContactAttempt"')).rows[0].count,0);
  console.log('PASS: follow-up migration preserves existing contents, leaves phones null and contact history empty; leaves legacy deadlines unknown and records a separate immediate migration fallback');

 }finally{await db.query('ROLLBACK');await db.query('SET search_path TO public');await db.query('DROP SCHEMA IF EXISTS rescheduling_migration_test CASCADE');await db.end()}
})().catch(e=>{console.error(e);process.exitCode=1});
