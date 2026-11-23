// Run using the isolated disposable run-rescheduling-live.sh stack.
const assert=require('node:assert/strict'),{Client}=require('pg'),bcrypt=require('bcrypt');
const {chromium}=require(process.env.MEDISLOT_PLAYWRIGHT||'playwright');
const api='http://localhost:4450',ui='http://localhost:3350',url=new URL(process.env.DATABASE_URL||'');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medislot_frontend_reschedule_test');
(async()=>{const db=new Client({connectionString:url.href});await db.connect();const browser=await chromium.launch({headless:true});try{
 const hash=await bcrypt.hash('PreviewTest123!',4);let seq=0;
 async function user(role){const name='Initial'+role+(++seq);return(await db.query('INSERT INTO "User" (name,email,password,role,"updatedAt") VALUES ($1,$2,$3,$4,NOW()) RETURNING *',[name,name+'@example.test',hash,role])).rows[0]}
 const admin=await user('ADMIN'),rec=await user('RECEPTIONIST');
 async function token(user){const r=await fetch(api+'/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:'PreviewTest123!'})});assert.equal(r.status,201);return(await r.json()).accessToken}
 const recToken=await token(rec);const periods=new Map();
 async function doctor(){const d=await user('DOCTOR');periods.set(d.id,(await db.query('INSERT INTO "SchedulePeriod" ("doctorId","startDate","endDate","workingWeekdays","dailyStartTime","dailyEndTime","slotDurationMinutes","excludedDates","removedSlotIds","publishedById") VALUES ($1,\'2029-01-01\',\'2035-12-31\',ARRAY[1,2,3,4,5,6,7],\'00:00\',\'23:59\',30,ARRAY[]::text[],ARRAY[]::integer[],$2) RETURNING id',[d.id,admin.id])).rows[0].id);return d}
 async function slot(d,start){return(await db.query('INSERT INTO "Calendar" ("doctorId","startTime","endTime","schedulePeriodId","updatedAt") VALUES ($1,$2,$3,$4,NOW()) RETURNING id',[d.id,start,new Date(Date.parse(start)+1800000).toISOString(),periods.get(d.id)])).rows[0]}
 const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 async function book(patient,d,calendarId,reason='Synthetic competing visit'){const r=await fetch(api+'/appointments',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+recToken},body:JSON.stringify({patientId:patient.id,doctorId:d.id,calendarId,reason})});return{status:r.status,body:await r.json()}}
 const count=async(id)=>+(await db.query('SELECT COUNT(*) FROM "Appointment" WHERE "patientId"=$1',[id])).rows[0].count;
 let scenarioIndex=0;
 for(const role of ['PATIENT','RECEPTIONIST'])for(const scenario of ['success','taken-again','close','empty','reason-change','doctor-change','late-close','late-context','overlap','network',...(role==='RECEPTIONIST'?['patient-change']:[])]){
  const patient=await user('PATIENT'),competitor=await user('PATIENT'),d=await doctor(),otherDoctor=await doctor(),date=addDays('2030-01-07',scenarioIndex++*30);
  const original=await slot(d,date+'T10:00:00Z'),first=scenario==='empty'?null:await slot(d,date+'T10:30:00Z'),second=scenario==='empty'?null:await slot(d,date+'T11:30:00Z');
  if(scenario!=='empty')await slot(d,addDays(date,1)+'T09:00:00Z');const beyond=await slot(d,addDays(date,20)+'T09:00:00Z');
  const context=await browser.newContext({timezoneId:role==='PATIENT'?'America/New_York':'Europe/Warsaw'}),page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(ui+'/login');await page.getByLabel('Email',{exact:true}).fill((role==='PATIENT'?patient:rec).email);await page.getByLabel('Password',{exact:true}).fill('PreviewTest123!');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL(u=>u.pathname!='/login');await page.goto(ui+(role==='PATIENT'?'/calendars?doctorId='+d.id:'/appointments'));
  const form=role==='PATIENT'?page.getByRole('form',{name:'Selected appointment',exact:true}):page.locator('form.form-card.compact'),reason='Preserved intended visit reason';
  if(role==='RECEPTIONIST'){
   await form.getByLabel('Patient search',{exact:true}).fill(patient.email);await form.getByRole('combobox',{name:'Patient',exact:true}).selectOption(String(patient.id));
  }
  const reasonLabel=role==='PATIENT'?'Visit reason':'Reason';
  const selectPatientSlot=async id=>page.locator('tbody tr').filter({has:page.getByRole('cell',{name:String(id),exact:true})}).getByRole('button',{name:'Select slot',exact:true}).click();
  if(role==='PATIENT')await selectPatientSlot(original.id);
  else {await form.getByRole('combobox',{name:'Doctor',exact:true}).selectOption(String(d.id));await form.getByRole('combobox',{name:'Slot',exact:true}).selectOption(String(original.id));}
  await form.getByLabel(reasonLabel,{exact:true}).fill(reason);
  let posts=0,reads=0;page.on('request',r=>{if(r.method()==='POST'&&r.url()===api+'/appointments')posts++;if(r.url().includes('/calendars/')&&r.url().includes('/alternatives'))reads++});
  if(scenario==='overlap'){
   const conflict=await slot(otherDoctor,date+'T10:00:00Z');assert.equal((await book(patient,otherDoctor,conflict.id)).status,201);
  }else if(scenario!=='network')assert.equal((await book(competitor,d,original.id)).status,201);
  let release,entered;const gate=new Promise(r=>release=r),reached=new Promise(r=>entered=r),routeTasks=[];
  const late=scenario.startsWith('late-');
  if(late)await page.route(api+`/calendars/${original.id}/alternatives*`,route=>{
   const task=(async()=>{const response=await route.fetch();entered();await gate;await route.fulfill({response})})();routeTasks.push(task);return task;
  });
  let releaseInitial,initialEntered;
  const initialGate=new Promise(r=>releaseInitial=r),initialReached=new Promise(r=>initialEntered=r);
  if(scenario==='success')await page.route(api+'/appointments',async route=>{initialEntered();await initialGate;await route.continue()},{times:1});
  if(scenario==='network')await page.route(api+'/appointments',route=>route.abort('failed'),{times:1});
  if(role==='PATIENT')await form.getByRole('button',{name:'Review booking',exact:true}).click();
  const initialResponse=scenario==='network'?null:page.waitForResponse(r=>r.url()===api+'/appointments'&&r.request().method()==='POST');
  if(role==='PATIENT')await page.getByRole('region',{name:'Booking confirmation',exact:true}).getByRole('button',{name:'Confirm booking',exact:true}).click();
  else await form.getByRole('button',{name:'Create appointment',exact:true}).click();
  if(scenario==='success') {
   await initialReached;
   await form.evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   releaseInitial();
  }
  if(scenario==='network'){
   await page.getByText(/Failed to fetch|fetch failed|Could not create appointment/).waitFor();assert.equal(reads,0);assert.equal(await page.getByRole('region',{name:'Booking alternatives',exact:true}).count(),0);assert.equal(await count(patient.id),0);await context.close();console.log(role+' network: no suggestions for ambiguous network failure');continue;
  }
  const failed=await initialResponse;assert.equal(failed.status(),409);
  if(scenario==='overlap'){
   assert.equal((await failed.json()).code,'CONFLICT');await page.getByText(/Patient already has a confirmed appointment/).waitFor();assert.equal(reads,0);assert.equal(await page.getByRole('region',{name:'Booking alternatives',exact:true}).count(),0);await context.close();console.log(role+' overlap: no suggestions for unrelated CONFLICT');continue;
  }
  assert.equal((await failed.json()).code,'SLOT_UNAVAILABLE');assert.equal(await count(patient.id),0);
  const flow=page.getByRole('region',{name:'Booking alternatives',exact:true});await flow.getByText('This slot is no longer available. Choose another time.',{exact:true}).waitFor();
  if(late){
   await reached;
   if(scenario==='late-close')await flow.getByRole('button',{name:'Close alternatives',exact:true}).click();
   else await form.getByLabel(reasonLabel,{exact:true}).fill('Changed booking context reason');
   release();await Promise.all(routeTasks);await page.unrouteAll({behavior:'wait'});await page.evaluate(()=>new Promise(requestAnimationFrame));
   assert.equal(await flow.count(),0);assert.equal(await count(patient.id),0);await context.close();console.log(role+' '+scenario+': delayed results did not restore obsolete suggestions');continue;
  }
  const same=flow.getByRole('region',{name:'Same clinic day',exact:true});
  if(scenario==='empty'){
   await same.getByText('No suitable alternatives.',{exact:true}).waitFor();await flow.getByRole('region',{name:'Later clinic dates',exact:true}).getByText('No suitable alternatives.',{exact:true}).waitFor();
   await flow.getByRole('button',{name:'Browse other available slots',exact:true}).click();if(role==='PATIENT')await selectPatientSlot(beyond.id);else await form.getByRole('combobox',{name:'Slot',exact:true}).selectOption(String(beyond.id));assert.equal(await flow.count(),0);assert.equal(await count(patient.id),0);
  }else{
   const choose=()=>same.getByRole('button',{name:/^Review booking on /}).first();await choose().waitFor();
   assert.equal(await flow.getByText(/Appointment times are shown in the clinic/).count(),role==='PATIENT'?1:0);
   if(role==='PATIENT'&&scenario==='success')await flow.screenshot({path:'/tmp/medislot-initial-booking-alternatives.png'});
   // Manual refresh is read-only and preserves the intended patient/reason.
   await flow.getByRole('button',{name:'Refresh alternatives',exact:true}).click();await choose().waitFor();assert.equal(await count(patient.id),0);
   if(scenario==='close'){await flow.getByRole('button',{name:'Close alternatives',exact:true}).click();assert.equal(await count(patient.id),0)}
   else if(scenario==='reason-change'){await form.getByLabel(reasonLabel,{exact:true}).fill('Changed intended reason');assert.equal(await flow.count(),0)}
   else if(scenario==='doctor-change'){await (role==='PATIENT'?page:form).getByRole('combobox',{name:'Doctor',exact:true}).selectOption(String(otherDoctor.id));assert.equal(await flow.count(),0)}
   else if(scenario==='patient-change'){await form.getByLabel('Patient search',{exact:true}).fill(competitor.email);await form.getByRole('combobox',{name:'Patient',exact:true}).selectOption(String(competitor.id));assert.equal(await flow.count(),0)}
   else{
    await choose().click();const confirmation=page.getByRole('region',{name:'Booking confirmation',exact:true});await confirmation.getByText('Visit reason: '+reason,{exact:true}).waitFor();assert.equal(await count(patient.id),0);
    assert.equal((await db.query('SELECT "isBooked" FROM "Calendar" WHERE id=$1',[first.id])).rows[0].isBooked,false);
    if(scenario==='taken-again')assert.equal((await book(competitor,d,first.id)).status,201);
    const before=posts;let unlock,arrived;const hold=new Promise(r=>unlock=r),hit=new Promise(r=>arrived=r);
    await page.route(api+'/appointments',async route=>{arrived();await hold;await route.continue()},{times:1});
    const confirmed=page.waitForResponse(r=>r.url()===api+'/appointments'&&r.request().method()==='POST');
    await confirmation.getByRole('button',{name:'Confirm booking',exact:true}).click();await hit;assert.equal(await confirmation.getByRole('button',{name:'Booking…',exact:true}).isDisabled(),true);
    assert.equal(await flow.getByRole('button',{name:'Close alternatives',exact:true}).isDisabled(),true);await confirmation.getByRole('button',{name:'Booking…',exact:true}).evaluate(el=>{el.click();el.click()});unlock();const result=await confirmed;assert.equal(posts,before+1);
    assert.deepEqual(result.request().postDataJSON(),{patientId:patient.id,doctorId:d.id,calendarId:first.id,reason});
    if(scenario==='taken-again'){
     assert.equal(result.status(),409);assert.equal((await result.json()).code,'SLOT_UNAVAILABLE');assert.equal(await count(patient.id),0);
     await same.getByRole('button',{name:/^Review booking on /}).first().waitFor();await same.getByRole('button',{name:/^Review booking on /}).first().click();
     const retry=page.waitForResponse(r=>r.url()===api+'/appointments'&&r.request().method()==='POST');await page.getByRole('region',{name:'Booking confirmation',exact:true}).getByRole('button',{name:'Confirm booking',exact:true}).click();const retried=await retry;
     assert.equal(retried.status(),201);assert.deepEqual(retried.request().postDataJSON(),{patientId:patient.id,doctorId:d.id,calendarId:second.id,reason});
    }else assert.equal(result.status(),201);
    const stored=(await db.query('SELECT * FROM "Appointment" WHERE "patientId"=$1',[patient.id])).rows;assert.equal(stored.length,1);assert.equal(stored[0].version,1);assert.equal(stored[0].reason,reason);assert.equal(stored[0].status,'CONFIRMED');
   }
  }
  assert.equal(+(await db.query('SELECT COUNT(*) FROM "AppointmentRescheduleHistory"')).rows[0].count,0);
  console.log(role+' '+scenario+': recognized 409, preserved context, expected database results, no history');await context.close();
 }
 console.log('PASS: patient/receptionist initial-booking alternatives, explicit NEW booking, second taken failure, close/empty/browse, context invalidation, delayed responses, duplicate guard, overlap and network exclusions.');
}finally{await browser.close();await db.end()}})().catch(e=>{console.error(e);process.exit(1)});
