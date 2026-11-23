"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppShell, RequireAuth, PageHeader, Notice } from "../../components/AppShell";
import { FollowUpCaseBrowser } from "../../components/FollowUpCaseBrowser";
import { RescheduleAppointment } from "../../components/RescheduleAppointment";
import { apiRequest, buildQuery, type ApiError } from "../../lib/api";
import type { Appointment, PaginationMeta } from "../../lib/types";
import { clinicDateTime, CLINIC_TIME_NOTICE } from "../../lib/clinicTime";
import { useClinicTimeNotice } from "../../lib/useClinicTimeNotice";
import { useAuth } from "../../lib/useAuth";

type Attempt={id:number;actorId:number|null;actorRef:number;createdAt:string;outcome:string;note:string|null};
type Case={notificationId:number;disruptionVersion:number;appointmentId:number;currentCalendarId:number;expectedVersion:number;
 patient:{id:number;name:string;email:string;phone:string|null};contactability:string;doctorName:string;slotStartTime:string;slotEndTime:string;
 timingBasis:"EXACT_POST_LOCK"|"LEGACY_UNKNOWN";legacyEscalatedAt:string|null;scheduledDeadlineAt:string|null;effectiveEscalationAt:string;phoneContactDueAt:string;nextContactAllowedAt:string;contactAllowedNow:boolean;reasons:string[];
 contactSummary:{count:number;last:Attempt|null};actions:{recordContact:boolean;reschedule:boolean;cancel:boolean}};
