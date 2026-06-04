"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import type { Appointment, AppointmentStatus, CalendarSlot, Doctor, PaginationMeta, User } from "../lib/types";
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

const statuses: Array<AppointmentStatus | ""> = ["", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];

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
    if (!auth || !doctorId) {
      setSlots([]);
      return;
    }

    apiRequest<CalendarResponse>(
      `/calendars${buildQuery({ doctorId: Number(doctorId), isBooked: false })}`,
      { token: auth.token },
    )
      .then((response) => {
        const now = Date.now();
        setSlots(response.data.filter((slot) => new Date(slot.startTime).getTime() > now));
      })
      .catch(() => setSlots([]));
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

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    setError("");

    try {
      await apiRequest("/appointments", {
        method: "POST",
        token: auth.token,
        body: {
          patientId: role === "PATIENT" ? auth.userId : Number(form.get("patientId")),
          doctorId: Number(form.get("doctorId")),
          calendarId: Number(form.get("calendarId")),
          reason: String(form.get("reason")),
        },
      });
      setMessage("Appointment created.");
      formElement.reset();
      setSlots([]);
      setPatients([]);
      setPatientSearch("");
      setSelectedPatientId("");
      setSelectedDoctorId("");
      loadAppointments();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create appointment");
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
        <form className="form-card compact" onSubmit={createAppointment}>
          <h2>{role === "PATIENT" ? "Book appointment" : "Create appointment"}</h2>
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
                  loadAvailableSlots(event.target.value);
                }}
                required
                value={selectedDoctorId}
              >
                <option value="">Select doctor</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.userId}>
                    {doctor.user.name} - {doctor.specialization}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Slot
              <select name="calendarId" required>
                <option value="">Select available slot</option>
                {slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {formatDateTime(slot.startTime)} - {formatTime(slot.endTime)}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Reason
              <input maxLength={500} minLength={5} name="reason" placeholder="Brief visit reason" required type="text" />
            </label>
          </div>
          <button className="button button-primary" type="submit">Create appointment</button>
        </form>
      ) : null}

      {error ? <Notice message={error} tone="error" /> : null}
      {message ? <Notice message={message} /> : null}

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
                {canReview || canDelete ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {appointments.map((appointment) => {
                const canChangeStatus = canReview && appointment.status === "CONFIRMED";
                const canCompleteAppointment = canChangeStatus && hasAppointmentEnded(appointment);

                return (
                  <tr key={appointment.id}>
                    <td>{appointment.id}</td>
                    <td>{appointment.patient?.name ?? appointment.patientId}</td>
                    <td>{appointment.doctor?.user.name ?? appointment.doctorId}</td>
                    <td>{appointment.slotStartTime ? formatDateTime(appointment.slotStartTime) : appointment.calendarId}</td>
                    <td><span className="status">{appointment.status}</span></td>
                    <td>{appointment.reason}</td>
                    {canReview || canDelete ? (
                      <td className="row-actions">
                        {canCompleteAppointment ? (
                          <button className="button button-secondary" onClick={() => updateAppointment(appointment.id, "COMPLETED", appointment.reason)} type="button">
                            Complete
                          </button>
                        ) : null}
                        {canChangeStatus ? (
                          <button className="button button-secondary" onClick={() => updateAppointment(appointment.id, "CANCELLED", appointment.reason)} type="button">
                            Cancel
                          </button>
                        ) : null}
                        {canDelete ? (
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
                  <td colSpan={canReview || canDelete ? 7 : 6}>No appointments match the current filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    timeStyle: "short",
  }).format(new Date(value));
}

function hasAppointmentEnded(appointment: Appointment) {
  if (!appointment.slotEndTime) return false;
  return new Date(appointment.slotEndTime).getTime() <= Date.now();
}
