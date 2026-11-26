"use client";

import { AppointmentStatusActions } from "../components/AppointmentStatusActions";
import { AppointmentBookingFlow, useAppointmentBooking } from "../components/AppointmentBooking";
import Link from "next/link";
import { AppointmentViewTabs, appointmentTabId } from "../components/AppointmentViewTabs";
import { appointmentView, type AppointmentView } from "../lib/appointmentViews";
import { RescheduleAppointment, canReschedule } from "../components/RescheduleAppointment";

import { specializationLabel } from "../lib/specializations";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery, getStoredAuth } from "../lib/api";
import type { Appointment, AppointmentStatus, CalendarSlot, Doctor, PaginationMeta, User } from "../lib/types";
import { clinicDate, clinicDateTime, clinicTime } from "../lib/clinicTime";
import { useAppointmentOperations } from "../lib/useAppointmentOperations";
import { useAuth } from "../lib/useAuth";

type AppointmentsResponse = {
  data: Appointment[];
};

type DoctorsResponse = {
  data: Doctor[];
};

type CalendarResponse = {
  data: CalendarSlot[];
};

type UsersResponse = {
  data: User[];
  meta: PaginationMeta;
};

const statuses: Array<AppointmentStatus | ""> = ["", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "NEEDS_RESCHEDULING"];

export default function AppointmentsPage() {
  return (
    <AppShell>
      <RequireAuth>
        <Suspense fallback={<p>Loading appointments…</p>}><AppointmentsContent /></Suspense>
      </RequireAuth>
    </AppShell>
  );
}

