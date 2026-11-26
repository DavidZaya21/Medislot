"use client";
import { useEffect, useRef, useState } from "react";
import { apiRequest, buildQuery, getStoredAuth } from "../lib/api";
import type { Appointment, AuthState, PaginationMeta } from "../lib/types";
import { clinicDateTime } from "../lib/clinicTime";
import { AppointmentStatusActions } from "./AppointmentStatusActions";
import { Notice } from "./AppShell";

export function LegacyDisruptions({ auth, disabled, refresh, onPendingChange }: {
  auth: AuthState; disabled: boolean; refresh: number;
  onPendingChange: (pending: boolean, operationId: string, allowRefresh?: boolean) => boolean | void;
}) {
  const [rows,setRows]=useState<Appointment[]>([]),[page,setPage]=useState(1),[pages,setPages]=useState(0),[reload,setReload]=useState(0);
  const [loading,setLoading]=useState(false),[error,setError]=useState("");
  const lastRequested=useRef<string|null>(null);
  useEffect(()=>{
    const key=JSON.stringify([auth.userId,auth.token,auth.sessionId,page,refresh,reload]);
    if(disabled||lastRequested.current===key)return;
    lastRequested.current=key;let settled=false;
    let active=true;
    const current=()=>{const stored=getStoredAuth();return active&&stored?.token===auth.token&&stored.userId===auth.userId&&stored.sessionId===auth.sessionId};
    setLoading(true);setError("");setRows([]);
    apiRequest<{data:Appointment[];meta:PaginationMeta}>("/rescheduling/followUps/legacyAppointments"+buildQuery({page,pageSize:10}),{token:auth.token}).then(response=>{
      if(!current())return;setPages(response.meta.totalPages);
      const last=Math.max(1,response.meta.totalPages);if(page>last){setPage(last);return}setRows(response.data);
    }).catch(e=>{if(current())setError(e instanceof Error?e.message:"Could not load legacy disruptions")}).finally(()=>{settled=true;if(current())setLoading(false)});
    return()=>{active=false;if(!settled&&lastRequested.current===key)lastRequested.current=null};
  },[auth,page,refresh,reload,disabled]);
  return <section aria-label="Legacy disrupted visits" className="form-card">
    <h2>Other disrupted visits</h2><p>These visits can be cancelled without choosing a replacement.</p>
    <button className="button button-secondary" disabled={disabled||loading} onClick={()=>setReload(n=>n+1)}>Refresh legacy visits</button>
    {error?<Notice message={error} tone="error"/>:null}{loading?<p role="status">Loading visits…</p>:null}
    {!loading&&!error&&!rows.length?<p>No legacy disrupted visits.</p>:null}
    {rows.map(appointment=><article key={`${appointment.id}:${auth.sessionId??auth.token}`}>
      <p>Appointment #{appointment.id} · {appointment.patient?.name} · {appointment.doctor?.user.name} · {appointment.slotStartTime?clinicDateTime(appointment.slotStartTime):""}</p>
      {auth.role!=="ADMIN"?<AppointmentStatusActions appointment={appointment} auth={auth} disabled={disabled}
        onPendingChange={onPendingChange} onChanged={()=>setReload(n=>n+1)}/>:null}
    </article>)}
    {pages>1?<nav aria-label="Legacy visit pagination" className="row-actions"><button disabled={disabled||loading||page<=1} onClick={()=>setPage(n=>n-1)}>Previous legacy visits</button><span>Page {page} of {pages}</span><button disabled={disabled||loading||page>=pages} onClick={()=>setPage(n=>n+1)}>Next legacy visits</button></nav>:null}
  </section>;
}
