const assert=require('node:assert/strict'),{Client}=require('pg'),bcrypt=require('bcrypt');const{chromium}=require(process.env.MEDISLOT_PLAYWRIGHT||'playwright');
const api='http://localhost:4450',ui='http://localhost:3350',url=new URL(process.env.DATABASE_URL||'');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medislot_frontend_reschedule_test');
(async()=>{const db=new Client({connectionString:url.href});await db.connect();const browser=await chromium.launch({headless:true});try{
 const hash=await bcrypt.hash('PreviewTest123!',4);async function user(role,name){return(await db.query('INSERT INTO "User" (name,email,password,role,"updatedAt") VALUES ($1,$2,$3,$4,NOW()) RETURNING *',[name,name+'@example.test',hash,role])).rows[0]}
 const patient=await user('PATIENT','InboxPatient'),other=await user('PATIENT','OtherInboxPatient'),admin=await user('ADMIN','InboxAdmin'),rec=await user('RECEPTIONIST','InboxReception'),doctor=await user('DOCTOR','InboxDoctor');
 async function token(actor){const r=await fetch(api+'/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:actor.email,password:'PreviewTest123!'})});return(await r.json()).accessToken}
 const tokens=new Map;for(const actor of[patient,other,admin,rec,doctor])tokens.set(actor.id,await token(actor));
 async function request(method,path,actor,body){const r=await fetch(api+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.get(actor.id)},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json().catch(()=>null)}}
 const period=(await db.query('INSERT INTO "SchedulePeriod" ("doctorId","startDate","endDate","workingWeekdays","dailyStartTime","dailyEndTime","slotDurationMinutes","excludedDates","removedSlotIds","publishedById") VALUES ($1,\'2030-01-01\',\'2031-12-31\',ARRAY[1,2,3,4,5,6,7],\'00:00\',\'23:59\',30,ARRAY[]::text[],ARRAY[]::integer[],$2) RETURNING id',[doctor.id,admin.id])).rows[0].id;
 async function slot(start){return(await db.query('INSERT INTO "Calendar" ("doctorId","startTime","endTime","schedulePeriodId","updatedAt") VALUES ($1,$2,$3,$4,NOW()) RETURNING id',[doctor.id,start,new Date(Date.parse(start)+1800000).toISOString(),period])).rows[0]}
 const original=await slot('2030-06-30T22:00:00Z'),replacement=await slot('2030-07-02T08:00:00Z'),third=await slot('2030-07-03T08:00:00Z');
 const booked=await request('POST','/appointments',patient,{patientId:patient.id,doctorId:doctor.id,calendarId:original.id,reason:'Private synthetic visit reason'});assert.equal(booked.status,201);const id=booked.body.id;
 async function block(start){assert.equal((await request('POST','/calendars/block',admin,{doctorId:doctor.id,startTime:start,endTime:new Date(Date.parse(start)+1800000).toISOString()})).status,201)}
 await block('2030-06-30T22:00:00Z');const notices=await request('GET','/notifications',patient);const notice=notices.body.data[0];assert.equal(notice.disruptionVersion,2);
 async function credentials(page,actor){await page.getByLabel('Email',{exact:true}).fill(actor.email);await page.getByLabel('Password',{exact:true}).fill('PreviewTest123!');await page.getByRole('button',{name:'Log in',exact:true}).click()}
 for(const timezoneId of['America/New_York','Europe/Warsaw']){
  const context=await browser.newContext({timezoneId}),page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(ui+`/appointments?reschedule=${id}`);await page.waitForURL(u=>u.pathname==='/login');assert.equal(new URL(page.url()).searchParams.get('next'),`/appointments?reschedule=${id}`);
  await credentials(page,patient);await page.waitForURL(ui+`/appointments?reschedule=${id}`);await page.getByRole('region',{name:'Reschedule appointment',exact:true}).waitFor();
  await page.goto(ui+'/notifications');const row=page.getByRole('region',{name:`Notification ${notice.id}`,exact:true});await row.getByText(/InboxDoctor · 2030-07-01 00:00/).waitFor();await row.getByRole('link',{name:'Choose a replacement',exact:true}).waitFor();
  const tabs=page.getByRole('tablist',{name:'Inbox views',exact:true});
  const chooseTab=async name=>{await tabs.getByRole('tab',{name,exact:true}).click();await page.getByRole('status').waitFor({state:'hidden'});assert.equal(await tabs.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');};
  assert.equal(await page.getByRole('navigation',{name:'Inbox pagination',exact:true}).count(),0);
  assert.equal(await page.getByText(/Appointment times are shown in the clinic/).count(),timezoneId==='Europe/Warsaw'?0:1);
  assert.equal(await page.getByText(/Reading a notice does not reschedule/).count(),0);
  if(timezoneId==='America/New_York'){
   const beforeApp=(await db.query('SELECT status,version FROM "Appointment" WHERE id=$1',[id])).rows[0],beforeJob=(await db.query('SELECT status,"attemptCount" FROM "EmailJob" WHERE "notificationId"=$1',[notice.id])).rows[0];
   await chooseTab('Unread');await row.waitFor();await row.getByRole('button',{name:'Mark as read',exact:true}).click();await page.getByRole('heading',{name:'No unread notifications.',exact:true}).waitFor();
   assert.deepEqual((await db.query('SELECT status,version FROM "Appointment" WHERE id=$1',[id])).rows[0],beforeApp);assert.deepEqual((await db.query('SELECT status,"attemptCount" FROM "EmailJob" WHERE "notificationId"=$1',[notice.id])).rows[0],beforeJob);
   assert.equal((await request('GET','/notifications?unread=true',patient)).body.meta.total,0);
   await chooseTab('All');await row.getByRole('heading',{name:'Read · Appointment disruption',exact:true}).waitFor();await chooseTab('Needs action');await row.getByRole('link',{name:'Choose a replacement',exact:true}).waitFor();
   assert.equal((await request('GET','/notifications?needsAction=true',patient)).body.meta.total,1);
   // Leaving and returning does not dismiss an unresolved read notice or its action.
   await page.goto(ui+'/appointments');await page.getByRole('heading',{name:'My appointments',exact:true}).waitFor();await page.goto(ui+'/notifications');await row.getByRole('heading',{name:'Read · Appointment disruption',exact:true}).waitFor();
   await row.getByRole('link',{name:'Choose a replacement',exact:true}).click();await page.getByRole('region',{name:'Reschedule appointment',exact:true}).waitFor();await page.goto(ui+'/notifications');await row.getByRole('link',{name:'Choose a replacement',exact:true}).waitFor();
   // A delayed All result must not restore read rows after switching to Unread.
   await chooseTab('Needs action');let releaseAll,capturedAll;const allGate=new Promise(r=>releaseAll=r),allHit=new Promise(r=>capturedAll=r);
   await page.route(api+'/notifications?*',async route=>{const response=await route.fetch();capturedAll();await allGate;await route.fulfill({response})},{times:1});
   try {await tabs.getByRole('tab',{name:'All',exact:true}).click();await allHit;await chooseTab('Unread');await page.getByRole('heading',{name:'No unread notifications.',exact:true}).waitFor();releaseAll();await page.unrouteAll({behavior:'wait'});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await row.count(),0);assert.equal(await tabs.getByRole('tab',{name:'Unread',exact:true}).getAttribute('aria-selected'),'true');}finally{releaseAll()}
   await chooseTab('Needs action');await row.waitFor();
   await row.screenshot({path:'/tmp/medislot-patient-inbox.png'});
  }
  await chooseTab('All');await tabs.getByRole('tab',{name:'All',exact:true}).focus();
  for(const [key,name] of [['ArrowRight','Needs action'],['End','Unread'],['Home','All'],['ArrowLeft','Unread'],['ArrowRight','All']]) {await page.keyboard.press(key);const tab=tabs.getByRole('tab',{name,exact:true});assert.equal(await tab.getAttribute('aria-selected'),'true');assert.equal(await tab.evaluate(el=>el===document.activeElement),true);await page.getByRole('status').waitFor({state:'hidden'});}
  await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Refresh inbox',exact:true}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.getByRole('tabpanel').evaluate(el=>el===document.activeElement),true);
  await context.close();console.log(timezoneId+': authenticated deep link/login return, original clinic midnight display and inbox passed');
 }
 // A successful move and later disruption must cause old links to load the CURRENT version/calendar.
 assert.equal((await request('POST',`/appointments/${id}/reschedule`,patient,{currentCalendarId:original.id,newCalendarId:replacement.id,expectedVersion:2})).status,200);
 assert.equal((await request('GET','/notifications?needsAction=true',patient)).body.meta.total,0);assert.equal((await request('GET','/notifications',patient)).body.meta.total,1);
 await block('2030-07-02T08:00:00Z');assert.equal((await request('GET','/notifications?needsAction=true',patient)).body.meta.total,1);
 const context=await browser.newContext({timezoneId:'America/New_York'}),page=await context.newPage();page.setDefaultTimeout(20000);await page.goto(ui+'/login?next='+encodeURIComponent(`/appointments?reschedule=${id}`));await credentials(page,patient);await page.waitForURL(ui+`/appointments?reschedule=${id}`);
 const flow=page.getByRole('region',{name:'Reschedule appointment',exact:true});await flow.getByText(/Original: InboxDoctor · 2030-07-02 10:00/).waitFor();
 await flow.getByRole('region',{name:'Keep your doctor',exact:true}).getByRole('button',{name:/^Review /}).click();const done=page.waitForResponse(r=>r.url()===api+`/appointments/${id}/reschedule`&&r.request().method()==='POST');await flow.getByRole('button',{name:'Confirm reschedule',exact:true}).click();const moved=await done;assert.equal(moved.status(),200);assert.deepEqual(moved.request().postDataJSON(),{currentCalendarId:replacement.id,newCalendarId:third.id,expectedVersion:4});
 await page.goto(ui+'/notifications');await page.getByRole('tab',{name:'Needs action',exact:true}).click();await page.getByRole('heading',{name:'No disruptions need action.',exact:true}).waitFor();await page.getByRole('tab',{name:'All',exact:true}).click();await page.getByText('Resolved',{exact:true}).first().waitFor();assert.equal(await page.getByRole('region',{name:/^Notification /}).count(),2);
 await page.goto(ui+`/appointments?reschedule=${id}`);await page.getByText(/This appointment no longer needs recovery. Current status: CONFIRMED/).waitFor();assert.equal(await flow.count(),0);
 assert.equal((await request('PUT',`/appointments/${id}`,rec,{status:'CANCELLED',reason:'Private synthetic visit reason'})).status,200);
 await page.goto(ui+`/appointments?reschedule=${id}`);await page.getByText(/Current status: CANCELLED/).waitFor();assert.equal(await flow.count(),0);
 await page.goto(ui+'/notifications');await page.getByText('Resolved',{exact:true}).first().waitFor();assert.equal(await page.getByRole('link',{name:'Choose a replacement',exact:true}).count(),0);
 // A distinct unresolved disruption resolved by cancellation must also remain as history.
 const cancelSlot=await slot('2030-07-04T08:00:00Z'),cancelBooking=await request('POST','/appointments',patient,{patientId:patient.id,doctorId:doctor.id,calendarId:cancelSlot.id,reason:'Cancellation test visit'});assert.equal(cancelBooking.status,201);await block('2030-07-04T08:00:00Z');
 await page.getByRole('tab',{name:'Needs action',exact:true}).click();await page.getByRole('link',{name:'Choose a replacement',exact:true}).waitFor();assert.equal((await request('PUT',`/appointments/${cancelBooking.body.id}`,rec,{status:'CANCELLED',reason:'Cancellation test visit'})).status,200);
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();await page.getByRole('heading',{name:'No disruptions need action.',exact:true}).waitFor();await page.getByRole('tab',{name:'All',exact:true}).click();await page.getByText('Resolved',{exact:true}).first().waitFor();assert.equal(await page.getByRole('region',{name:/^Notification /}).count(),3);await context.close();
 const otherContext=await browser.newContext(),otherPage=await otherContext.newPage();await otherPage.goto(ui+'/login?next='+encodeURIComponent(`/appointments?reschedule=${id}`));await credentials(otherPage,other);await otherPage.waitForURL(ui+`/appointments?reschedule=${id}`);await otherPage.getByText('This appointment is unavailable or does not belong to your account.',{exact:true}).waitFor();assert.equal(await otherPage.getByRole('region',{name:'Reschedule appointment',exact:true}).count(),0);await otherContext.close();
 for(const destination of['https://evil.example/','//evil.example/','/\\evil.example/','/%2f%2fevil.example','javascript:alert(1)','/login','/appointments?reschedule=oops']){
  const ctx=await browser.newContext(),p=await ctx.newPage();await p.goto(ui+'/login?next='+encodeURIComponent(destination));await credentials(p,patient);await p.waitForURL(ui+'/calendars');assert.equal(new URL(p.url()).origin,ui);await ctx.close();
 }
 const safe=await browser.newContext(),safePage=await safe.newPage();await safePage.goto(ui+'/login?next='+encodeURIComponent('/notifications'));await credentials(safePage,patient);await safePage.waitForURL(ui+'/notifications');await safe.close();
 const denied=await browser.newContext(),deniedPage=await denied.newPage();await deniedPage.goto(ui+'/login?next='+encodeURIComponent('/notifications'));await credentials(deniedPage,doctor);await deniedPage.waitForURL(ui+'/notifications');await deniedPage.getByRole('heading',{name:'Not allowed',exact:true}).waitFor();await denied.close();
 // Real unread pagination: 21 disruptions -> page 2 has one notice.
 const paginationPatient=await user('PATIENT','PaginationPatient');tokens.set(paginationPatient.id,await token(paginationPatient));
 for(let day=1;day<=21;day++){
  const start='2031-02-'+String(day).padStart(2,'0')+'T10:00:00Z',calendar=await slot(start);
  assert.equal((await request('POST','/appointments',paginationPatient,{patientId:paginationPatient.id,doctorId:doctor.id,calendarId:calendar.id,reason:'Synthetic pagination visit'})).status,201);
 }
 assert.equal((await request('POST','/calendars/block',admin,{doctorId:doctor.id,startTime:'2031-02-01T10:00:00Z',endTime:'2031-02-22T10:00:00Z'})).status,201);
 const unreadPage2=await request('GET','/notifications?page=2&pageSize=20&unread=true',paginationPatient);
 assert.equal(unreadPage2.body.meta.total,21);assert.equal(unreadPage2.body.data.length,1);const lastUnread=unreadPage2.body.data[0].id;
 const paginationContext=await browser.newContext({timezoneId:'Europe/Warsaw'}),paginationPage=await paginationContext.newPage();paginationPage.setDefaultTimeout(20000);
 await paginationPage.goto(ui+'/login?next='+encodeURIComponent('/notifications'));await credentials(paginationPage,paginationPatient);await paginationPage.waitForURL(ui+'/notifications');
 const notificationRows=paginationPage.getByRole('region',{name:/^Notification /});
 await notificationRows.first().waitFor();await paginationPage.getByRole('tab',{name:'Unread',exact:true}).click();
 await paginationPage.getByRole('button',{name:'Next',exact:true}).click();await paginationPage.getByText('Page 2 of 2',{exact:true}).waitFor();
 const lastRow=paginationPage.getByRole('region',{name:`Notification ${lastUnread}`,exact:true});await lastRow.waitFor();assert.equal(await notificationRows.count(),1);
 // Hold PATCH before forwarding. Capture an older real page-2 GET response while all 21 are unread.
 let releasePatch,patchEntered,releaseOld,oldCaptured;
 const patchGate=new Promise(r=>releasePatch=r),patchHit=new Promise(r=>patchEntered=r),oldGate=new Promise(r=>releaseOld=r),oldHit=new Promise(r=>oldCaptured=r);
 await paginationPage.route(api+`/notifications/${lastUnread}/read`,async route=>{patchEntered();await patchGate;await route.continue()},{times:1});
 let held=false;
 await paginationPage.route(api+'/notifications?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('page')==='2'&&!held){held=true;const oldResponse=await route.fetch();assert.equal((await oldResponse.json()).meta.total,21);oldCaptured();await oldGate;await route.fulfill({response:oldResponse})}
  else await route.continue();
 });
 try {
  await lastRow.getByRole('button',{name:'Mark as read',exact:true}).click();await patchHit;
  await paginationPage.getByRole('button',{name:'Refresh inbox',exact:true}).click();await oldHit;
  const validPage= paginationPage.waitForResponse(r=>r.url().startsWith(api+'/notifications?')&&new URL(r.url()).searchParams.get('page')==='1'&&new URL(r.url()).searchParams.get('unread')==='true');
  releasePatch();const validResponse=await validPage;assert.equal(validResponse.status(),200);const validBody=await validResponse.json();assert.equal(validBody.data.length,20);assert.equal(validBody.meta.total,20);
  await notificationRows.first().waitFor();
  assert.equal(await notificationRows.count(),20);assert.equal(await paginationPage.getByRole('tab',{name:'Unread',exact:true}).getAttribute('aria-selected'),'true');
  releaseOld();await paginationPage.unrouteAll({behavior:'wait'});await paginationPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await notificationRows.count(),20);assert.equal(await lastRow.count(),0);assert.equal(await paginationPage.getByRole('tab',{name:'Unread',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await paginationPage.getByRole('navigation',{name:'Inbox pagination',exact:true}).count(),0);assert.equal(await paginationPage.getByRole('region',{name:'Empty inbox',exact:true}).count(),0);
  const remaining=(await db.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE "readAt" IS NULL)::int AS unread FROM "Notification" WHERE "recipientId"=$1',[paginationPatient.id])).rows[0];assert.deepEqual(remaining,{total:21,unread:20});
  const jobs=(await db.query('SELECT j.status,j."attemptCount" FROM "EmailJob" j JOIN "Notification" n ON n.id=j."notificationId" WHERE n."recipientId"=$1',[paginationPatient.id])).rows;assert.equal(jobs.length,21);assert.ok(jobs.every(j=>j.status==='PENDING'&&j.attemptCount===0));
  await paginationPage.getByRole('tab',{name:'Needs action',exact:true}).click();await notificationRows.first().waitFor();
  assert.equal((await request('GET','/notifications?needsAction=true',paginationPatient)).body.meta.total,21);
  await paginationPage.getByRole('button',{name:'Next',exact:true}).click();await lastRow.getByRole('heading',{name:'Read · Appointment disruption',exact:true}).waitFor();await lastRow.getByRole('link',{name:'Choose a replacement',exact:true}).waitFor();
  const oldAppointment=(await db.query('SELECT "appointmentId" FROM "Notification" WHERE id=$1',[lastUnread])).rows[0].appointmentId;
  assert.equal((await request('PUT',`/appointments/${oldAppointment}`,rec,{status:'CANCELLED',reason:'Synthetic pagination visit'})).status,200);
  await paginationPage.getByRole('button',{name:'Refresh inbox',exact:true}).click();await notificationRows.first().waitFor();assert.equal(await notificationRows.count(),20);assert.equal(await lastRow.count(),0);assert.equal(await paginationPage.getByRole('navigation',{name:'Inbox pagination',exact:true}).count(),0);
  assert.equal((await request('GET','/notifications?needsAction=true',paginationPatient)).body.meta.total,20);assert.equal((await request('GET','/notifications',paginationPatient)).body.meta.total,21);
  console.log('LIVE pagination: 21 unread -> sole item on page 2 read -> page 1 shows remaining 20, unread filter preserved; delayed old 21-notice/page-2 response ignored; jobs remain pending/unattempted');
 }finally{releasePatch();releaseOld();await paginationPage.unrouteAll({behavior:'wait'});await paginationContext.close()}
 console.log('PASS: read/resolve separation; current-calendar/version deep links after redisruption; resolved/cancelled/wrong-account links; validated safe returns and rejected unsafe redirects; patient-only inbox.');
}finally{await browser.close();await db.end()}})().catch(e=>{console.error(e);process.exit(1)});
