const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {Client}=require('pg');
(async()=>{
 const url=new URL(process.env.MEDISLOT_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medislot_specialization_test');
 const db=new Client({connectionString:url.href});await db.connect();
 const sql=fs.readFileSync(path.resolve(__dirname,'../../prisma/migrations/20261119010000_specialization_enum/migration.sql'),'utf8');
 const values=['GENERAL_PRACTICE','CARDIOLOGY','NEUROLOGY','ORTHOPAEDICS','PEDIATRICS','DERMATOLOGY','OPHTHALMOLOGY','ENT','GYNAECOLOGY','UROLOGY'];
 try{
  for(const invalid of [undefined,'','neuro ','Cardiology','unknown']){
   await db.query('CREATE SCHEMA specialization_migration_test');await db.query('SET search_path TO specialization_migration_test');
   try{
    await db.query(`CREATE TABLE "User" (id SERIAL PRIMARY KEY, role TEXT, specialization TEXT, "updatedAt" TIMESTAMP DEFAULT '2026-01-01');
      CREATE TABLE "Calendar" (id INTEGER PRIMARY KEY,"doctorId" INTEGER REFERENCES "User"(id));
      CREATE TABLE "Appointment" (id INTEGER PRIMARY KEY,"calendarId" INTEGER REFERENCES "Calendar"(id),reason TEXT);`);
    const source=['neuro','orthopaedic ',null,...values];if(invalid!==undefined)source.push(invalid);
    for(const specialization of source)await db.query('INSERT INTO "User" (role,specialization) VALUES ($1,$2)',['DOCTOR',specialization]);
    await db.query('INSERT INTO "User" (role,specialization) VALUES ($1,NULL)',['PATIENT']);
    await db.query(`INSERT INTO "Calendar" VALUES (1,1);INSERT INTO "Appointment" VALUES (1,1,'Keep this reason');`);
    const before=(await db.query('SELECT * FROM "User" ORDER BY id')).rows;
    if(invalid===undefined){
     await db.query(sql);
     const after=(await db.query('SELECT * FROM "User" ORDER BY id')).rows;
     assert.deepEqual(after,before.map(row=>({...row,specialization:row.specialization==='neuro'?'NEUROLOGY':row.specialization==='orthopaedic '?'ORTHOPAEDICS':row.specialization})));
     assert.equal((await db.query('SELECT count(*)::int AS count FROM "Calendar"')).rows[0].count,1);
     assert.deepEqual((await db.query('SELECT * FROM "Appointment"')).rows,[{id:1,calendarId:1,reason:'Keep this reason'}]);
     console.log('PASS: approved mappings, all canonical codes, doctor/non-doctor nulls and existing records/relations preserved');
    }else{
     await assert.rejects(()=>db.query(sql),/Unmapped non-null specialization/);await db.query('ROLLBACK');
     assert.deepEqual((await db.query('SELECT * FROM "User" ORDER BY id')).rows,before);
     assert.equal((await db.query("SELECT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='specialization_migration_test' AND t.typname='Specialization') AS present")).rows[0].present,false);
     console.log('PASS: unmapped '+JSON.stringify(invalid)+' aborts and preserves original text/schema');
    }
   }finally{await db.query('ROLLBACK');await db.query('SET search_path TO public');await db.query('DROP SCHEMA specialization_migration_test CASCADE');}
  }
 }finally{await db.end()}
})().catch(e=>{console.error(e);process.exitCode=1});
