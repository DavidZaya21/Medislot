"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import type { CalendarSlot, Doctor } from "../lib/types";
import { useAuth } from "../lib/useAuth";

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
        <CalendarsContent />
      </RequireAuth>
    </AppShell>
  );
}

function CalendarsContent() {
  const { auth, role } = useAuth();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [isBooked, setIsBooked] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const canManage = role === "ADMIN" || role === "DOCTOR";
  const minimumSlotDateTime = toDateTimeLocalValue(new Date());

  useEffect(() => {
    if (!auth) return;
    apiRequest<DoctorsResponse>("/doctors", { token: auth.token })
      .then((response) => setDoctors(response.data))
      .catch(() => setDoctors([]));
  }, [auth]);

  function loadSlots() {
    if (!auth) return;
    setLoading(true);
    setError("");
    apiRequest<CalendarResponse>(
      `/calendars${buildQuery({
        doctorId: doctorId ? Number(doctorId) : undefined,
        date: date || undefined,
        isBooked: isBooked === "" ? undefined : isBooked,
      })}`,
      { token: auth.token },
    )
      .then((response) => {
        const visibleSlots =
          isBooked === "false"
            ? response.data.filter((slot) => !isExpiredSlot(slot))
            : response.data;
        setSlots(visibleSlots);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load slots"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadSlots();
  }, [auth]);

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
      <PageHeader eyebrow="Calendars" title="Doctor availability" />

      <section className="filter-card filter-card-fields with-action">
        <label>
          Doctor
          <select onChange={(event) => setDoctorId(event.target.value)} value={doctorId}>
            <option value="">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.userId}>
                {doctor.user.name} - {doctor.specialization}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input onChange={(event) => setDate(event.target.value)} type="date" value={date} />
        </label>
        <label>
          Status
          <select onChange={(event) => setIsBooked(event.target.value)} value={isBooked}>
            <option value="">All</option>
            <option value="false">Available</option>
            <option value="true">Booked</option>
          </select>
        </label>
        <button className="button button-primary" disabled={loading} onClick={loadSlots} type="button">
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

      {error ? <Notice message={error} tone="error" /> : null}
      {message ? <Notice message={message} /> : null}

      <section className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Doctor</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                {canManage ? <th>Actions</th> : null}
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
                    <td>
                      <span className={getSlotStatusClass(slot, expired)}>
                        {getSlotStatusLabel(slot, expired)}
                      </span>
                    </td>
                    {canManage ? (
                      <td className="row-actions">
                        {!expired ? (
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
              {!loading && slots.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5}>No calendar slots match the filters.</td>
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

function isExpiredSlot(slot: CalendarSlot) {
  return !slot.isBooked && new Date(slot.startTime).getTime() <= Date.now();
}

function getSlotStatusLabel(slot: CalendarSlot, expired: boolean) {
  if (slot.isBooked) return "Booked";
  return expired ? "Expired" : "Available";
}

function getSlotStatusClass(slot: CalendarSlot, expired: boolean) {
  if (slot.isBooked) return "status muted";
  return expired ? "status warning" : "status good";
}

function toDateTimeLocalValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}
