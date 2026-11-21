"use client";

import { BookingAlternatives, isSlotUnavailable, type BookingRequest } from "../components/BookingAlternatives";
import { RescheduleAppointment, canReschedule } from "../components/RescheduleAppointment";

import { specializationLabel } from "../lib/specializations";

import { FormEvent, useEffect, useRef, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import type { Appointment, AppointmentStatus, CalendarSlot, Doctor, PaginationMeta, User } from "../lib/types";
import { clinicDate, clinicDateTime, clinicTime, CLINIC_TIME_NOTICE } from "../lib/clinicTime";
import { useClinicTimeNotice } from "../lib/useClinicTimeNotice";
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
        <AppointmentsContent />
      </RequireAuth>
    </AppShell>
  );
}

function AppointmentsContent() {
  const { auth, role } = useAuth();
  const showClinicNotice = useClinicTimeNotice();
  const [slotDate, setSlotDate] = useState("");
  const [confirmation, setConfirmation] = useState<{
    patientId: number; doctorId: number; calendarId: number; reason: string; slot: CalendarSlot;
  } | null>(null);
  const [booking, setBooking] = useState(false);
  const [failedBooking, setFailedBooking] = useState<{ request: BookingRequest; key: number } | null>(null);
  const bookingContext = useRef(0);
  const bookingForm = useRef<HTMLFormElement>(null);
  const [slotRefresh, setSlotRefresh] = useState(0);

  function clearBookingRecovery() {
    bookingContext.current++;
    setFailedBooking(null);
    setConfirmation(null);
  }
  const bookingRef = useRef(false);
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

  const canMove = role === "PATIENT" || role === "RECEPTIONIST";
  const canReview = role === "ADMIN" || role === "RECEPTIONIST" || role === "DOCTOR";
  const canDelete = role === "ADMIN" || role === "RECEPTIONIST";
  const canCreateAppointment = role === "ADMIN" || role === "RECEPTIONIST" || role === "PATIENT";

  function loadAppointments(nextStatus = status) {
    if (!auth) return;
    setLoading(true);
    setError("");

    const path =
      role === "PATIENT"
        ? `/users/${auth.userId}/appointments${buildQuery({ status: nextStatus || undefined })}`
        : `/appointments${buildQuery({ status: nextStatus || undefined })}`;

    apiRequest<AppointmentsResponse>(path, { token: auth.token })
      .then((response) => setAppointments(response.data))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load appointments"))
      .finally(() => setLoading(false));
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
    if (!auth || search.trim().length < 2) {
      setPatients([]);
      return;
    }

    apiRequest<UsersResponse>(
      `/users${buildQuery({ role: "PATIENT", search: search.trim(), page: 1, pageSize: 10 })}`,
      { token: auth.token },
    )
      .then((response) => setPatients(response.data))
      .catch(() => setPatients([]));
  }

  useEffect(() => {
    if (!auth) return;
    loadAppointments("");
    apiRequest<DoctorsResponse>("/doctors", { token: auth.token })
      .then((response) => setDoctors(response.data))
      .catch(() => setDoctors([]));
  }, [auth, role]);

  useEffect(() => { clearBookingRecovery(); }, [auth?.userId, auth?.role, auth?.token]);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || bookingRef.current) return;
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
    if (role === "PATIENT") {
      const slot = slots.find(({ id }) => id === request.calendarId);
      if (slot) setConfirmation({ ...request, slot });
      return;
    }
    await bookAppointment(request, formElement);
  }

  async function bookAppointment(
    request: BookingRequest,
    formElement?: HTMLFormElement,
  ) {
    if (!auth || bookingRef.current) return;
    const context = bookingContext.current;
    bookingRef.current = true;
    setBooking(true);
    setError("");
    try {
      const booked = await apiRequest<Appointment>("/appointments", {
        method: "POST", token: auth.token, body: request,
      });
      if (context !== bookingContext.current) return;
      setFailedBooking(null);
      setMessage(booked.slotStartTime
        ? "Appointment confirmed: " + clinicDateTime(booked.slotStartTime) + (booked.slotEndTime ? " – " + clinicDateTime(booked.slotEndTime) : "")
        : "Appointment created.");
      formElement?.reset();
      setConfirmation(null);
      setSlotDate("");
      setSlots([]);
      setPatients([]);
      setPatientSearch("");
      setSelectedPatientId("");
      setSelectedDoctorId("");
      loadAppointments();
    } catch (caught) {
      if (context !== bookingContext.current) return;
      setConfirmation(null);
      if (isSlotUnavailable(caught)) {
        setError("");
        setFailedBooking({ request: { ...request }, key: ++bookingContext.current });
      } else {
        setFailedBooking(null);
        setError(caught instanceof Error ? caught.message : "Could not create appointment");
      }
    } finally {
      bookingRef.current = false;
      setBooking(false);
    }
  }

  async function updateAppointment(id: number, nextStatus: AppointmentStatus, reason: string) {
    if (!auth) return;
    setMessage("");
    setError("");
    try {
      await apiRequest(`/appointments/${id}`, {
        method: "PUT",
        token: auth.token,
        body: { status: nextStatus, reason },
      });
      setMessage("Appointment updated.");
      loadAppointments();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update appointment");
    }
  }

  async function deleteAppointment(id: number) {
    if (!auth) return;
    setMessage("");
    setError("");
    try {
      await apiRequest(`/appointments/${id}`, { method: "DELETE", token: auth.token });
      setMessage("Appointment deleted.");
      loadAppointments();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete appointment");
    }
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

      <section className="filter-card filter-card-single">
        <label>
          Status
          <select
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

      {canCreateAppointment ? (
        <form ref={bookingForm} className="form-card compact" onSubmit={createAppointment} onChange={clearBookingRecovery}>
          <fieldset disabled={booking}>
          <h2>{role === "PATIENT" ? "Book appointment" : "Create appointment"}</h2>
          {role === "PATIENT" && showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
          <div className="form-grid">
            {role !== "PATIENT" ? (
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
            ) : null}
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
          <button className="button button-primary" type="submit" disabled={booking}>
            {role === "PATIENT" ? "Review booking" : "Create appointment"}
          </button>
          </fieldset>
        </form>
      ) : null}

      {failedBooking && auth ? <BookingAlternatives key={failedBooking.key} request={failedBooking.request} auth={auth} pending={booking}
        onSelect={(slot) => setConfirmation({ ...failedBooking.request, doctorId: slot.doctorId, calendarId: slot.id, slot })}
        onClose={clearBookingRecovery} onBrowse={() => {
          clearBookingRecovery();
          setSlotDate("");
          loadAvailableSlots(selectedDoctorId);
          bookingForm.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }} /> : null}

      {confirmation ? <section className="form-card" aria-label="Booking confirmation">
        <h2>Confirm booking</h2>
        <p>Doctor: {doctors.find(({ id }) => id === confirmation.doctorId)?.user.name}</p>
        <p>{clinicDateTime(confirmation.slot.startTime)} – {clinicDateTime(confirmation.slot.endTime)}</p>
        <p>Visit reason: {confirmation.reason}</p>
        {showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
        <div className="row-actions">
          <button className="button button-primary" type="button" disabled={booking}
            onClick={() => bookAppointment({
              patientId: confirmation.patientId, doctorId: confirmation.doctorId,
              calendarId: confirmation.calendarId, reason: confirmation.reason,
            })}>{booking ? "Booking…" : "Confirm booking"}</button>
          <button className="button button-secondary" type="button" disabled={booking} onClick={() => setConfirmation(null)}>Cancel</button>
        </div>
      </section> : null}
      {error ? <Notice message={error} tone="error" /> : null}
      {message ? <Notice message={message} /> : null}

      {rescheduling && auth ? <RescheduleAppointment key={rescheduling.id} appointment={rescheduling} auth={auth}
        onClose={() => setRescheduling(null)} onSuccess={(moved) => {
          setAppointments((items) => items.map((item) => item.id === moved.id ? moved : item));
          setRescheduling(null);
          setMessage(`Appointment #${moved.id} rescheduled. Version ${moved.version}; moves: ${moved.rescheduleCount ?? 0}.`);
          loadAppointments();
        }} /> : null}

      <section className="table-card">
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
              {appointments.map((appointment) => {
                const canChangeStatus = canReview && appointment.status === "CONFIRMED";
                const canCancel = canReview && (appointment.status === "CONFIRMED" || appointment.status === "NEEDS_RESCHEDULING");
                const canCompleteAppointment = canChangeStatus && hasAppointmentEnded(appointment);

                return (
                  <tr key={appointment.id}>
                    <td>{appointment.id}</td>
                    <td>{appointment.patient?.name ?? appointment.patientId}</td>
                    <td>{appointment.doctor?.user.name ?? appointment.doctorId}</td>
                    <td>{appointment.slotStartTime ? formatDateTime(appointment.slotStartTime) : appointment.calendarId}</td>
                    <td><span className="status">{appointment.status}</span></td>
                    <td>{appointment.reason}<br />Moves: {appointment.rescheduleCount ?? 0}</td>
                    {canReview || canDelete || canMove ? (
                      <td className="row-actions">
                        {canReschedule(appointment, role) ? <button className="button button-secondary" type="button"
                          disabled={Boolean(rescheduling)} onClick={() => { setMessage(""); setRescheduling(appointment); }}>Reschedule</button> : null}
                        {role === "PATIENT" && appointment.status === "CONFIRMED" && !canReschedule(appointment, role) ? <span>For changes, please contact reception.</span> : null}
                        {canCompleteAppointment ? (
                          <button className="button button-secondary" onClick={() => updateAppointment(appointment.id, "COMPLETED", appointment.reason)} type="button">
                            Complete
                          </button>
                        ) : null}
                        {canCancel ? (
                          <button className="button button-secondary" onClick={() => updateAppointment(appointment.id, "CANCELLED", appointment.reason)} type="button">
                            Cancel
                          </button>
                        ) : null}
                        {canDelete && appointment.status !== "NEEDS_RESCHEDULING" ? (
                          <button className="button button-danger" onClick={() => deleteAppointment(appointment.id)} type="button">
                            Delete
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {!loading && appointments.length === 0 ? (
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
