"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "./AppShell";
import { apiRequest, type ApiError } from "../lib/api";
import { clinicDate, clinicDateTime, CLINIC_TIME_NOTICE } from "../lib/clinicTime";
import { specializationLabel } from "../lib/specializations";
import { useClinicTimeNotice } from "../lib/useClinicTimeNotice";
import type { Appointment, AuthState, CalendarSlot, Role } from "../lib/types";

type Options = { appointment: Appointment; data: CalendarSlot[] };

export function canReschedule(appointment: Appointment, role: Role | null, now = Date.now()) {
  if (role !== "PATIENT" && role !== "RECEPTIONIST") return false;
  if (appointment.status === "NEEDS_RESCHEDULING") return true;
  if (appointment.status !== "CONFIRMED" || !appointment.slotStartTime) return false;
  const remaining = Date.parse(appointment.slotStartTime) - now;
  return role === "PATIENT" ? remaining >= 24 * 60 * 60 * 1000 : remaining > 0;
}

export function RescheduleAppointment({ appointment, auth, onClose, onSuccess }: {
  appointment: Appointment;
  auth: AuthState;
  onClose: () => void;
  onSuccess: (appointment: Appointment) => void;
}) {
  // This snapshot only changes after an explicit reload, never when availability refreshes.
  const [original, setOriginal] = useState(appointment);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
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
    try {
      const response = await apiRequest<Options>(`/appointments/${snapshot.id}/reschedule-options`, { token: auth.token });
      if (revision !== request.current) return;
      if (response.appointment.calendarId !== snapshot.calendarId || response.appointment.version !== snapshot.version) {
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
      await loadOptions(refreshed, true);
    } catch (caught) { handleFailure(caught); setLoading(false); }
  }

  async function confirm() {
    if (!confirmation || inFlight.current || reloadRequired || loading) return;
    inFlight.current = true; setPending(true); setError(""); setInfo("");
    try {
      const moved = await apiRequest<Appointment>(`/appointments/${original.id}/reschedule`, {
        method: "POST", token: auth.token,
        body: { currentCalendarId: original.calendarId, newCalendarId: confirmation.id, expectedVersion: original.version },
      });
      onSuccess(moved);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not reschedule appointment";
      const status = (caught as ApiError)?.status;
      setConfirmation(null); setSelected("");
      if (status === 409 && /Replacement must be a future|Replacement slot is no longer available|Patient already has a confirmed appointment overlapping/.test(message)) {
        setInfo("That replacement is no longer available. Your appointment has not moved. Availability has been refreshed; please select again.");
        await loadOptions(original);
      } else {
        handleFailure(caught);
      }
    } finally { inFlight.current = false; setPending(false); }
  }

  const orderedDoctors = [...doctorChoices].sort(([a], [b]) => Number(b === original.doctorId) - Number(a === original.doctorId));
  const filtered = slots.filter((slot) => (!doctorId || slot.doctorId === Number(doctorId)) && (!date || clinicDate(slot.startTime) === date));

  return <section className="form-card" aria-label="Reschedule appointment">
    <h2>Reschedule appointment #{original.id}</h2>
    <p>Original: {original.doctor?.user.name ?? original.doctorId} · {original.slotStartTime ? clinicDateTime(original.slotStartTime) : ""} – {original.slotEndTime ? clinicDateTime(original.slotEndTime) : ""}</p>
    <p>Times use Europe/Warsaw. Selecting a replacement does not reserve it. Closing this form makes no appointment changes.</p>
    {showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
    {error ? <Notice message={error} tone="error" /> : null}
    {info ? <Notice message={info} /> : null}
    {reloadRequired ? <button className="button button-primary" type="button" disabled={loading || pending} onClick={reload}>Reload appointment</button> : null}
    <fieldset disabled={loading || pending || reloadRequired}>
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
      <button className="button button-secondary" type="button" onClick={() => { setError(""); setSelected(""); setConfirmation(null); void loadOptions(original); }}>Refresh availability</button>
      <button className="button button-primary" type="button" disabled={!selected} onClick={() => setConfirmation(slots.find((slot) => slot.id === Number(selected)) ?? null)}>Review replacement</button>
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
