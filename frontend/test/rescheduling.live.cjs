// Run with the disposable stack; never against the configured application database.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { chromium } = require(process.env.MEDISLOT_PLAYWRIGHT || 'playwright');
const api = 'http://localhost:4450', ui = 'http://localhost:3350';
const url = new URL(process.env.DATABASE_URL || '');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/medislot_frontend_reschedule_test');
(async () => {
 const db = new Client({connectionString:url.href}); await db.connect();
 const browser = await chromium.launch({headless:true});
 try {
  const hash = await bcrypt.hash('PreviewTest123!', 4);
  async function user(role, name, specialization=null) {
   return (await db.query('INSERT INTO "User" (name,email,password,role,specialization,"updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *', [name,name+'@example.test',hash,role,specialization])).rows[0];
  }
  const rec = await user('RECEPTIONIST','Reception'), admin = await user('ADMIN','Admin'), manager = await user('MANAGER','Manager');
  const doc = await user('DOCTOR','Original','CARDIOLOGY'), other = await user('DOCTOR','Alternative','CARDIOLOGY'), mismatch = await user('DOCTOR','Different','NEUROLOGY');
  const nullDoc = await user('DOCTOR','Missing');
  async function period(doctor) {
   return (await db.query('INSERT INTO "SchedulePeriod" ("doctorId","startDate","endDate","workingWeekdays","dailyStartTime","dailyEndTime","slotDurationMinutes","excludedDates","removedSlotIds","publishedById") VALUES ($1,\'2030-01-01\',\'2030-12-31\',ARRAY[1,2,3,4,5,6,7],\'00:00\',\'23:59\',30,ARRAY[]::text[],ARRAY[]::integer[],$2) RETURNING id',[doctor.id,admin.id])).rows[0].id;
  }
  const periods = new Map(); for (const d of [doc,other,mismatch,nullDoc]) periods.set(d.id,await period(d));
  async function slot(doctor, date, time, duration=30, flags={}) {
   const start = new Date(date+'T'+time+':00Z'), end = new Date(+start+duration*60000);
   return (await db.query('INSERT INTO "Calendar" ("doctorId","startTime","endTime","isBooked","isBlocked","schedulePeriodId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *',[doctor.id,start.toISOString(),end.toISOString(),!!flags.booked,!!flags.blocked,flags.manual?null:periods.get(doctor.id)])).rows[0];
  }
  async function appointment(patient, doctor, slot) {
   return (await db.query('INSERT INTO "Appointment" ("patientId","doctorId","calendarId",reason,"updatedAt") VALUES ($1,$2,$3,\'Preserved visit reason\',NOW()) RETURNING *',[patient.id,doctor.id,slot.id])).rows[0];
  }
  let day = 6;
  const fixtures = [];
  for (const role of ['PATIENT','RECEPTIONIST']) for (const scenario of ['success','same-doctor','recovery','stale','taken','cutoff','empty','close']) {
   const patient = await user('PATIENT',role.toLowerCase()+scenario), date='2030-01-'+String(++day).padStart(2,'0');
   const doctor = scenario==='empty'?nullDoc:doc;
   const original = await slot(doctor,date,'10:00',30,{booked:true});
   const app = await appointment(patient,doctor,original);
   const target = scenario==='empty'?null:await slot(other,date,'11:00');
   const alt = scenario==='empty'?null:await slot(doc,date,'12:00');
   const replacement = scenario==='same-doctor'?alt:target;
   if(scenario==='recovery') {
    await db.query(`UPDATE "Calendar" SET "startTime"='2000-01-01 10:00',"endTime"='2000-01-01 10:30',"isBlocked"=true WHERE id=$1`,[original.id]);
    await db.query(`UPDATE "Appointment" SET status='NEEDS_RESCHEDULING' WHERE id=$1`,[app.id]);
   }
   const invalid=[];
   if(scenario==='success') {
    invalid.push(await slot(doc,date,'13:00',30,{blocked:true}), await slot(doc,date,'14:00',30,{booked:true}),await slot(doc,date,'15:00',60),await slot(doc,date,'16:00',30,{manual:true}),await slot(mismatch,date,'17:00'));
    const conflict = await slot(mismatch,date,'18:15',45,{booked:true}); await appointment(patient,mismatch,conflict);
    invalid.push(await slot(doc,date,'18:00'));
    await slot(doc,date,'19:00'); // Back-to-back with the conflicting appointment is allowed.
   }
   fixtures.push({role,scenario,patient,date,original,app,target,alt,replacement,invalid});
  }
  async function login(context, name) {
   const page=await context.newPage();page.setDefaultTimeout(20000);
   await page.goto(ui+'/login');await page.getByLabel('Email',{exact:true}).fill(name+'@example.test');await page.getByLabel('Password',{exact:true}).fill('PreviewTest123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(url=>url.pathname!=='/login');
   return page;
  }
  const loginResponse=await fetch(api+'/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:rec.email,password:'PreviewTest123!'})});
  const recToken=(await loginResponse.json()).accessToken;
  for(const f of fixtures) {
   const context=await browser.newContext({timezoneId:'America/New_York'});const page=await login(context,f.role==='PATIENT'?f.patient.name:rec.name);
   const token=await page.evaluate(()=>JSON.parse(localStorage.getItem('medislot.auth')).token);
   const options=await context.request.get(api+`/appointments/${f.app.id}/reschedule-options`,{headers:{Authorization:'Bearer '+token}});assert.equal(options.status(),200);const opts=await options.json();
   assert.equal(opts.appointment.version,1);assert.equal(opts.appointment.rescheduleCount,0);
   for(const bad of f.invalid) assert.equal(opts.data.some(s=>s.id===bad.id),false);
   if(f.scenario==='success') { assert.ok(opts.data.find(s=>Date.parse(s.startTime)===Date.parse(f.date+'T19:00:00Z')));assert.equal(opts.data[0].doctorId,doc.id); }
   if(f.scenario==='empty') assert.equal(opts.data.length,0);
   // A patient cannot browse another patient's appointment; staff roles other than reception cannot browse.
   if(f.role==='PATIENT') {
    const denied=await context.request.get(api+`/appointments/${fixtures.find(x=>x.patient.id!==f.patient.id).app.id}/reschedule-options`,{headers:{Authorization:'Bearer '+token}});assert.equal(denied.status(),403);
   }
   await page.goto(ui+'/appointments');
   const row=page.locator('tbody tr').filter({has:page.getByRole('cell',{name:String(f.app.id),exact:true})});
   await row.getByRole('button',{name:'Reschedule',exact:true}).click();
   const flow=page.getByRole('region',{name:'Reschedule appointment',exact:true});
   const select=flow.getByRole('combobox',{name:'Replacement slot',exact:true});
   await flow.getByLabel('Replacement date (clinic)',{exact:true}).fill(f.date);
   await assert.doesNotReject(async()=>{await flow.getByText(/Appointment times are shown in the clinic/).waitFor()});
   if(f.scenario==='empty') {await flow.getByText(/No suitable slots/).waitFor();await flow.getByRole('button',{name:'Close rescheduling'}).click();}
   else {
    if(f.scenario==='taken') await flow.getByRole('combobox',{name:'Replacement doctor',exact:true}).selectOption(String(other.id));
    await select.selectOption(String(f.replacement.id));
    assert.match(await select.locator('option:checked').textContent(),new RegExp(f.date+(f.scenario==='same-doctor'?' 13:00':' 12:00'))); // Winter: Warsaw UTC+1, device NY.
    await flow.getByRole('button',{name:'Review replacement'}).click();
    const confirmation=flow.getByRole('region',{name:'Rescheduling confirmation'});
    await confirmation.getByText(/From: Original/).waitFor();await confirmation.getByText(f.scenario==='same-doctor'?/To: Original/:/To: Alternative/).waitFor();
    await confirmation.getByText(/Appointment times are shown in the clinic/).waitFor();
    assert.equal((await db.query('SELECT "isBooked" FROM "Calendar" WHERE id=$1',[f.replacement.id])).rows[0].isBooked,false,'Selection must not reserve a slot');
    if(f.role==='PATIENT'&&f.scenario==='success') await flow.screenshot({path:'/tmp/medislot-reschedule-confirmation.png'});
    if(f.scenario==='close') {await flow.getByRole('button',{name:'Close rescheduling'}).click();}
    else {
     if(f.scenario==='stale') {
      const edit=await context.request.put(api+`/appointments/${f.app.id}`,{headers:{Authorization:'Bearer '+recToken},data:{status:'CONFIRMED',reason:'Updated visit reason'}});assert.equal(edit.status(),200);
     }
     if(f.scenario==='taken') {
      const competitor=await user('PATIENT',f.role.toLowerCase()+'competitor');
      const booked=await context.request.post(api+'/appointments',{headers:{Authorization:'Bearer '+recToken},data:{patientId:competitor.id,doctorId:other.id,calendarId:f.target.id,reason:'Competitor booking'}});assert.equal(booked.status(),201);
     }
     if(f.scenario==='cutoff') await db.query('UPDATE "Calendar" SET "startTime"=NOW()+INTERVAL \'1 hour\',"endTime"=NOW()+INTERVAL \'90 minutes\' WHERE id=$1',[f.original.id]);
     // A receptionist can still move within 24h; use a past start for its cutoff case.
     if(f.scenario==='cutoff'&&f.role==='RECEPTIONIST') await db.query('UPDATE "Calendar" SET "startTime"=NOW()-INTERVAL \'1 hour\',"endTime"=NOW()-INTERVAL \'30 minutes\' WHERE id=$1',[f.original.id]);
     let sent=0;page.on('request',r=>{if(r.url()===api+`/appointments/${f.app.id}/reschedule`&&r.method()==='POST')sent++});
     let release, reached;const gate=new Promise(r=>release=r), entered=new Promise(r=>reached=r);
     await page.route(api+`/appointments/${f.app.id}/reschedule`,async route=>{reached();await gate;await route.continue()},{times:1});
     const response=page.waitForResponse(r=>r.url()===api+`/appointments/${f.app.id}/reschedule`&&r.request().method()==='POST');
     await confirmation.getByRole('button',{name:'Confirm reschedule',exact:true}).click();await entered;
     assert.equal(await confirmation.getByRole('button',{name:'Rescheduling…'}).isDisabled(),true);
     assert.equal(await flow.getByRole('button',{name:'Close rescheduling'}).isDisabled(),true);
     await confirmation.getByRole('button').evaluate(el=>{el.click();el.click()});
     release(); const result=await response;assert.equal(sent,1);
     assert.equal(result.status(),['success','same-doctor','recovery'].includes(f.scenario)?200:409);
     assert.deepEqual(result.request().postDataJSON(),{currentCalendarId:f.original.id,newCalendarId:f.replacement.id,expectedVersion:1});
     if(result.status()===409) {
      assert.equal((await db.query('SELECT "calendarId" FROM "Appointment" WHERE id=$1',[f.app.id])).rows[0].calendarId,f.original.id);
      assert.equal(+(await db.query('SELECT COUNT(*) FROM "AppointmentRescheduleHistory" WHERE "appointmentId"=$1',[f.app.id])).rows[0].count,0);
     }
     if(['success','same-doctor','recovery'].includes(f.scenario)) {
      const moved=await result.json();assert.equal(moved.id,f.app.id);assert.equal(moved.version,2);assert.equal(moved.rescheduleCount,1);assert.equal(moved.reason,'Preserved visit reason');
      await page.getByText(`Appointment #${f.app.id} rescheduled. Version 2; moves: 1.`,{exact:true}).waitFor();
      await row.getByText('Moves: 1',{exact:false}).waitFor();
     } else if(f.scenario==='taken') {
      await flow.getByText(/That replacement is no longer available/).waitFor();
      assert.equal(await flow.getByRole('combobox',{name:'Replacement doctor',exact:true}).inputValue(),String(other.id));
      await flow.getByRole('combobox',{name:'Replacement doctor',exact:true}).selectOption('');
      await select.locator(`option[value="${f.alt.id}"]`).waitFor({state:'attached'});
      assert.equal(await flow.getByLabel('Replacement date (clinic)',{exact:true}).inputValue(),f.date);
      assert.equal(await select.inputValue(),'');assert.equal(await select.locator(`option[value="${f.target.id}"]`).count(),0);
      assert.equal(await flow.getByRole('button',{name:'Reload appointment'}).count(),0);
     } else {
      await flow.getByRole('button',{name:'Reload appointment'}).waitFor();assert.equal(await select.isDisabled(),true);
      if(f.scenario==='cutoff') await flow.getByText(f.role==='PATIENT'?/Please contact reception/:/already started and cannot be moved/).waitFor();
      if(f.scenario==='stale') {
       assert.equal(await flow.getByRole('region',{name:'Rescheduling confirmation'}).count(),0);
       await flow.getByRole('button',{name:'Reload appointment'}).click();await select.locator(`option[value="${f.target.id}"]`).waitFor({state:'attached'});
       await select.selectOption(String(f.replacement.id));await flow.getByRole('button',{name:'Review replacement'}).click();
       const retry=page.waitForResponse(r=>r.url()===api+`/appointments/${f.app.id}/reschedule`&&r.request().method()==='POST');
       await flow.getByRole('button',{name:'Confirm reschedule',exact:true}).click();const retried=await retry;assert.equal(retried.status(),200);assert.equal(retried.request().postDataJSON().expectedVersion,2);assert.equal((await retried.json()).version,3);
      }
     }
     console.log(`${f.role} ${f.scenario}: POST ${result.status()}, duplicate confirmation blocked`);
    }
   }
   const stored=(await db.query('SELECT * FROM "Appointment" WHERE id=$1',[f.app.id])).rows[0];
   const history=+(await db.query('SELECT COUNT(*) FROM "AppointmentRescheduleHistory" WHERE "appointmentId"=$1',[f.app.id])).rows[0].count;
   const moved=['success','same-doctor','recovery','stale'].includes(f.scenario);
   assert.equal(stored.calendarId,moved?f.replacement.id:f.original.id);assert.equal(history,moved?1:0);
   if(!moved) assert.equal(stored.version,1);
   if(f.scenario==='recovery') {
    const old=(await db.query('SELECT "isBooked","isBlocked" FROM "Calendar" WHERE id=$1',[f.original.id])).rows[0];
    assert.equal(old.isBooked,false);assert.equal(old.isBlocked,true);assert.equal(stored.status,'CONFIRMED');
    assert.equal((await db.query('SELECT reason FROM "AppointmentRescheduleHistory" WHERE "appointmentId"=$1',[f.app.id])).rows[0].reason,'DOCTOR_UNAVAILABLE');
   }
   console.log(`${f.role} ${f.scenario}: DB appointment ${stored.id}, calendar ${stored.calendarId}, version ${stored.version}, history ${history}`);
   await context.close();
  }
  const tzPatient=await user('PATIENT','timezonepatient');
  const tzOriginal=await slot(doc,'2030-07-02','10:00',30,{booked:true});
  const tzApp=await appointment(tzPatient,doc,tzOriginal);
  const midnight=await slot(doc,'2030-06-30','22:00');
  for(const zone of ['Europe/Warsaw','America/New_York']) {
   const context=await browser.newContext({timezoneId:zone});const page=await login(context,tzPatient.name);
   await page.goto(ui+'/appointments');const row=page.locator('tbody tr').filter({has:page.getByRole('cell',{name:String(tzApp.id),exact:true})});
   await row.getByRole('button',{name:'Reschedule',exact:true}).click();const flow=page.getByRole('region',{name:'Reschedule appointment',exact:true});
   await flow.getByLabel('Replacement date (clinic)',{exact:true}).fill('2030-07-01');
   const select=flow.getByRole('combobox',{name:'Replacement slot',exact:true});await select.selectOption(String(midnight.id));
   assert.match(await select.locator('option:checked').textContent(),/2030-07-01 00:00/);
   assert.equal(await flow.getByText(/Appointment times are shown in the clinic/).count(),zone==='Europe/Warsaw'?0:1);
   await flow.getByRole('button',{name:'Review replacement'}).click();
   assert.equal(await flow.getByText(/Appointment times are shown in the clinic/).count(),zone==='Europe/Warsaw'?0:2);
   await flow.getByRole('button',{name:'Close rescheduling'}).click();await context.close();
   console.log(zone+': summer midnight slot uses clinic date/time and correct timezone notices; closing sends no move');
  }
  assert.equal((await db.query('SELECT version FROM "Appointment" WHERE id=$1',[tzApp.id])).rows[0].version,1);
  for(const actor of [admin,doc,manager]) {
   const login=await fetch(api+'/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:actor.email,password:'PreviewTest123!'})});const token=(await login.json()).accessToken;
   const denied=await fetch(api+`/appointments/${fixtures[0].app.id}/reschedule-options`,{headers:{Authorization:'Bearer '+token}});assert.equal(denied.status,403);
  }
  assert.equal((await fetch(api+`/appointments/${fixtures[0].app.id}/reschedule-options`)).status,401);
  console.log('PASS: patient/receptionist live flows; authoritative browsing eligibility/ownership; Warsaw winter display in New York; all persisted moves and failed/closed flows verified in PostgreSQL.');
 } finally {await browser.close();await db.end()}
})().catch(e=>{console.error(e);process.exit(1)});
