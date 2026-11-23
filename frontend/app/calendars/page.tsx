"use client";

import { specializationLabel } from "../lib/specializations";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PatientSlotBooking } from "../components/AppointmentBooking";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import type { CalendarSlot, Doctor } from "../lib/types";
import { clinicDateTime, CLINIC_TIME_NOTICE } from "../lib/clinicTime";
import { useClinicTimeNotice } from "../lib/useClinicTimeNotice";
import { useAuth } from "../lib/useAuth";

type Filters = { doctorId: string; date: string; isBooked: string };

type CalendarResponse = {
  data: CalendarSlot[];
};

type DoctorsResponse = {
  data: Doctor[];
};

export default function CalendarsPage() {
  return (
    <AppShell>
      <RequireAuth>
        <Suspense fallback={<p>Loading available slots…</p>}><CalendarsContent /></Suspense>
      </RequireAuth>
    </AppShell>
  );
}

function CalendarsContent() {
  const { auth, role } = useAuth();
  const requestedDoctor = useSearchParams().get("doctorId") ?? "";
  const initialDoctor = /^[1-9]\d*$/.test(requestedDoctor) && Number(requestedDoctor) <= 2147483647 ? requestedDoctor : "";
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null);
  const [bookingPending, setBookingPending] = useState(false);
  const [booked, setBooked] = useState(false);
  const showClinicNotice = useClinicTimeNotice();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [doctorId, setDoctorId] = useState(initialDoctor);
  const [date, setDate] = useState("");
  const [isBooked, setIsBooked] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [applied, setApplied] = useState<Filters>({ doctorId: "", date: "", isBooked: "" });
  const requestRevision = useRef(0);
  const patient = role === "PATIENT";
  const draft = { doctorId, date, isBooked: patient ? "false" : isBooked };
  const filtersChanged = JSON.stringify(draft) !== JSON.stringify(applied);
  const appliedDoctor = doctors.find((doctor) => String(doctor.userId) === applied.doctorId);

  const canManage = role === "ADMIN" || role === "DOCTOR";
  const minimumSlotDateTime = toDateTimeLocalValue(new Date());

  useEffect(() => {
    if (!auth) return;
    apiRequest<DoctorsResponse>("/doctors", { token: auth.token })
      .then((response) => setDoctors(response.data))
      .catch(() => setDoctors([]));
  }, [auth]);

  function loadSlots(filters: Filters = applied) {
    if (!auth) return;
    const snapshot = { ...filters, isBooked: patient ? "false" : filters.isBooked };
    const revision = ++requestRevision.current;
    setApplied(snapshot);
    setSlots([]);
    setLoading(true);
    setError("");
    apiRequest<CalendarResponse>(
      `/calendars${buildQuery({
        doctorId: snapshot.doctorId || undefined,
        date: snapshot.date || undefined,
        isBooked: snapshot.isBooked === "" ? undefined : snapshot.isBooked,
      })}`,
      { token: auth.token },
    )
      .then((response) => {
        if (revision !== requestRevision.current) return;
        setSlots(snapshot.isBooked === "false"
          ? response.data.filter((slot) => !isExpiredSlot(slot)) : response.data);
      })
      .catch((caught) => {
        if (revision !== requestRevision.current) return;
        setError(caught instanceof Error ? caught.message : "Could not load slots");
      })
      .finally(() => {
        if (revision === requestRevision.current) setLoading(false);
      });
  }

  useEffect(() => {
    setDoctorId(initialDoctor); setDate(""); setSelectedSlot(null);
    loadSlots({ doctorId: initialDoctor, date: "", isBooked: patient ? "false" : "" });
    return () => { requestRevision.current++; };
  }, [auth, initialDoctor]);

  async function createSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    setError("");
    try {
      await apiRequest("/calendars", {
        method: "POST",
        token: auth.token,
        body: {
          doctorId: Number(form.get("doctorId")),
          startTime: new Date(String(form.get("startTime"))).toISOString(),
          endTime: new Date(String(form.get("endTime"))).toISOString(),
        },
      });
      setMessage("Calendar slot created.");
      formElement.reset();
      loadSlots();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create slot");
    }
  }

  async function setSlotBooked(slot: CalendarSlot, nextBooked: boolean) {
    if (!auth) return;
    setMessage("");
    setError("");
    try {
      await apiRequest(`/calendars/${slot.id}`, {
        method: "PUT",
        token: auth.token,
        body: {
          startTime: slot.startTime,
          endTime: slot.endTime,
          isBooked: nextBooked,
        },
      });
      setMessage("Calendar slot updated.");
      loadSlots();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update slot");
    }
  }

  async function deleteSlot(slotId: number) {
    if (!auth) return;
    setMessage("");
    setError("");
    try {
      await apiRequest(`/calendars/${slotId}`, { method: "DELETE", token: auth.token });
      setMessage("Calendar slot deleted.");
      loadSlots();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete slot");
    }
  }

  return (
    <>
      <PageHeader eyebrow={patient ? "Appointments" : "Calendars"} title={patient ? "Book appointment" : "Doctor availability"} />
      {patient ? <Link href="/appointments">My appointments</Link> : null}

      <section className={`filter-card filter-card-fields with-action${patient ? " patient-booking-filters" : ""}`}>
        <label>
          Doctor
          <select disabled={bookingPending} onChange={(event) => { setDoctorId(event.target.value); setSelectedSlot(null); }} value={doctorId}>
            <option value="">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.userId}>
                {doctor.user.name} - {specializationLabel(doctor.specialization)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date (clinic)
          <input disabled={bookingPending} onChange={(event) => { setDate(event.target.value); setSelectedSlot(null); }} type="date" value={date} />
        </label>
        {!patient ? <>
        <label>
          Status
          <select disabled={bookingPending} onChange={(event) => setIsBooked(event.target.value)} value={patient ? "false" : isBooked}>
            {!patient ? <option value="">All</option> : null}
            <option value="false">Available</option>
            {!patient ? <option value="true">Booked</option> : null}
          </select>
        </label>
        </> : null}
        <button className="button button-primary" disabled={bookingPending || (loading && !filtersChanged)} onClick={() => { setSelectedSlot(null); loadSlots(draft); }} type="button">
          Apply
        </button>
      </section>

      {canManage ? (
        <form className="form-card compact" onSubmit={createSlot}>
          <h2>Create slot</h2>
          <div className="form-grid">
            <label>
              Doctor
              <select name="doctorId" required>
                <option value="">Select doctor</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.userId}>
                    {doctor.user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start
              <input min={minimumSlotDateTime} name="startTime" required type="datetime-local" />
            </label>
            <label>
              End
              <input min={minimumSlotDateTime} name="endTime" required type="datetime-local" />
            </label>
          </div>
          <button className="button button-primary" type="submit">Create slot</button>
        </form>
      ) : null}

      <p data-testid="applied-filters">
        Applied filters: {appliedDoctor?.user.name ?? (applied.doctorId || "All doctors")} · {applied.date || "All clinic dates"}{!patient ? <> · {applied.isBooked === "false" ? "Available" : applied.isBooked === "true" ? "Booked" : "All statuses"}</> : null}
      </p>
      {filtersChanged ? <p>Filters changed. Apply to update results.</p> : null}
      {loading ? <p role="status">Loading slots for the applied filters…</p> : null}
      {error ? <Notice message={`Could not load slots for the applied filters: ${error}`} tone="error" /> : null}
      {message ? <Notice message={message} /> : null}

      {patient && booked ? <Link className="button button-secondary" href="/appointments">View my appointments</Link> : null}
      {patient && auth ? <PatientSlotBooking key={JSON.stringify(draft)} slot={selectedSlot} auth={auth}
        setMessage={setMessage} onPending={setBookingPending} onUnavailable={() => loadSlots()}
        onClear={() => setSelectedSlot(null)}
        onBrowse={() => { setSelectedSlot(null); loadSlots(); }}
        onSuccess={() => { setSelectedSlot(null); setBooked(true); loadSlots(); }} /> : null}

      {role === "PATIENT" && showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
      <section className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Doctor</th>
                <th>Start</th>
                <th>End</th>
                {!patient ? <th>Status</th> : null}
                {canManage || patient ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => {
                const expired = isExpiredSlot(slot);
                return (
                  <tr key={slot.id}>
                    <td>{slot.id}</td>
                    <td>{slot.doctor?.user.name ?? slot.doctorId}</td>
                    <td>{formatDateTime(slot.startTime)}</td>
                    <td>{formatDateTime(slot.endTime)}</td>
                    {!patient ? <td>
                      <span className={getSlotStatusClass(slot, expired)}>
                        {getSlotStatusLabel(slot, expired)}
                      </span>
                    </td> : null}
                    {patient ? <td><button className="button button-primary" type="button"
                      disabled={bookingPending || filtersChanged || expired || slot.isBooked || slot.isBlocked}
                      onClick={() => { setMessage(""); setSelectedSlot(slot); }}>Select slot</button></td> : null}
                    {canManage ? (
                      <td className="row-actions">
                        {!expired && !slot.isBlocked ? (
                          <button className="button button-secondary" onClick={() => setSlotBooked(slot, !slot.isBooked)} type="button">
                            {slot.isBooked ? "Mark free" : "Mark booked"}
                          </button>
                        ) : null}
                        <button className="button button-danger" onClick={() => deleteSlot(slot.id)} type="button">
                          Delete
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {!loading && !error && slots.length === 0 ? (
                <tr>
                  <td colSpan={patient ? 5 : canManage ? 6 : 5}>No calendar slots match the filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const formatDateTime = clinicDateTime;

function isExpiredSlot(slot: CalendarSlot) {
  return !slot.isBooked && new Date(slot.startTime).getTime() <= Date.now();
}

function getSlotStatusLabel(slot: CalendarSlot, expired: boolean) {
  if (slot.isBlocked) return "Blocked";
  if (slot.isBooked) return "Booked";
  return expired ? "Expired" : "Available";
}

function getSlotStatusClass(slot: CalendarSlot, expired: boolean) {
  if (slot.isBlocked) return "status warning";
  if (slot.isBooked) return "status muted";
  return expired ? "status warning" : "status good";
}

function toDateTimeLocalValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}