type History={case:{id:number;resolvedAt:string|null};data:Attempt[];meta:PaginationMeta};
const outcomes=["REACHED_PATIENT","NO_ANSWER","BUSY","VOICEMAIL_LEFT","WRONG_NUMBER"];
const label=(text:string)=>text.replaceAll("_"," ").toLowerCase().replace(/^./,c=>c.toUpperCase());
const errorText=(e:unknown)=> e instanceof Error?e.message:"Request failed";
export default function FollowUpPage(){return <AppShell><RequireAuth roles={["RECEPTIONIST","MANAGER","ADMIN"]}><Queue /></RequireAuth></AppShell>}
function Queue(){
 const {auth,role}=useAuth(),zoneNotice=useClinicTimeNotice();
 const [rows,setRows]=useState<Case[]>([]),[page,setPage]=useState(1),[pages,setPages]=useState(0),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false);
 const [error,setError]=useState(""),[message,setMessage]=useState(""),[reloadRequired,setReloadRequired]=useState(false),[pending,setPending]=useState(false);
 const revision=useRef(0),inFlight=useRef(false),keys=useRef(new Map<number,string>());
 const [moving,setMoving]=useState<Appointment|null>(null),[cancel,setCancel]=useState<{row:Case;appointment:Appointment}|null>(null);
 const [historyId,setHistoryId]=useState<number|null>(null),[historyPage,setHistoryPage]=useState(1),[history,setHistory]=useState<History|null>(null),[historyRefresh,setHistoryRefresh]=useState(0),[historyError,setHistoryError]=useState("");
 const historyRevision=useRef(0);
 const moveInFlight=useRef(false),[movePending,setMovePending]=useState(false);
 const busy=pending||movePending;
 function movePendingChanged(value:boolean){moveInFlight.current=value;setMovePending(value)}
 function invalidate(){revision.current++;setRows([]);setLoading(true)}
 function reload(){if(moveInFlight.current)return;invalidate();setReloadRequired(false);setMoving(null);setCancel(null);keys.current.clear();setRefresh(n=>n+1);setHistoryRefresh(n=>n+1)}
 useEffect(()=>{
  if(!auth)return;let active=true;const current=++revision.current;setLoading(true);setRows([]);setError("");
  apiRequest<{data:Case[];meta:PaginationMeta}>("/rescheduling/followUps"+buildQuery({page,pageSize:20}),{token:auth.token}).then(response=>{
   if(!active||current!==revision.current)return;setPages(response.meta.totalPages);const last=Math.max(1,response.meta.totalPages);
   if(page>last){invalidate();setPage(last);return}setRows(response.data);
  }).catch(e=>{if(active&&current===revision.current)setError(errorText(e))}).finally(()=>{if(active&&current===revision.current)setLoading(false)});
  return()=>{active=false};
 },[auth,page,refresh]);
 useEffect(()=>{
  if(!auth||historyId===null)return;let active=true;const current=++historyRevision.current;setHistory(null);setHistoryError("");
  apiRequest<History>(`/rescheduling/followUps/${historyId}/contactAttempts`+buildQuery({page:historyPage,pageSize:20}),{token:auth.token}).then(response=>{
   if(!active||current!==historyRevision.current)return;const last=Math.max(1,response.meta.totalPages);if(historyPage>last){setHistoryPage(last);return}setHistory(response);
  }).catch(e=>{if(active&&current===historyRevision.current)setHistoryError((e as ApiError).status===404 ? "This case no longer exists or is unavailable." : "Could not load contact history: "+errorText(e))});return()=>{active=false};
 },[auth,historyId,historyPage,historyRefresh]);
 function openHistory(id:number){if(moveInFlight.current)return;historyRevision.current++;setHistory(null);setHistoryId(id);setHistoryPage(1);setHistoryRefresh(n=>n+1)}
 function fail(e:unknown){setError(errorText(e));if((e as ApiError).status===409){setReloadRequired(true);setMoving(null);setCancel(null)}}
 async function appointmentFor(row:Case){
  if(!auth)return;const value=await apiRequest<Appointment>(`/appointments/${row.appointmentId}`,{token:auth.token});
  if(value.status!=="NEEDS_RESCHEDULING"||value.calendarId!==row.currentCalendarId||value.version!==row.expectedVersion){setReloadRequired(true);throw new Error("Disruption changed. Reload the queue before continuing.")}return value;
 }
 async function openAction(row:Case,kind:"move"|"cancel"){
  if(inFlight.current||moveInFlight.current||reloadRequired)return;inFlight.current=true;setPending(true);setError("");
  try{const appointment=await appointmentFor(row);if(appointment){if(kind==="move")setMoving(appointment);else setCancel({row,appointment})}}catch(e){fail(e)}finally{inFlight.current=false;setPending(false)}
 }
 async function record(event:FormEvent<HTMLFormElement>,row:Case){
  event.preventDefault();if(!auth||inFlight.current||moveInFlight.current||reloadRequired)return;inFlight.current=true;setPending(true);setError("");setMessage("");
  const form=event.currentTarget,values=new FormData(form),identity={notificationId:row.notificationId,disruptionVersion:row.disruptionVersion,currentCalendarId:row.currentCalendarId,expectedVersion:row.expectedVersion};
  let key=keys.current.get(row.notificationId);if(!key){key=crypto.randomUUID();keys.current.set(row.notificationId,key)}
  try{await apiRequest(`/appointments/${row.appointmentId}/contactAttempts`,{method:"POST",token:auth.token,body:{...identity,outcome:String(values.get("outcome")),note:String(values.get("note")??""),idempotencyKey:key}});
   setMessage("Contact recorded. The disruption remains open.");keys.current.delete(row.notificationId);openHistory(row.notificationId);reload();
  }catch(e){fail(e)}finally{inFlight.current=false;setPending(false)}
 }
 async function cancelAppointment(){
  if(!auth||!cancel||inFlight.current||moveInFlight.current||reloadRequired)return;inFlight.current=true;setPending(true);setError("");const {row,appointment}=cancel;
  try{await apiRequest(`/appointments/${row.appointmentId}`,{method:"PUT",token:auth.token,body:{status:"CANCELLED",reason:appointment.reason,
   notificationId:row.notificationId,disruptionVersion:row.disruptionVersion,currentCalendarId:row.currentCalendarId,expectedVersion:row.expectedVersion}});
   setMessage("Appointment cancelled. Contact history is retained.");openHistory(row.notificationId);reload();
  }catch(e){fail(e)}finally{inFlight.current=false;setPending(false)}
 }
 return <><PageHeader eyebrow="Reception" title="Rescheduling follow-up" />
  <div className="row-actions"><button className="button button-secondary" disabled={busy||loading} onClick={reload}>Refresh queue</button></div>
  {zoneNotice?<Notice message={CLINIC_TIME_NOTICE}/>:null}{error?<Notice message={error} tone="error"/>:null}{message?<Notice message={message}/>:null}
  {reloadRequired?<Notice message="Reload the queue before recording contact or confirming another action." tone="error"/>:null}
  {movePending?<p role="status">Rescheduling… Please wait for the outcome.</p>:null}
  {loading?<p role="status">Loading follow-up…</p>:null}
  {rows.map(row=><section className="form-card" aria-label={`Follow-up ${row.notificationId}`} key={row.notificationId}>
   <h2>{row.patient.name} · Case #{row.notificationId}</h2><p>{row.doctorName} · {clinicDateTime(row.slotStartTime)} – {clinicDateTime(row.slotEndTime)}</p>
   <p>{row.patient.phone??"Phone number missing"} · {row.patient.email}</p><p>{row.reasons.map(label).join(" · ")}</p>
   <p>Scheduled deadline: {row.scheduledDeadlineAt ? clinicDateTime(row.scheduledDeadlineAt) : "Unknown (legacy case)"}<br/>Escalated: {clinicDateTime(row.effectiveEscalationAt)}<br/>Phone contact due: {clinicDateTime(row.phoneContactDueAt)}</p>
   {!row.contactAllowedNow?<p>Contact hours: 08:00–20:00 Europe/Warsaw. Next opening: {clinicDateTime(row.nextContactAllowedAt)}</p>:null}
   {row.timingBasis==="LEGACY_UNKNOWN"?<p>Migration fallback: original recording time is unknown. Follow up now during contact hours.</p>:null}
   <p>Contact attempts: {row.contactSummary.count}{row.contactSummary.last?` · ${label(row.contactSummary.last.outcome)} · ${clinicDateTime(row.contactSummary.last.createdAt)}`:""}</p>
   <div className="row-actions"><button className="button button-secondary" disabled={movePending} onClick={()=>openHistory(row.notificationId)}>Contact history</button>
    {row.actions.reschedule?<button className="button button-primary" disabled={busy||reloadRequired||!!moving} onClick={()=>openAction(row,"move")}>Choose replacement</button>:null}
    {row.actions.cancel?<button className="button button-danger" disabled={busy||reloadRequired} onClick={()=>openAction(row,"cancel")}>Cancel appointment</button>:null}</div>
   {role!=="ADMIN"?<form aria-label={`Record contact ${row.notificationId}`} onSubmit={event=>record(event,row)}>
    <fieldset disabled={busy||reloadRequired||!!moving||!!cancel||!row.actions.recordContact}><label>Outcome<select name="outcome" required>{outcomes.map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
    <label>Note (optional)<textarea name="note" maxLength={500} rows={2}/></label><p>Arrange retries manually during contact hours.</p><button className="button button-secondary" type="submit">Record contact</button></fieldset></form>:null}
  </section>)}
  {!loading&&!error&&!rows.length?<section className="form-card"><p>No escalated disruptions.</p></section>:null}
  {!loading&&pages>1?<nav className="row-actions" aria-label="Follow-up pagination"><button disabled={page<=1||busy} onClick={()=>{if(moveInFlight.current)return;invalidate();setPage(n=>n-1)}}>Previous</button><span>Page {page} of {pages}</span><button disabled={page>=pages||busy} onClick={()=>{if(moveInFlight.current)return;invalidate();setPage(n=>n+1)}}>Next</button></nav>:null}
  {moving&&auth?<RescheduleAppointment appointment={moving} auth={auth} onPendingChange={movePendingChanged} onClose={()=>{if(!moveInFlight.current)setMoving(null)}} onSuccess={()=>{movePendingChanged(false);setMessage("Appointment rescheduled.");const row=rows.find(r=>r.appointmentId===moving.id);if(row)openHistory(row.notificationId);reload()}}/>:null}
  {cancel?<section className="form-card" aria-label="Confirm disrupted cancellation"><h2>Cancel this appointment?</h2><p>{cancel.row.patient.name} · {cancel.row.doctorName} · {clinicDateTime(cancel.row.slotStartTime)}</p><button className="button button-danger" disabled={busy||reloadRequired} onClick={cancelAppointment}>Confirm cancellation</button><button className="button button-secondary" disabled={busy} onClick={()=>{if(!moveInFlight.current)setCancel(null)}}>Keep appointment</button></section>:null}
  {auth?<FollowUpCaseBrowser auth={auth} disabled={busy} refresh={refresh} selectedId={historyId} onSelect={openHistory}/>:null}
  {historyId!==null?<section className="form-card" aria-label="Contact history"><h2>Contact history · Case #{historyId}</h2>{historyError?<Notice message={historyError} tone="error"/>:!history?<p>Loading history…</p>:<>
   <p>{history.case.resolvedAt?"Resolved":"Unresolved"}</p>{history.data.length?history.data.map(attempt=><article key={attempt.id}><p>{label(attempt.outcome)} · {clinicDateTime(attempt.createdAt)} · {attempt.actorId===null?"Deleted staff":"Staff"} #{attempt.actorRef}</p>{attempt.note?<p>{attempt.note}</p>:null}</article>):<p>No contact attempts for this case.</p>}
   {history.meta.totalPages>1?<div className="row-actions"><button disabled={historyPage<=1||movePending} onClick={()=>{if(!moveInFlight.current)setHistoryPage(n=>n-1)}}>Previous history</button><span>Page {historyPage} of {history.meta.totalPages}</span><button disabled={historyPage>=history.meta.totalPages||movePending} onClick={()=>{if(!moveInFlight.current)setHistoryPage(n=>n+1)}}>Next history</button></div>:null}</>}
   <button className="button button-secondary" disabled={movePending} onClick={()=>{if(moveInFlight.current)return;historyRevision.current++;setHistoryId(null);setHistory(null)}}>Close history</button></section>:null}
 </>;
}