function AppointmentsContent() {
  const { auth, role } = useAuth();
  const deepLinkId = useSearchParams().get("reschedule");
  const [slotDate, setSlotDate] = useState("");
  const bookingForm = useRef<HTMLFormElement>(null);
  const [bookingFormOpen, setBookingFormOpen] = useState(false);
  const patientRequest = useRef(0);
  const [slotRefresh, setSlotRefresh] = useState(0);
  const slotRequest = useRef(0);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [patients, setPatients] = useState<User[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [status, setStatus] = useState<AppointmentStatus | "">("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const operations = useAppointmentOperations(auth);
  const activeStatusId = operations.active?.kind === "status" ? operations.active.appointmentId : null;
  const statusPending = operations.busy;
  useEffect(() => { setMessage(""); setError(""); }, [auth?.token, auth?.sessionId]);

  const canMove = role === "PATIENT" || role === "RECEPTIONIST" || role === "MANAGER";
  const canReview = role === "MANAGER" || role === "ADMIN" || role === "RECEPTIONIST" || role === "DOCTOR" || role === "PATIENT";
  const canDelete = false;
  const canCreateAppointment = role === "RECEPTIONIST";

  const [view, setView] = useState<AppointmentView>("All");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const flow = useAppointmentBooking({ auth, setMessage, setError, onPendingChange: (value,id) => value ? operations.begin(id,"booking") : operations.finish(id), onSuccess: () => {
    resetBookingInputs(); setBookingFormOpen(false); loadAppointments();
  } });
  const { booking, bookingRef, clearBookingRecovery, bookAppointment } = flow;

  function resetBookingInputs() {
    slotRequest.current++; patientRequest.current++;
    bookingForm.current?.reset(); setSlotDate(""); setSlots([]); setPatients([]);
    setPatientSearch(""); setSelectedPatientId(""); setSelectedDoctorId("");
  }
  function toggleBookingForm() {
    if (bookingRef.current || operations.isBusy() || rescheduling) return;
    if (bookingFormOpen) {
      clearBookingRecovery(); resetBookingInputs(); setError(""); setBookingFormOpen(false);
    } else {
      setBookingFormOpen(true);
      requestAnimationFrame(() => bookingForm.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus());
    }
  }
  useEffect(() => {
    setBookingFormOpen(false); resetBookingInputs();
    return () => { slotRequest.current++; patientRequest.current++; };
  }, [auth?.token, auth?.sessionId, auth?.userId]);

  const appointmentRequest = useRef(0);
  useEffect(() => () => { appointmentRequest.current++; }, [auth?.token, auth?.sessionId]);
  function loadAppointments(nextStatus = status) {
    operations.refresh(() => fetchAppointments(nextStatus));
  }
  function fetchAppointments(nextStatus: AppointmentStatus | "") {
    if (!auth) return;
    const request = ++appointmentRequest.current;
    const current = () => { const stored = getStoredAuth(); return appointmentRequest.current === request && stored?.token === auth.token && stored.userId === auth.userId && stored.sessionId === auth.sessionId; };
    setAppointments([]); setLoading(true);
    setError("");

    const path =
      role === "PATIENT"
        ? `/users/${auth.userId}/appointments${buildQuery({ status: nextStatus || undefined })}`
        : `/appointments${buildQuery({ status: nextStatus || undefined })}`;

    apiRequest<AppointmentsResponse>(path, { token: auth.token })
      .then((response) => { if (current()) setAppointments(response.data); })
      .catch((caught) => { if (current()) setError(caught instanceof Error ? caught.message : "Could not load appointments"); })
      .finally(() => { if (current()) setLoading(false); });
  }

  function loadAvailableSlots(doctorId: string) {
    const request = ++slotRequest.current;
    setSlotRefresh((value) => value + 1);
    if (!auth || !doctorId) {
      setSlots([]);
      return;
    }

    apiRequest<CalendarResponse>(
      `/calendars${buildQuery({ doctorId: Number(doctorId), isBooked: false })}`,
      { token: auth.token },
    )
      .then((response) => {
        if (request !== slotRequest.current) return;
        const now = Date.now();
        setSlots(response.data.filter((slot) => new Date(slot.startTime).getTime() > now));
      })
      .catch(() => { if (request === slotRequest.current) setSlots([]); });
  }

  function searchPatients(search: string) {
    const request = ++patientRequest.current;
    if (!auth || search.trim().length < 2) {
      setPatients([]);
      return;
    }

    apiRequest<UsersResponse>(
      `/users${buildQuery({ role: "PATIENT", search: search.trim(), page: 1, pageSize: 10 })}`,
      { token: auth.token },
    )
      .then((response) => { if (request === patientRequest.current) setPatients(response.data); })
      .catch(() => { if (request === patientRequest.current) setPatients([]); });
  }

  useEffect(() => {
    if (!auth) return;
    loadAppointments("");
    apiRequest<DoctorsResponse>("/doctors", { token: auth.token })
      .then((response) => setDoctors(response.data))
      .catch(() => setDoctors([]));
  }, [auth, role]);


  useEffect(() => {
    if (!auth) return;
    const value = deepLinkId;
    setRescheduling(null);
    if (!value) return;
    let active = true;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) { setError("Invalid appointment link."); return; }
    if (role !== "PATIENT" && role !== "RECEPTIONIST") { setError("This rescheduling link is not available for your account."); return; }
    apiRequest<Appointment>(`/appointments/${value}`, { token: auth.token }).then((appointment) => {
      if (!active) return;
      if (appointment.status !== "NEEDS_RESCHEDULING") {
        setMessage("This appointment no longer needs recovery. Current status: " + appointment.status + ".");
        return;
      }
      setRescheduling(appointment);
    }).catch(() => { if (active) setError("This appointment is unavailable or does not belong to your account."); });
    return () => { active = false; };
  }, [auth, role, deepLinkId]);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !bookingFormOpen || bookingRef.current || operations.isBusy() || rescheduling) return;
    const formElement = event.currentTarget;
    clearBookingRecovery();
    const form = new FormData(formElement);
    setMessage("");
    setError("");

    const request = {
      patientId: role === "PATIENT" ? auth.userId : Number(form.get("patientId")),
      doctorId: Number(form.get("doctorId")),
      calendarId: Number(form.get("calendarId")),
      reason: String(form.get("reason")),
    };
    await bookAppointment(request, formElement);
  }

  const slotGroups = new Map<string, CalendarSlot[]>();
  [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime)).forEach((slot) => {
    const date = clinicDate(slot.startTime);
    if (slotDate && date !== slotDate) return;
    slotGroups.set(date, [...(slotGroups.get(date) ?? []), slot]);
  });

  return (
    <>
      <PageHeader eyebrow="Appointments" title={role === "PATIENT" ? "My appointments" : "Appointment management"} />

      {role === "PATIENT" ? <>
        <Link className="button button-primary" href="/calendars">Book appointment</Link>
        <AppointmentViewTabs view={view} disabled={statusPending} onChange={(next) => { setView(next); setNow(Date.now()); }} />
      </> : <>
      <section className="filter-card filter-card-single">
        <label>
          Status
          <select disabled={statusPending}
            onChange={(event) => {
              const nextStatus = event.target.value as AppointmentStatus | "";
              setStatus(nextStatus);
              loadAppointments(nextStatus);
            }}
            value={status}
          >
            {statuses.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "All statuses"}
              </option>
            ))}
          </select>
        </label>
      </section>

      </>}

      {canCreateAppointment ? <button className="button button-secondary" type="button"
        aria-expanded={bookingFormOpen} aria-controls="receptionist-booking-form"
        disabled={booking || statusPending || Boolean(rescheduling)} onClick={toggleBookingForm}>
        {bookingFormOpen ? "Close form" : "Create appointment"}
      </button> : null}
      {canCreateAppointment ? (
        <div id="receptionist-booking-form" hidden={!bookingFormOpen}>
        <form aria-label="Create appointment" ref={bookingForm} className="form-card compact" onSubmit={createAppointment} onChange={clearBookingRecovery}>
          <fieldset disabled={!bookingFormOpen || booking || statusPending || Boolean(rescheduling)}>
          <h2>Create appointment</h2>
          <div className="form-grid">
            <>
                <label>
                  Patient search
                  <input
                    maxLength={100}
                    minLength={2}
                    onChange={(event) => {
                      setPatientSearch(event.target.value);
                      setSelectedPatientId("");
                      searchPatients(event.target.value);
                    }}
                    placeholder="Patient name or email"
                    type="search"
                    value={patientSearch}
                  />
                </label>
                <label>
                  Patient
                  <select
                    name="patientId"
                    onChange={(event) => setSelectedPatientId(event.target.value)}
                    required
                    value={selectedPatientId}
                  >
                    <option value="">Select patient</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.name} - {patient.email}
                      </option>
                    ))}
                  </select>
                </label>
            </>
            <label>
              Doctor
              <select
                name="doctorId"
                onChange={(event) => {
                  setSelectedDoctorId(event.target.value);
                  setSlots([]);
                  setSlotDate("");
                  loadAvailableSlots(event.target.value);
                }}
                required
                value={selectedDoctorId}
              >
                <option value="">Select doctor</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.userId}>
                    {doctor.user.name} - {specializationLabel(doctor.specialization)}
                  </option>
                ))}
              </select>
            </label>
            <label>Date (clinic)
              <input type="date" value={slotDate} onChange={(event) => setSlotDate(event.target.value)} />
            </label>
            <label>
              Slot
              <select name="calendarId" key={selectedDoctorId + slotDate + ":" + slotRefresh} required>
                <option value="">Select available slot</option>
                {[...slotGroups].map(([date, group]) => <optgroup key={date} label={date}>
                  {group.map((slot) => <option key={slot.id} value={slot.id}>
                    {clinicTime(slot.startTime)} – {clinicDate(slot.endTime) === date ? clinicTime(slot.endTime) : clinicDateTime(slot.endTime)}
                  </option>)}
                </optgroup>)}
              </select>
            </label>
            <label className="wide">
              Reason
              <input maxLength={500} minLength={5} name="reason" placeholder="Brief visit reason" required type="text" />
            </label>
          </div>
          <button className="button button-primary" type="submit" disabled={booking || statusPending || Boolean(rescheduling)}>
            Create appointment
          </button>
          </fieldset>
        </form>
        </div>
      ) : null}

      {auth && canCreateAppointment && bookingFormOpen ? <AppointmentBookingFlow flow={flow} auth={auth} onBrowse={() => {
        setSlotDate(""); loadAvailableSlots(selectedDoctorId);
        bookingForm.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }} /> : null}
      {error ? <Notice message={error} tone="error" /> : null}
      {message ? <Notice message={message} /> : null}

      {rescheduling && auth ? <RescheduleAppointment key={rescheduling.id} appointment={rescheduling} auth={auth}
        onClose={() => setRescheduling(null)} onSuccess={(moved) => {
          setAppointments((items) => items.map((item) => item.id === moved.id ? moved : item));
          setRescheduling(null);
          setMessage(`Appointment #${moved.id} rescheduled. Version ${moved.version}; moves: ${moved.rescheduleCount ?? 0}.`);
          loadAppointments();
        }} /> : null}

      <section className="table-card" role={role === "PATIENT" ? "tabpanel" : undefined}
        id={role === "PATIENT" ? "appointment-view-panel" : undefined}
        aria-labelledby={role === "PATIENT" ? appointmentTabId(view) : undefined}
        tabIndex={role === "PATIENT" ? 0 : undefined}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Patient</th>
                <th>Doctor</th>
                <th>Slot</th>
                <th>Status</th>
                <th>Reason</th>
                {canReview || canDelete || canMove ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {appointments.filter((appointment) => role !== "PATIENT" || view === "All" || appointmentView(appointment, now) === view).map((appointment) => {


                return (
                  <tr key={appointment.id}>
                    <td>{appointment.id}</td>
                    <td>{appointment.patient?.name ?? appointment.patientId}</td>
                    <td>{appointment.doctor?.user.name ?? appointment.doctorId}</td>
                    <td>{appointment.slotStartTime ? formatDateTime(appointment.slotStartTime) : appointment.calendarId}</td>
                    <td><span className="status">{appointment.status}</span>{role === "PATIENT" && appointment.status === "CONFIRMED" && appointment.slotStartTime && Date.parse(appointment.slotStartTime) <= now && appointmentView(appointment, now) === "Upcoming" ? <span> · In progress</span> : null}</td>
                    <td>{appointment.reason}<br />Moves: {appointment.rescheduleCount ?? 0}</td>
                    {canReview || canDelete || canMove ? (
                      <td className="row-actions">
                        {canReschedule(appointment, role) ? <button className="button button-secondary" type="button"
                          disabled={Boolean(rescheduling) || statusPending} onClick={() => { setMessage(""); setRescheduling(appointment); }}>Reschedule</button> : null}
                        {role === "PATIENT" && appointment.status === "CONFIRMED" && !canReschedule(appointment, role) ? <span>{appointment.slotStartTime && Date.parse(appointment.slotStartTime) <= now ? "Cancellation and ordinary rescheduling are no longer available." : "For rescheduling within 24 hours, please contact reception. Cancellation remains available before the visit starts."}</span> : null}
                        {auth ? <AppointmentStatusActions key={`${appointment.id}:${auth.sessionId ?? auth.token}`} appointment={appointment} auth={auth} disabled={Boolean(rescheduling) || (statusPending && activeStatusId !== appointment.id)} onPendingChange={(value,id,allowRefresh) => value ? operations.begin(id,"status",appointment.id) : operations.finish(id,allowRefresh)} onChanged={changed => {setMessage(changed ? "Appointment updated." : "Appointment reloaded. Choose and confirm a fresh action.");loadAppointments()}} /> : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {!loading && !appointments.some((appointment) => role !== "PATIENT" || view === "All" || appointmentView(appointment, now) === view) ? (
                <tr>
                  <td colSpan={canReview || canDelete || canMove ? 7 : 6}>No appointments match the current filters.</td>
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

function hasAppointmentEnded(appointment: Appointment) {
  if (!appointment.slotEndTime) return false;
  return new Date(appointment.slotEndTime).getTime() <= Date.now();
}
