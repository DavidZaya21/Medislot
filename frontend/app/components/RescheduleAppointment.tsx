"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "./AppShell";
import { apiRequest, getStoredAuth, type ApiError } from "../lib/api";
import { clinicDate, clinicDateTime, CLINIC_TIME_NOTICE } from "../lib/clinicTime";
import { specializationLabel } from "../lib/specializations";
import { useClinicTimeNotice } from "../lib/useClinicTimeNotice";
import type { Appointment, AuthState, CalendarSlot, Role } from "../lib/types";

type Options = { appointment: Appointment; data: CalendarSlot[] };
type Alternatives = {
  appointment: Appointment;
  window: { startDate: string; endDate: string; timeZone: "Europe/Warsaw" };
  keepYourDay: CalendarSlot[];
  keepYourDoctor: CalendarSlot[];
};

export function canReschedule(appointment: Appointment, role: Role | null, now = Date.now()) {
  if (role !== "PATIENT" && role !== "RECEPTIONIST" && role !== "MANAGER") return false;
  if (appointment.status === "NEEDS_RESCHEDULING") return true;
  if (role === "MANAGER") return false;
  if (appointment.status !== "CONFIRMED" || !appointment.slotStartTime) return false;
  const remaining = Date.parse(appointment.slotStartTime) - now;
  return role === "PATIENT" ? remaining >= 24 * 60 * 60 * 1000 : remaining > 0;
}

