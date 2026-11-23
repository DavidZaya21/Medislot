// Disposable PostgreSQL + real API/browser regression.
// MEDISLOT_LIVE_TEST=frontend/test/calendar-availability.live.cjs bash frontend/test/run-rescheduling-live.sh
// Set MEDISLOT_PLAYWRIGHT to an installed Playwright module path if needed.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.MEDISLOT_PLAYWRIGHT || 'playwright');
const api = 'http://localhost:4450', ui = 'http://localhost:3350';
(async () => {
 const url = new URL(process.env.DATABASE_URL);
 assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/medislot_frontend_reschedule_test');
 const db = new Client({ connectionString: url.href }); await db.connect();
 let browser, dev;
 try {
  const actors = {};
  for (const role of ['ADMIN','MANAGER','RECEPTIONIST','DOCTOR']) {
   actors[role] = (await db.query('INSERT INTO "User" (name,email,password,role,specialization,"updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id,role', [role === 'DOCTOR' ? 'Linn' : role, role+'@example.test','unused',role,role==='DOCTOR'?'ORTHOPAEDICS':null])).rows[0];
  }
  // Match the reported doctor ID and query exactly, without touching normal data.
  await db.query('UPDATE "User" SET id=21 WHERE id=$1', [actors.DOCTOR.id]); actors.DOCTOR.id=21;
  const registration = await fetch(api+'/users', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'New patient',email:'availability@example.test',password:'PreviewTest123!'})});
  assert.equal(registration.status,201);
  const patient=(await db.query('SELECT id,role FROM "User" WHERE email=$1',['availability@example.test'])).rows[0];
  const auth = actor => ({token:jwt.sign({sub:actor.id,role:actor.role},'reschedule-ui-test',{expiresIn:'1h'}),role:actor.role,userId:actor.id});
  async function get(path,actor=patient,base=api) {const r=await fetch(base+path,{headers:actor?{Authorization:'Bearer '+auth(actor).token}:{}});return {status:r.status,body:await r.json()};}
  const period=(await db.query('INSERT INTO "SchedulePeriod" ("doctorId","publishedById","startDate","endDate","workingWeekdays","dailyStartTime","dailyEndTime","slotDurationMinutes","excludedDates","removedSlotIds") VALUES (21,$1,\'2020-01-01\',\'2035-12-31\',ARRAY[1,2,3,4,5,6,7],\'00:00\',\'23:59\',30,ARRAY[]::text[],ARRAY[]::int[]) RETURNING id',[actors.ADMIN.id])).rows[0].id;
  async function slot(start,booked=false,blocked=false,published=true) {return (await db.query('INSERT INTO "Calendar" ("doctorId","startTime","endTime","isBooked","isBlocked","schedulePeriodId","updatedAt") VALUES (21,$1,$2,$3,$4,$5,NOW()) RETURNING id',[start,new Date(Date.parse(start)+1800000).toISOString(),booked,blocked,published?period:null])).rows[0].id;}
  const free=await slot('2030-01-07T09:00:00Z'),summer=await slot('2030-06-30T22:00:00Z');
  const booked=await slot('2028-05-27T16:09:56Z',true),blocked=await slot('2030-01-07T10:00:00Z',false,true),manual=await slot('2030-01-07T11:00:00Z',false,false,false),past=await slot('2020-01-07T10:00:00Z');
  const appointment=(await db.query('INSERT INTO "Appointment" ("patientId","doctorId","calendarId",reason,"updatedAt") VALUES ($1,21,$2,\'Private synthetic reason\',NOW()) RETURNING id',[patient.id,booked])).rows[0].id;
  const snapshot=async()=>JSON.stringify((await db.query(`SELECT (SELECT jsonb_agg(t ORDER BY id) FROM "Calendar" t) calendars,(SELECT jsonb_agg(t ORDER BY id) FROM "Appointment" t) appointments,(SELECT COUNT(*) FROM "Notification") notices,(SELECT COUNT(*) FROM "EmailJob") jobs`)).rows);
  const before=await snapshot();
  async function apiChecks(base) {
   const exact=await get('/calendars?doctorId=21&date=2026-11-24&isBooked=false',patient,base);assert.deepEqual(exact,{status:200,body:{data:[]}});
   for(const query of ['', '?isBooked=true','?isBooked=false','?isBooked=true&isBlocked=false&schedulePeriodId=null&role=ADMIN']) {const r=await get('/calendars'+query,patient,base);assert.equal(r.status,200);assert.deepEqual(r.body.data.map(s=>s.id),[free,summer]);}
   for(const id of [booked,blocked,manual,past]) assert.equal((await get('/calendars/'+id,patient,base)).status,404);
   assert.equal((await get('/calendars/'+free,patient,base)).status,200);
   for(const query of ['doctorId=no','doctorId=0','doctorId=2147483648','doctorId=21&doctorId=22','date=2026-02-30','date=garbage','date=2026-11-24T12:00:00Z','isBooked=no','isBooked=false&isBooked=true']) assert.equal((await get('/calendars?'+query,patient,base)).status,400,query);
   for(const actor of Object.values(actors)) {assert.equal((await get('/calendars',actor,base)).body.data.length,6);assert.deepEqual((await get('/calendars?doctorId=21&isBooked=true',actor,base)).body.data.map(s=>s.id),[booked]);assert.equal((await get('/calendars/'+booked,actor,base)).status,200);}
   assert.equal((await get('/calendars',null,base)).status,401);
   assert.equal((await get('/appointments/'+appointment,patient,base)).status,200);
   for(const [date,id] of [['2030-01-07',free],['2030-07-01',summer]])assert.deepEqual((await get('/calendars?date='+date,patient,base)).body.data.map(s=>s.id),[id]);
   console.log(base+': exact reported query 200 []; patient tampering/ID visibility, malformed queries 400, staff list/detail and own appointment 200, Warsaw winter/summer day boundaries PASS');
  }
  await apiChecks(api);
  // Repeat against the tsx development runtime that originally caused the Prisma error.
  dev=spawn(process.execPath,['--import','tsx','backend/src/main.ts'],{cwd:process.cwd(),env:{...process.env,BACKEND_PORT:'4451',JWT_SECRET:'reschedule-ui-test',TSX_TSCONFIG_PATH:'backend/tsconfig.json'},stdio:'ignore'});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch('http://localhost:4451/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'tsx backend ready');await apiChecks('http://localhost:4451');dev.kill();dev=undefined;
  browser=await chromium.launch({headless:true});
  for(const timezoneId of ['Europe/Warsaw','America/New_York']) {
   const context=await browser.newContext({timezoneId});await context.addInitScript(a=>localStorage.setItem('medislot.auth',JSON.stringify(a)),auth(patient));const page=await context.newPage();page.setDefaultTimeout(15000);
   await page.goto(ui+'/calendars');await page.getByText('2030-01-07 10:00',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),2);assert.equal(await page.getByRole('combobox',{name:'Status',exact:true}).locator('option').count(),0);
   assert.equal(await page.getByText(/Appointment times are shown in the clinic/).count(),timezoneId==='Europe/Warsaw'?0:1);
   await page.getByRole('combobox',{name:'Doctor',exact:true}).selectOption('21');await page.getByLabel('Date (clinic)').fill('2026-11-24');await page.getByText('Filters changed. Apply to update results.',{exact:true}).waitFor();assert.match(await page.getByTestId('applied-filters').innerText(),/All clinic dates/);
   const response=page.waitForResponse(r=>r.url()===api+'/calendars?doctorId=21&date=2026-11-24&isBooked=false');await page.getByRole('button',{name:'Apply',exact:true}).click();assert.equal((await response).status(),200);await page.getByText('No calendar slots match the filters.',{exact:true}).waitFor();assert.match(await page.getByTestId('applied-filters').innerText(),/Linn.*2026-11-24/);
   await page.getByLabel('Date (clinic)').fill('2030-01-07');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText('2030-01-07 10:00',{exact:true}).waitFor();
   // Force a real invalid-query API response after a successful list. Old rows must disappear.
   await page.route(api+'/calendars?*',route=>route.continue({url:api+'/calendars?doctorId=bad'}),{times:1});await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText(/Could not load slots for the applied filters:/).waitFor();assert.equal(await page.locator('tbody tr').count(),0);assert.equal(await page.getByText('No calendar slots match the filters.',{exact:true}).count(),0);
   // Hold an old, real response until a newer filter request has succeeded.
   let release,entered;const gate=new Promise(r=>release=r),hit=new Promise(r=>entered=r);
   await page.route(api+'/calendars?*',async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response})},{times:1});
   try {await page.getByRole('button',{name:'Apply',exact:true}).click();await hit;await page.getByLabel('Date (clinic)').fill('2030-07-01');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText('2030-07-01 00:00',{exact:true}).waitFor();release();await page.unrouteAll({behavior:'wait'});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.getByText('2030-01-07 10:00',{exact:true}).count(),0);assert.match(await page.getByTestId('applied-filters').innerText(),/2030-07-01/);}finally{release()}
   await page.goto(ui+'/appointments');await page.getByRole('heading',{name:'My appointments',exact:true}).waitFor();await page.getByRole('cell',{name:/Private synthetic reason/}).waitFor();
   await context.close();console.log(timezoneId+': own appointment remains in My appointments; live newly registered patient, exact empty filters, applied/draft labels, error clears rows, delayed old response ignored PASS');
  }
  const staff=await browser.newContext();await staff.addInitScript(a=>localStorage.setItem('medislot.auth',JSON.stringify(a)),auth(actors.MANAGER));const p=await staff.newPage();await p.goto(ui+'/calendars');await p.getByText('2028-05-27 18:09',{exact:true}).waitFor();assert.equal(await p.getByRole('combobox',{name:'Status',exact:true}).locator('option').count(),3);await p.getByRole('combobox',{name:'Status',exact:true}).selectOption('true');await p.getByRole('button',{name:'Apply',exact:true}).click();await p.getByText('2028-05-27 18:09',{exact:true}).waitFor();await staff.close();
  assert.equal(await snapshot(),before);assert.equal((await db.query('SELECT COUNT(*)::int n FROM "EmailJob"')).rows[0].n,0);
  console.log('PASS: staff Booked filter remains; all reads/browser activity preserve exact calendar/appointment snapshot; zero notification/email jobs.');
 } finally {if(dev)dev.kill();if(browser)await browser.close();await db.end()}
})().catch(error=>{console.error(error);process.exitCode=1});
