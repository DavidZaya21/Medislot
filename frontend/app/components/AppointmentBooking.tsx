"use client";

import { useEffect, useRef, useState } from "react";
import { BookingAlternatives, isSlotUnavailable, type BookingRequest } from "./BookingAlternatives";
import { Notice } from "./AppShell";
import { apiRequest } from "../lib/api";
import { clinicDateTime, CLINIC_TIME_NOTICE } from "../lib/clinicTime";
import { useClinicTimeNotice } from "../lib/useClinicTimeNotice";
import type { Appointment, AuthState, CalendarSlot } from "../lib/types";

type Confirmation = BookingRequest & { slot: CalendarSlot };

// Shared by patient slot selection and the existing staff booking form.
export function useAppointmentBooking({ auth, setMessage, setError, onSuccess, onUnavailable }: {
  auth: AuthState | null;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
  onSuccess: (appointment: Appointment) => void;
  onUnavailable?: () => void;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [failedBooking, setFailedBooking] = useState<{ request: BookingRequest; key: number } | null>(null);
  const [booking, setBooking] = useState(false);
  const bookingRef = useRef(false);
  const context = useRef(0);

  function clearBookingRecovery() {
    context.current++;
    setFailedBooking(null);
    setConfirmation(null);
  }
  useEffect(() => {
    clearBookingRecovery();
    return () => { context.current++; };
  }, [auth?.userId, auth?.role, auth?.token]);

  async function bookAppointment(request: BookingRequest, form?: HTMLFormElement) {
    if (!auth || bookingRef.current) return;
    const revision = context.current;
    bookingRef.current = true;
    setBooking(true); setError(""); setMessage("");
    try {
      const booked = await apiRequest<Appointment>("/appointments", { method: "POST", token: auth.token, body: request });
      if (revision !== context.current) return;
      setFailedBooking(null); setConfirmation(null);
      setMessage(booked.slotStartTime
        ? "Appointment confirmed: " + clinicDateTime(booked.slotStartTime) + (booked.slotEndTime ? " – " + clinicDateTime(booked.slotEndTime) : "")
        : "Appointment created.");
      form?.reset();
      onSuccess(booked);
    } catch (caught) {
      if (revision !== context.current) return;
      setConfirmation(null);
      if (isSlotUnavailable(caught)) {
        setError("");
        setFailedBooking({ request: { ...request }, key: ++context.current });
        onUnavailable?.();
      } else {
        setFailedBooking(null);
        setError(caught instanceof Error ? caught.message : "Could not create appointment");
      }
    } finally { bookingRef.current = false; setBooking(false); }
  }
  return { confirmation, setConfirmation, failedBooking, booking, bookingRef, clearBookingRecovery, bookAppointment };
}

export function AppointmentBookingFlow({ flow, auth, onBrowse }: {
  flow: ReturnType<typeof useAppointmentBooking>; auth: AuthState; onBrowse: () => void;
}) {
  const showClinicNotice = useClinicTimeNotice();
  const { confirmation, failedBooking, booking } = flow;
  return <>
    {failedBooking ? <BookingAlternatives key={failedBooking.key} request={failedBooking.request} auth={auth} pending={booking}
      onSelect={(slot) => flow.setConfirmation({ ...failedBooking.request, doctorId: slot.doctorId, calendarId: slot.id, slot })}
      onClose={flow.clearBookingRecovery} onBrowse={() => { flow.clearBookingRecovery(); onBrowse(); }} /> : null}
    {confirmation ? <section className="form-card" aria-label="Booking confirmation">
      <h2>Confirm booking</h2>
      <p>Doctor: {confirmation.slot.doctor?.user.name ?? confirmation.doctorId}</p>
      <p>{clinicDateTime(confirmation.slot.startTime)} – {clinicDateTime(confirmation.slot.endTime)}</p>
      <p>Visit reason: {confirmation.reason}</p>
      <p>Selection does not reserve a slot.</p>
      {showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
      <div className="row-actions">
        <button className="button button-primary" type="button" disabled={booking} onClick={() => flow.bookAppointment({
          patientId: confirmation.patientId, doctorId: confirmation.doctorId, calendarId: confirmation.calendarId, reason: confirmation.reason,
        })}>{booking ? "Booking…" : "Confirm booking"}</button>
        <button className="button button-secondary" type="button" disabled={booking} onClick={() => flow.setConfirmation(null)}>Cancel</button>
      </div>
    </section> : null}
  </>;
}

export function PatientSlotBooking({ slot, auth, onSuccess, onBrowse, onClear, onPending, setMessage, onUnavailable }: {
  slot: CalendarSlot | null; auth: AuthState; onSuccess: (appointment: Appointment) => void;
  onBrowse: () => void; onClear: () => void; onUnavailable: () => void; onPending: (pending: boolean) => void; setMessage: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const flow = useAppointmentBooking({ auth, setMessage, setError, onSuccess, onUnavailable });
  useEffect(() => { flow.clearBookingRecovery(); setError(""); }, [slot?.id]);
  useEffect(() => { onPending(flow.booking); }, [flow.booking, onPending]);
  return <>
    {slot ? <form className="form-card compact" aria-label="Selected appointment" onSubmit={(event) => {
      event.preventDefault();
      if (flow.bookingRef.current) return;
      flow.setConfirmation({ patientId: auth.userId, doctorId: slot.doctorId, calendarId: slot.id, reason, slot });
    }}>
      <fieldset disabled={flow.booking}>
        <h2>Selected appointment</h2>
        <p>{slot.doctor?.user.name ?? slot.doctorId} · {clinicDateTime(slot.startTime)} – {clinicDateTime(slot.endTime)}</p>
        <label>Visit reason<input name="reason" required minLength={5} maxLength={500} value={reason}
          onChange={(event) => { setReason(event.target.value); flow.clearBookingRecovery(); setError(""); }} /></label>
        <button className="button button-primary" type="submit">Review booking</button>
        <button className="button button-secondary" type="button" onClick={onClear}>Close selection</button>
      </fieldset>
    </form> : null}
    {error ? <Notice message={error} tone="error" /> : null}
    <AppointmentBookingFlow flow={flow} auth={auth} onBrowse={onBrowse} />
  </>;
}