export function RescheduleAppointment({ appointment, auth, onClose, onSuccess, onPendingChange }: {
  appointment: Appointment;
  auth: AuthState;
  onClose: () => void;
  onSuccess: (appointment: Appointment) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  // This snapshot only changes after an explicit reload, never when availability refreshes.
  const [original, setOriginal] = useState(appointment);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [alternatives, setAlternatives] = useState<Alternatives | null>(null);
  const [manualOpen, setManualOpen] = useState(appointment.status !== "NEEDS_RESCHEDULING");
  const [doctorId, setDoctorId] = useState("");
  // Keep filter options stable while a taken slot triggers an availability refresh.
  const [doctorChoices, setDoctorChoices] = useState(() => new Map<number, string>([
    [appointment.doctorId, appointment.doctor?.user.name ?? String(appointment.doctorId)],
  ]));
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState("");
  const [confirmation, setConfirmation] = useState<CalendarSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const inFlight = useRef(false);
  const request = useRef(0);
  const sessionGeneration = useRef(0);
  useEffect(() => { const id=++sessionGeneration.current; return () => { if(sessionGeneration.current===id) sessionGeneration.current++; }; }, [auth.token,auth.sessionId,auth.userId]);
  const showClinicNotice = useClinicTimeNotice();

  function handleFailure(caught: unknown) {
    const message = caught instanceof Error ? caught.message : "Could not load replacements";
    const status = (caught as ApiError)?.status;
    setError(/24 hours|already started/.test(message)
      ? (auth.role === "PATIENT" ? "The self-service cutoff has passed. Please contact reception." : "The confirmed appointment has already started and cannot be moved.")
      : message);
    if (status === 409 || status === 404 || status === 403) setReloadRequired(true);
  }

  async function loadOptions(snapshot: Appointment, explicitReload = false) {
    const revision = ++request.current;
    setLoading(true);
    setSlots([]);
    setAlternatives(null);
    try {
      const [optionsResult, recommendationsResult] = await Promise.allSettled([
        apiRequest<Options>(`/appointments/${snapshot.id}/reschedule-options`, { token: auth.token }),
        snapshot.status === "NEEDS_RESCHEDULING"
          ? apiRequest<Alternatives>(`/appointments/${snapshot.id}/alternatives`, { token: auth.token })
          : Promise.resolve(null),
      ]);
      if (revision !== request.current) return;
      if (optionsResult.status === "rejected") throw optionsResult.reason;
      const response = optionsResult.value;
      if (recommendationsResult.status === "rejected") {
        const status = (recommendationsResult.reason as ApiError)?.status;
        if (status === 409 || status === 403 || status === 404) throw recommendationsResult.reason;
        setInfo((previous) => previous || "Suggestions could not be loaded. Browse other available slots or refresh.");
      }
      const recommendations = recommendationsResult.status === "fulfilled" ? recommendationsResult.value : null;
      if (revision !== request.current) return;
      if (response.appointment.calendarId !== snapshot.calendarId || response.appointment.version !== snapshot.version ||
          (recommendations && (recommendations.appointment.calendarId !== snapshot.calendarId || recommendations.appointment.version !== snapshot.version))) {
        setReloadRequired(true);
        setError("Appointment changed. Reload the appointment before confirming another move.");
        return;
      }
      if (explicitReload) setReloadRequired(false);
      setDoctorChoices((previous) => {
        const next = new Map(previous);
        next.set(snapshot.doctorId, snapshot.doctor?.user.name ?? String(snapshot.doctorId));
        for (const slot of response.data) next.set(slot.doctorId, slot.doctor?.user.name ?? String(slot.doctorId));
        return next;
      });
      setSlots(response.data);
      setAlternatives(recommendations);
    } catch (caught) {
      if (revision === request.current) handleFailure(caught);
    } finally {
      if (revision === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadOptions(appointment);
    return () => { request.current++; };
    // The parent keys this component by appointment ID. Only explicit reload replaces its snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() {
    if (inFlight.current) return;
    setLoading(true); setError(""); setInfo(""); setConfirmation(null); setSelected("");
    try {
      const refreshed = await apiRequest<Appointment>(`/appointments/${original.id}`, { token: auth.token });
      setOriginal(refreshed);
      if (refreshed.status !== "NEEDS_RESCHEDULING") setManualOpen(true);
      await loadOptions(refreshed, true);
    } catch (caught) { handleFailure(caught); setLoading(false); }
  }

  async function confirm() {
    if (!confirmation || inFlight.current || reloadRequired || loading) return;
    const id=sessionGeneration.current;
    const current=()=>{const stored=getStoredAuth();return sessionGeneration.current===id&&stored?.token===auth.token&&stored.userId===auth.userId&&stored.sessionId===auth.sessionId};
    if(!current())return;
    inFlight.current = true; setPending(true); onPendingChange?.(true); setError(""); setInfo("");
    try {
      const moved = await apiRequest<Appointment>(`/appointments/${original.id}/reschedule`, {
        method: "POST", token: auth.token,
        body: { currentCalendarId: original.calendarId, newCalendarId: confirmation.id, expectedVersion: original.version },
      });
      if(current()) onSuccess(moved);
    } catch (caught) {
      if(!current())return;
      const message = caught instanceof Error ? caught.message : "Could not reschedule appointment";
      const status = (caught as ApiError)?.status;
      setConfirmation(null); setSelected("");
      if (status === 409 && /Replacement must be a future|Replacement slot is no longer available|Patient already has a confirmed appointment overlapping/.test(message)) {
        setInfo("That replacement is no longer available. Your appointment has not moved. Availability has been refreshed; please select again.");
        await loadOptions(original);
      } else {
        handleFailure(caught);
      }
    } finally { if(current()) { inFlight.current = false; setPending(false); onPendingChange?.(false); } }
  }

  const orderedDoctors = [...doctorChoices].sort(([a], [b]) => Number(b === original.doctorId) - Number(a === original.doctorId));
  const filtered = slots.filter((slot) => (!doctorId || slot.doctorId === Number(doctorId)) && (!date || clinicDate(slot.startTime) === date));

  return <section className="form-card" aria-label="Reschedule appointment">
    <h2>Reschedule appointment #{original.id}</h2>
    <p>Original: {original.doctor?.user.name ?? original.doctorId} · {original.slotStartTime ? clinicDateTime(original.slotStartTime) : ""} – {original.slotEndTime ? clinicDateTime(original.slotEndTime) : ""}</p>
    <p>Times use Europe/Warsaw. Selection reserves nothing; closing makes no changes.</p>
    {showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
    {error ? <Notice message={error} tone="error" /> : null}
    {info ? <Notice message={info} /> : null}
    {reloadRequired ? <button className="button button-primary" type="button" disabled={loading || pending} onClick={reload}>Reload appointment</button> : null}
    <fieldset disabled={loading || pending || reloadRequired}>
      {original.status === "NEEDS_RESCHEDULING" ? <>
        {([['Keep your day', alternatives?.keepYourDay], ['Keep your doctor', alternatives?.keepYourDoctor]] as const).map(([title, suggestions]) =>
          <section key={title} aria-label={title}>
            <h3>{title}</h3>
            {suggestions?.length ? <ul>{suggestions.map((slot) => <li key={slot.id}>
              {slot.doctor?.user.name ?? slot.doctorId} · {clinicDateTime(slot.startTime)} – {clinicDateTime(slot.endTime)}{' '}
              <button className="button button-secondary" type="button"
                aria-label={`Review ${slot.doctor?.user.name ?? slot.doctorId} on ${clinicDateTime(slot.startTime)}`}
                onClick={() => { setSelected(String(slot.id)); setConfirmation(slot); }}>Review</button>
            </li>)}</ul> : !loading ? <p>{alternatives ? "No suitable suggestions." : "Suggestions unavailable."}</p> : null}
          </section>)}
        {alternatives ? <p>Suggestions cover {alternatives.window.startDate} through {alternatives.window.endDate}.</p> : null}
        <button className="button button-secondary" type="button" onClick={() => setManualOpen(true)}>Browse other available slots</button>
      </> : null}
      {manualOpen ? <>
      <div className="form-grid">
        <label>Replacement doctor<select value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setSelected(""); setConfirmation(null); }}>
          <option value="">All suitable doctors</option>
          {orderedDoctors.map(([id, name]) => <option key={id} value={id}>{name} {id === original.doctorId ? "(original doctor)" : "(other doctor)"}</option>)}
        </select></label>
        <label>Replacement date (clinic)<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelected(""); setConfirmation(null); }} /></label>
        <label className="wide">Replacement slot<select value={selected} onChange={(event) => { setSelected(event.target.value); setConfirmation(null); }}>
          <option value="">Select replacement</option>
          {filtered.map((slot) => <option key={slot.id} value={slot.id}>{slot.doctor?.user.name ?? slot.doctorId} {slot.doctorId === original.doctorId ? "(original doctor)" : "(other doctor)"} · {specializationLabel(slot.doctor?.specialization)} · {clinicDateTime(slot.startTime)} – {clinicDateTime(slot.endTime)}</option>)}
        </select></label>
      </div>
      {!loading && filtered.length === 0 ? <p>No suitable slots are available for these filters. Replacements must be published, future, free, the same duration, and with the original doctor or a doctor with matching specialization, without conflicting with the patient’s confirmed appointments. Try another date or contact reception.</p> : null}
      <button className="button button-primary" type="button" disabled={!selected} onClick={() => setConfirmation(slots.find((slot) => slot.id === Number(selected)) ?? null)}>Review replacement</button>
      </> : null}
      <button className="button button-secondary" type="button" onClick={() => { setError(""); setSelected(""); setConfirmation(null); void loadOptions(original); }}>Refresh availability</button>
    </fieldset>
    {loading ? <p role="status">Loading replacements…</p> : null}
    {confirmation && !reloadRequired ? <section aria-label="Rescheduling confirmation">
      <h3>Confirm replacement</h3>
      <p>From: {original.doctor?.user.name ?? original.doctorId} · {original.slotStartTime ? clinicDateTime(original.slotStartTime) : ""} – {original.slotEndTime ? clinicDateTime(original.slotEndTime) : ""}</p>
      <p>To: {confirmation.doctor?.user.name ?? confirmation.doctorId} {confirmation.doctorId === original.doctorId ? "(original doctor)" : "(other doctor)"} · {clinicDateTime(confirmation.startTime)} – {clinicDateTime(confirmation.endTime)}</p>
      <p>The appointment ID and visit reason will stay the same.</p>
      {showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
      <button className="button button-primary" type="button" disabled={pending || loading} onClick={confirm}>{pending ? "Rescheduling…" : "Confirm reschedule"}</button>
    </section> : null}
    <button className="button button-secondary" type="button" disabled={pending} onClick={onClose}>Close rescheduling</button>
  </section>;
}
