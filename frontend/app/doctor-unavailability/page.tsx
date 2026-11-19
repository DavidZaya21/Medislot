"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, type ApiError } from "../lib/api";
import { clinicDateTime, clinicLocalToISO } from "../lib/clinicTime";
import type { Doctor } from "../lib/types";
import { useAuth } from "../lib/useAuth";

type BlockRequest = { doctorId: number; startTime: string; endTime: string; doctorName: string };
type BlockResult = { blockedSlots: number; appointmentsNeedingRescheduling: number };

function errorMessage(caught: unknown) {
  const payload = (caught as ApiError | undefined)?.payload;
  if (payload && typeof payload === "object" && "message" in payload) {
    if (Array.isArray(payload.message)) return payload.message.join("; ");
    if (typeof payload.message === "string") return payload.message;
  }
  return caught instanceof Error ? caught.message : "The request failed. Please try again.";
}

export default function DoctorUnavailabilityPage() {
  return <AppShell><RequireAuth roles={["ADMIN", "MANAGER"]}><UnavailabilityForm /></RequireAuth></AppShell>;
}

function UnavailabilityForm() {
  const { auth } = useAuth();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [doctorError, setDoctorError] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<BlockRequest | null>(null);
  const [result, setResult] = useState<BlockResult | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!auth) return;
    let active = true;
    apiRequest<{ data: Doctor[] }>("/doctors", { token: auth.token })
      .then(({ data }) => { if (active) setDoctors(data); })
      .catch((caught) => { if (active) setDoctorError(errorMessage(caught)); })
      .finally(() => { if (active) setLoadingDoctors(false); });
    return () => { active = false; };
  }, [auth]);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(""); setResult(null); setConfirmation(null);
    const form = new FormData(event.currentTarget);
    try {
      const doctor = doctors.find(({ id }) => id === Number(form.get("doctorId")));
      if (!doctor) throw new Error("Select a doctor.");
      const startTime = clinicLocalToISO(String(form.get("startTime")));
      const endTime = clinicLocalToISO(String(form.get("endTime")));
      if (endTime <= startTime) throw new Error("End must be later than start.");
      setConfirmation({ doctorId: doctor.id, doctorName: doctor.user.name, startTime, endTime });
    } catch (caught) { setError(errorMessage(caught)); }
  }

  async function block() {
    if (!auth || !confirmation || inFlight.current) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      const response = await apiRequest<BlockResult>("/calendars/block", {
        method: "POST", token: auth.token,
        body: { doctorId: confirmation.doctorId, startTime: confirmation.startTime, endTime: confirmation.endTime },
      });
      setResult(response); setConfirmation(null);
    } catch (caught) {
      setError("Could not block the range: " + errorMessage(caught));
    } finally { inFlight.current = false; setPending(false); }
  }

  return <>
    <PageHeader eyebrow="Schedules" title="Doctor unavailability" />
    {/* <p>All date-time fields use Europe/Warsaw, regardless of your device’s timezone.</p> */}
    <p>This blocks overlapping existing published slots and marks their confirmed appointments as needing rescheduling. Original appointments are preserved; they are not automatically rescheduled. It does not block future publication in an empty range.</p>
    <form className="form-card" onSubmit={review} onChange={() => {
      if (!inFlight.current) { setConfirmation(null); setResult(null); setError(""); }
    }}>
      <fieldset disabled={pending}>
        <div className="form-grid">
          <label>Doctor
            <select name="doctorId" required disabled={loadingDoctors || Boolean(doctorError)}>
              <option value="">{loadingDoctors ? "Loading doctors…" : "Select a doctor"}</option>
              {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.user.name}{doctor.specialization ? ` — ${doctor.specialization}` : ""}</option>)}
            </select>
          </label>
          <label>Start (Europe/Warsaw)<input type="datetime-local" name="startTime" required /></label>
          <label>End (Europe/Warsaw)<input type="datetime-local" name="endTime" required /></label>
        </div>
        <button className="button button-primary" type="submit" disabled={pending || loadingDoctors || Boolean(doctorError) || doctors.length === 0}>Review block</button>
      </fieldset>
    </form>
    {doctorError ? <Notice tone="error" message={doctorError} /> : null}
    {!loadingDoctors && !doctorError && doctors.length === 0 ? <Notice message="No doctors are available. Create a doctor account first." /> : null}
    {error ? <Notice tone="error" message={error} /> : null}
    {confirmation ? <section className="form-card" aria-label="Confirm doctor unavailability">
      <h2>Confirm block</h2>
      <p>Doctor: {confirmation.doctorName}</p>
      <p>{clinicDateTime(confirmation.startTime)} – {clinicDateTime(confirmation.endTime)} (Europe/Warsaw)</p>
      <p>Overlapping published slots will become blocked, including booked slots. Their confirmed appointments will need rescheduling. No appointments will be deleted.</p>
      <div className="row-actions">
        <button className="button button-primary" type="button" disabled={pending} onClick={block}>{pending ? "Blocking…" : "Confirm block"}</button>
        <button className="button button-secondary" type="button" disabled={pending} onClick={() => setConfirmation(null)}>Cancel</button>
      </div>
    </section> : null}
    <div aria-live="polite">
      {result ? <section className="status-panel">
        <h2>Blocking complete</h2>
        <p>Newly blocked slots: {result.blockedSlots}</p>
        <p>Appointments needing rescheduling: {result.appointmentsNeedingRescheduling}</p>
        {result.blockedSlots === 0 && result.appointmentsNeedingRescheduling === 0 ? <p>No new changes were needed. The range may already be blocked or have no published slots.</p> : null}
        <Link className="button button-secondary" href="/calendars">View calendar slots</Link>
      </section> : null}
    </div>
  </>;
}
