// MEDISLOT_LIVE_TEST=frontend/test/patient-booking-workflow.live.cjs bash frontend/test/run-rescheduling-live.sh
const assert=require('node:assert/strict'),{Client}=require('pg'),bcrypt=require('bcrypt');
const {chromium}=require(process.env.MEDISLOT_PLAYWRIGHT||'playwright');
const api='http://localhost:4450',ui='http://localhost:3350',url=new URL(process.env.DATABASE_URL||'');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medislot_frontend_reschedule_test');
(async()=>{const db=new Client({connectionString:url.href});await db.connect();const browser=await chromium.launch({headless:true});try{
 const hash=await bcrypt.hash('PreviewTest123!',4);let seq=0;
 async function user(role){return(await db.query('INSERT INTO "User" (name,email,password,role,specialization,"updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *',['Workflow'+role+(++seq),'workflow'+seq+'@example.test',hash,role,role==='DOCTOR'?'ORTHOPAEDICS':null])).rows[0]}
 async function token(actor){const r=await fetch(api+'/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:actor.email,password:'PreviewTest123!'})});assert.equal(r.status,201);return(await r.json()).accessToken;}
 const admin=await user('ADMIN'),rec=await user('RECEPTIONIST'),doctor=await user('DOCTOR'),other=await user('PATIENT');const adminToken=await token(admin),recToken=await token(rec);
 const period=(await db.query('INSERT INTO "SchedulePeriod" ("doctorId","publishedById","startDate","endDate","workingWeekdays","dailyStartTime","dailyEndTime","slotDurationMinutes","excludedDates","removedSlotIds") VALUES ($1,$2,\'2020-01-01\',\'2035-12-31\',ARRAY[1,2,3,4,5,6,7],\'00:00\',\'23:59\',30,ARRAY[]::text[],ARRAY[]::int[]) RETURNING id',[doctor.id,admin.id])).rows[0].id;
 async function slot(start,end=new Date(Date.parse(start)+1800000).toISOString(),booked=false){return(await db.query('INSERT INTO "Calendar" ("doctorId","startTime","endTime","schedulePeriodId","isBooked","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id',[doctor.id,start,end,period,booked])).rows[0];}
 async function visit(patient,status,start,end){const calendar=await slot(start,end,true);return(await db.query('INSERT INTO "Appointment" ("patientId","doctorId","calendarId",reason,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id,"calendarId"',[patient.id,doctor.id,calendar.id,'Category '+status,status])).rows[0];}
 async function login(page,actor){await page.getByLabel('Email',{exact:true}).fill(actor.email);await page.getByLabel('Password',{exact:true}).fill('PreviewTest123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(u=>u.pathname!='/login');}
 const now=Date.now();
 for(const [index,timezoneId] of ['Europe/Warsaw','America/New_York'].entries()){
  const patient=await user('PATIENT');const patientToken=await token(patient);
  const future=await visit(patient,'CONFIRMED',`2031-01-0${index+1}T09:00:00Z`);
  const ongoing=await visit(patient,'CONFIRMED',new Date(now-900000).toISOString(),new Date(now+900000).toISOString());
  const past=await visit(patient,'CONFIRMED','2020-01-07T09:00:00Z');const completed=await visit(patient,'COMPLETED','2020-01-08T09:00:00Z'),noShow=await visit(patient,'NO_SHOW','2020-01-09T09:00:00Z');
  const cancelled=await visit(patient,'CANCELLED','2032-01-07T09:00:00Z'),cancelledPast=await visit(patient,'CANCELLED','2020-01-10T09:00:00Z');
  const disrupted=await visit(patient,'CONFIRMED',`2020-02-0${index+1}T09:00:00Z`),disruptedFuture=await visit(patient,'NEEDS_RESCHEDULING','2032-02-01T09:00:00Z');
  const originalStart=`2020-02-0${index+1}T09:00:00Z`;assert.equal((await fetch(api+'/calendars/block',{method:'POST',headers:{Authorization:'Bearer '+adminToken,'Content-Type':'application/json'},body:JSON.stringify({doctorId:doctor.id,startTime:originalStart,endTime:new Date(Date.parse(originalStart)+1800000).toISOString()})})).status,201);
  const privateVisit=await visit(other,'CONFIRMED','2033-01-07T09:00:00Z');
  const winter=await slot(`2030-01-0${index+7}T09:00:00Z`),summer=await slot(`2030-07-0${index+1}T22:00:00Z`);
  const context=await browser.newContext({timezoneId}),page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(ui+'/login');await login(page,patient);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Book appointment',exact:true}).click();await page.getByRole('heading',{name:'Book appointment',exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Doctor',exact:true}).selectOption(String(doctor.id));await page.getByLabel('Date (clinic)').fill(`2030-01-0${index+7}`);await page.getByRole('button',{name:'Apply',exact:true}).click();
  const row=id=>page.locator('tbody tr').filter({has:page.getByRole('cell',{name:String(id),exact:true})});
  assert.equal(await page.getByRole('combobox',{name:'Status',exact:true}).count(),0);assert.equal(await page.getByRole('columnheader',{name:'Status',exact:true}).count(),0);assert.equal((await page.getByTestId('applied-filters').innerText()).includes('Available'),false);
  await row(winter.id).getByText(`2030-01-0${index+7} 10:00`,{exact:true}).waitFor();assert.equal(await row(summer.id).count(),0);
  assert.equal(await page.getByText(/Appointment times are shown in the clinic/).count(),index===0?0:1);
  await row(winter.id).getByRole('button',{name:'Select slot',exact:true}).click();const selected=page.getByRole('form',{name:'Selected appointment',exact:true});await selected.getByLabel('Visit reason',{exact:true}).fill('Workflow explicit booking');await selected.getByRole('button',{name:'Review booking',exact:true}).click();
  const review=page.getByRole('region',{name:'Booking confirmation',exact:true});await review.getByText('Doctor: '+doctor.name,{exact:true}).waitFor();assert.equal(await review.getByText(/Appointment times are shown in the clinic/).count(),index===0?0:1);
  assert.equal((await db.query('SELECT "isBooked" FROM "Calendar" WHERE id=$1',[winter.id])).rows[0].isBooked,false);
  let release,entered;const gate=new Promise(r=>release=r),hit=new Promise(r=>entered=r);let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url()===api+'/appointments')posts++;});
  await page.route(api+'/appointments',async route=>{entered();await gate;await route.continue()},{times:1});const result=page.waitForResponse(r=>r.url()===api+'/appointments'&&r.request().method()==='POST');await review.getByRole('button',{name:'Confirm booking',exact:true}).click();await hit;await review.getByRole('button',{name:'Booking…',exact:true}).evaluate(el=>{el.click();el.click()});release();const booked=await result;assert.equal(booked.status(),201);assert.equal(posts,1);const bookedAppointment=await booked.json();
  await page.getByRole('link',{name:'View my appointments',exact:true}).waitFor();await page.getByText('No calendar slots match the filters.',{exact:true}).waitFor();assert.match(await page.getByTestId('applied-filters').innerText(),new RegExp(`2030-01-0${index+7}`));
  // Summer midnight is grouped/filterable by clinic date, independent of the device timezone.
  await page.getByLabel('Date (clinic)').fill(`2030-07-0${index+2}`);await page.getByRole('button',{name:'Apply',exact:true}).click();await row(summer.id).getByText(`2030-07-0${index+2} 00:00`,{exact:true}).waitFor();
  await row(summer.id).getByRole('button',{name:'Select slot',exact:true}).click();await selected.getByLabel('Visit reason',{exact:true}).fill('Obsolete selection reason');await selected.getByRole('button',{name:'Review booking',exact:true}).click();await page.getByLabel('Date (clinic)').fill('2035-01-01');assert.equal(await review.count(),0);assert.equal(await selected.count(),0);
  await page.getByRole('link',{name:'View my appointments',exact:true}).click();await page.getByRole('heading',{name:'My appointments',exact:true}).waitFor();await page.getByRole('cell',{name:/Workflow explicit booking/}).waitFor();assert.equal(await page.getByRole('button',{name:'Review booking',exact:true}).count(),0);assert.equal(await page.locator('form.form-card.compact').count(),0);
  const views=page.getByRole('tablist',{name:'Appointment views',exact:true});async function checkView(name,ids){await views.getByRole('tab',{name,exact:true}).click();assert.equal(await views.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');assert.equal(await views.locator('[aria-selected="true"]').count(),1);assert.deepEqual((await page.locator('tbody tr td:first-child').allTextContents()).map(Number).sort((a,b)=>a-b),ids.sort((a,b)=>a-b));}
  await checkView('Upcoming',[future.id,ongoing.id,bookedAppointment.id]);await row(ongoing.id).getByText(/In progress/).waitFor();
  await checkView('Past',[past.id,completed.id,noShow.id]);await row(past.id).getByText('CONFIRMED',{exact:true}).waitFor();
  await checkView('Cancelled',[cancelled.id,cancelledPast.id]);await checkView('Needs rescheduling',[disrupted.id,disruptedFuture.id]);await row(disrupted.id).getByRole('button',{name:'Reschedule',exact:true}).click();await page.getByRole('region',{name:'Reschedule appointment',exact:true}).waitFor();await page.getByRole('region',{name:'Reschedule appointment',exact:true}).getByRole('button',{name:'Close rescheduling',exact:true}).click();
  await checkView('All',[future.id,ongoing.id,past.id,completed.id,noShow.id,cancelled.id,cancelledPast.id,disrupted.id,disruptedFuture.id,bookedAppointment.id]);assert.equal(await row(privateVisit.id).count(),0);
  const allTab=views.getByRole('tab',{name:'All',exact:true});await allTab.focus();
  for(const [key,name] of [['ArrowRight','Upcoming'],['End','Cancelled'],['Home','All'],['ArrowLeft','Cancelled'],['ArrowRight','All']]) {
   await page.keyboard.press(key);const tab=views.getByRole('tab',{name,exact:true});assert.equal(await tab.getAttribute('aria-selected'),'true');assert.equal(await tab.evaluate(el=>el===document.activeElement),true);
   const expected=name==='Upcoming'?[future.id,ongoing.id,bookedAppointment.id]:name==='Cancelled'?[cancelled.id,cancelledPast.id]:[future.id,ongoing.id,past.id,completed.id,noShow.id,cancelled.id,cancelledPast.id,disrupted.id,disruptedFuture.id,bookedAppointment.id];
   assert.deepEqual((await page.locator('tbody tr td:first-child').allTextContents()).map(Number).sort((a,b)=>a-b),expected.sort((a,b)=>a-b));
  }
  await page.keyboard.press('Tab');assert.equal(await page.getByRole('tabpanel').evaluate(el=>el===document.activeElement),true);
  await page.setViewportSize({width:390,height:844});const bounds=await views.getByRole('tab').evaluateAll(tabs=>tabs.map(tab=>({top:tab.getBoundingClientRect().top,width:tab.getBoundingClientRect().width})));assert.ok(bounds.every(b=>b.top===bounds[0].top&&b.width<350));
  await page.screenshot({path:'/tmp/medislot-compact-appointment-tabs.png',fullPage:true});await page.setViewportSize({width:1280,height:900});
  const forbidden=await context.request.get(api+'/appointments/'+privateVisit.id,{headers:{Authorization:'Bearer '+patientToken}});assert.equal(forbidden.status(),403);
  assert.equal((await db.query('SELECT status FROM "Appointment" WHERE id=$1',[past.id])).rows[0].status,'CONFIRMED');
  await page.goto(ui+'/doctors');await page.locator('tbody tr').filter({has:page.getByRole('cell',{name:doctor.name,exact:true})}).getByRole('link',{name:'Book appointment',exact:true}).click();await page.getByRole('heading',{name:'Book appointment',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Doctor',exact:true}).inputValue(),String(doctor.id));
  await context.close();console.log(timezoneId+': browse/select/review/book (201 once), availability refresh, views/status preservation, expired disruption action, privacy, doctor link and clinic midnight filtering PASS');
 }
 assert.equal((await db.query('SELECT COUNT(*)::int n FROM "EmailJob" WHERE "attemptCount"<>0')).rows[0].n,0);
 console.log('PASS: no email jobs processed; pending synthetic disruption notices preserved.');
}finally{await browser.close();await db.end()}})().catch(e=>{console.error(e);process.exitCode=1});
