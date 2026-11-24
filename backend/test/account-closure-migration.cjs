const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg');
(async()=>{const url=new URL(process.env.MEDISLOT_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medislot_closure_test');const db=new Client({connectionString:url.href});await db.connect();try{
 await db.query('BEGIN');await db.query('CREATE SCHEMA closure_preservation');await db.query('SET LOCAL search_path TO closure_preservation');
 await db.query(`CREATE TABLE "User" (id int PRIMARY KEY,name text,email text,password text,phone text);INSERT INTO "User" VALUES (1,'Legacy patient','legacy@example.test','old hash','+48500100200');CREATE TABLE "Appointment" (id int,reason text);INSERT INTO "Appointment" VALUES (1,'Retained reason');`);
 const users=(await db.query('SELECT * FROM "User"')).rows,appointments=(await db.query('SELECT * FROM "Appointment"')).rows;
 await db.query(fs.readFileSync('prisma/migrations/20261124000000_patient_account_closure/migration.sql','utf8'));
 assert.deepEqual((await db.query('SELECT * FROM "User"')).rows,users.map(u=>({...u,closedAt:null,authVersion:1,closureRequestId:null})));
 assert.deepEqual((await db.query('SELECT * FROM "Appointment"')).rows,appointments);await db.query('ROLLBACK');console.log('PASS migration preservation: original fields intact, authVersion=1, no fabricated closures');
}finally{await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
