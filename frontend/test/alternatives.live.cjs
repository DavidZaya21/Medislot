// Requires the isolated stack in run-rescheduling-live.sh; no configured database access.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { chromium } = require(process.env.MEDISLOT_PLAYWRIGHT || 'playwright');
const api='http://localhost:4450',ui='http://localhost:3350';
const url=new URL(process.env.DATABASE_URL||'');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medislot_frontend_reschedule_test');
(async()=>{
 const db=new Client({connectionString:url.href});await db.connect();const browser=await chromium.launch({headless:true});
 try {
  const hash=await bcrypt.hash('PreviewTest123!',4);let seq=0;
  async function user(role,specialization=null){const name='Suggestion'+role+(++seq);return(await db.query('INSERT INTO "User" (name,email,password,role,specialization,"updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *',[name,name+'@example.test',hash,role,specialization])).rows[0]}
  const admin=await user('ADMIN'),rec=await user('RECEPTIONIST');
  async function token(user){const r=await fetch(api+'/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:'PreviewTest123!'})});assert.equal(r.status,201);return(await r.json()).accessToken}
  const adminToken=await token(admin),recToken=await token(rec);
  async function post(path,body,auth=recToken){const r=await fetch(api+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)});return{status:r.status,body:await r.json()}}
  const periods=new Map();
  async function doctor(){const d=await user('DOCTOR','ENT');periods.set(d.id,(await db.query('INSERT INTO "SchedulePeriod" ("doctorId","startDate","endDate","workingWeekdays","dailyStartTime","dailyEndTime","slotDurationMinutes","excludedDates","removedSlotIds","publishedById") VALUES ($1,\'1999-01-01\',\'2035-12-31\',ARRAY[1,2,3,4,5,6,7],\'00:00\',\'23:59\',30,ARRAY[]::text[],ARRAY[]::integer[],$2) RETURNING id',[d.id,admin.id])).rows[0].id);return d}
  async function slot(d,start,booked=false){return(await db.query('INSERT INTO "Calendar" ("doctorId","startTime","endTime","isBooked","schedulePeriodId","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id',[d.id,start,new Date(Date.parse(start)+1800000).toISOString(),booked,periods.get(d.id)])).rows[0]}
  const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  async function block(d,start){const result=await post('/calendars/block',{doctorId:d.id,startTime:start,endTime:new Date(Date.parse(start)+1800000).toISOString()},adminToken);assert.equal(result.status,201)}
  async function saved(id){return(await db.query('SELECT "calendarId",version,status,reason FROM "Appointment" WHERE id=$1',[id])).rows[0]}
  async function history(id){return +(await db.query('SELECT COUNT(*) FROM "AppointmentRescheduleHistory" WHERE "appointmentId"=$1',[id])).rows[0].count}
  let caseIndex=0;
  const clinicClock=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Warsaw",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  for(const role of ['PATIENT','RECEPTIONIST'])for(const scenario of ['day','doctor','taken','stale','empty','manual','close']){
   const patient=await user('PATIENT'),a=await doctor(),b=await doctor();
   const date=addDays('2030-01-07',caseIndex++*40);const anchor=scenario==='empty'?'2000-01-01T10:00:00Z':date+'T10:00:00Z';
   const old=await slot(a,anchor,true);
   const appointment=(await db.query('INSERT INTO "Appointment" ("patientId","doctorId","calendarId",reason,"updatedAt") VALUES ($1,$2,$3,\'Preserved suggestion visit reason\',NOW()) RETURNING id',[patient.id,a.id,old.id])).rows[0];
   await block(a,anchor);
   const sameDay=scenario==='empty'?null:await slot(b,date+'T10:15:00Z');
   const later=scenario==='empty'?null:await slot(a,addDays(date,1)+'T09:00:00Z');
   const beyond=await slot(a,addDays(date,20)+'T09:00:00Z');
   const context=await browser.newContext({timezoneId:role==='PATIENT'?'America/New_York':'Europe/Warsaw'}),page=await context.newPage();page.setDefaultTimeout(20000);
   await page.goto(ui+'/login');await page.getByLabel('Email',{exact:true}).fill((role==='PATIENT'?patient:rec).email);await page.getByLabel('Password',{exact:true}).fill('PreviewTest123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(u=>u.pathname!='/login');await page.goto(ui+'/appointments');
   const row=page.locator('tbody tr').filter({has:page.getByRole('cell',{name:String(appointment.id),exact:true})});
   let reads=0,posts=0;page.on('request',r=>{if(r.url()===api+`/appointments/${appointment.id}/alternatives`)reads++;if(r.method()==='POST'&&r.url()===api+`/appointments/${appointment.id}/reschedule`)posts++});
   const loaded=page.waitForResponse(r=>r.url()===api+`/appointments/${appointment.id}/alternatives`);
   await row.getByRole('button',{name:'Reschedule',exact:true}).click();const response=await loaded;assert.equal(response.status(),200);const recommendations=await response.json();
   assert.equal(recommendations.appointment.calendarId,old.id);assert.equal(recommendations.appointment.version,2);
   const flow=page.getByRole('region',{name:'Reschedule appointment',exact:true});
   const keepDay=flow.getByRole('region',{name:'Keep your day',exact:true}),keepDoctor=flow.getByRole('region',{name:'Keep your doctor',exact:true});
   if(scenario==='empty') {assert.deepEqual(recommendations.keepYourDay,[]);assert.deepEqual(recommendations.keepYourDoctor,[]);await keepDay.getByText('No suitable suggestions.',{exact:true}).waitFor();await keepDoctor.getByText('No suitable suggestions.',{exact:true}).waitFor();}
   else {assert.deepEqual(recommendations.keepYourDay.map(s=>s.id),[sameDay.id]);assert.deepEqual(recommendations.keepYourDoctor.map(s=>s.id),[later.id]);await keepDay.getByText(new RegExp(b.name)).waitFor();await keepDay.getByText(new RegExp(clinicClock.format(new Date(date+'T10:15:00Z')))).waitFor();await keepDoctor.getByText(new RegExp(a.name)).waitFor();}
   // Recommendations never reserve; manual refresh does not replace the frozen version.
   const beforeRefresh=reads;
   const refreshed=page.waitForResponse(r=>r.url()===api+`/appointments/${appointment.id}/alternatives`);
   await flow.getByRole('button',{name:'Refresh availability',exact:true}).click();assert.equal((await refreshed).status(),200);assert.equal(reads,beforeRefresh+1);
   assert.equal((await saved(appointment.id)).version,2);assert.equal(await history(appointment.id),0);
   const target=(scenario==='manual'||scenario==='empty')?beyond:(scenario==='doctor'?later:sameDay);
   if(scenario==='manual'||scenario==='empty') {
    await flow.getByRole('button',{name:'Browse other available slots',exact:true}).click();
    await flow.getByLabel('Replacement date (clinic)',{exact:true}).fill(addDays(date,20));
    await flow.getByRole('combobox',{name:'Replacement slot',exact:true}).selectOption(String(target.id));
    await flow.getByRole('button',{name:'Review replacement',exact:true}).click();
   }else await (scenario==='doctor'?keepDoctor:keepDay).getByRole('button',{name:/^Review /}).click();
   const confirmation=flow.getByRole('region',{name:'Rescheduling confirmation',exact:true});await confirmation.getByText(/From:/).waitFor();await confirmation.getByText(/To:/).waitFor();
   assert.equal(await confirmation.getByText(/Appointment times are shown in the clinic/).count(),role==='PATIENT'?1:0);
   assert.equal((await db.query('SELECT "isBooked" FROM "Calendar" WHERE id=$1',[target.id])).rows[0].isBooked,false);assert.equal(posts,0);
   if(scenario==='close'){await flow.getByRole('button',{name:'Close rescheduling',exact:true}).click();assert.equal((await saved(appointment.id)).calendarId,old.id);assert.equal(await history(appointment.id),0);}
   else{
    if(scenario==='taken') {const competitor=await user('PATIENT');assert.equal((await post('/appointments',{patientId:competitor.id,doctorId:b.id,calendarId:target.id,reason:'Competing synthetic booking'})).status,201);}
    if(scenario==='stale') {
     const moved=await post(`/appointments/${appointment.id}/reschedule`,{currentCalendarId:old.id,newCalendarId:later.id,expectedVersion:2});assert.equal(moved.status,200);
     await block(a,addDays(date,1)+'T09:00:00Z');
     await slot(b,addDays(date,1)+'T09:15:00Z');await slot(a,addDays(date,2)+'T09:00:00Z');
    }
    const before=await saved(appointment.id),beforeHistory=await history(appointment.id);
    let release,reached;const gate=new Promise(r=>release=r),entered=new Promise(r=>reached=r);
    await page.route(api+`/appointments/${appointment.id}/reschedule`,async route=>{reached();await gate;await route.continue()},{times:1});
    const resultPromise=page.waitForResponse(r=>r.url()===api+`/appointments/${appointment.id}/reschedule`&&r.request().method()==='POST');
    await confirmation.getByRole('button',{name:'Confirm reschedule',exact:true}).click();await entered;
    assert.equal(await confirmation.getByRole('button',{name:'Rescheduling…',exact:true}).isDisabled(),true);
    await confirmation.getByRole('button').evaluate(el=>{el.click();el.click()});release();const result=await resultPromise;
    assert.equal(posts,1);assert.deepEqual(result.request().postDataJSON(),{currentCalendarId:old.id,newCalendarId:target.id,expectedVersion:2});
    const expected=['taken','stale'].includes(scenario)?409:200;assert.equal(result.status(),expected);
    if(scenario==='taken') {
     await flow.getByText(/That replacement is no longer available/).waitFor();
     await keepDoctor.getByRole('button',{name:/^Review /}).waitFor();assert.equal(await keepDay.getByRole('button').count(),0);
     assert.deepEqual(await saved(appointment.id),before);assert.equal(await history(appointment.id),beforeHistory);
     assert.equal(await flow.getByRole('button',{name:'Reload appointment',exact:true}).count(),0);
     assert.equal(await flow.getByRole('region',{name:'Rescheduling confirmation',exact:true}).count(),0);
    } else if(scenario==='stale') {
     await flow.getByRole('button',{name:'Reload appointment',exact:true}).waitFor();
     assert.deepEqual(await saved(appointment.id),before);assert.equal(await history(appointment.id),beforeHistory);
     assert.equal(await flow.getByRole('button',{name:'Browse other available slots',exact:true}).isDisabled(),true);
     const reloaded=page.waitForResponse(r=>r.url()===api+`/appointments/${appointment.id}/alternatives`);
     await flow.getByRole('button',{name:'Reload appointment',exact:true}).click();const newRecommendations=await(await reloaded).json();
     assert.equal(newRecommendations.appointment.version,4);assert.equal(newRecommendations.appointment.calendarId,later.id);
     assert.equal(newRecommendations.window.startDate,addDays(date,1));
     await keepDay.getByRole('button',{name:/^Review /}).click();
     const retryPromise=page.waitForResponse(r=>r.url()===api+`/appointments/${appointment.id}/reschedule`&&r.request().method()==='POST');
     await flow.getByRole('button',{name:'Confirm reschedule',exact:true}).click();const retry=await retryPromise;assert.equal(retry.status(),200);
     assert.equal(retry.request().postDataJSON().expectedVersion,4);assert.equal(retry.request().postDataJSON().currentCalendarId,later.id);
     assert.equal((await saved(appointment.id)).version,5);assert.equal(await history(appointment.id),2);
    } else {
     await page.getByText(new RegExp(`Appointment #${appointment.id} rescheduled`)).waitFor();
     const moved=await saved(appointment.id);assert.equal(moved.version,3);assert.equal(moved.calendarId,target.id);assert.equal(moved.status,'CONFIRMED');assert.equal(moved.reason,'Preserved suggestion visit reason');assert.equal(await history(appointment.id),1);
    }
    console.log(`${role} ${scenario}: HTTP ${expected}, preserved snapshot and duplicate-submit guard; PostgreSQL state/history verified`);
   }
   console.log(`${role} ${scenario}: selection reserved nothing; manual refresh verified`);
   await context.close();
  }
  console.log('PASS: both roles, both recommendation groups, manual beyond-window/expired-window recovery, refresh, close, taken-slot refresh and explicit stale reload with a new disrupted anchor.');
 }finally{await browser.close();await db.end()}
})().catch(e=>{console.error(e);process.exit(1)});
