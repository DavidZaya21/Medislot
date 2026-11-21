"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest, buildQuery, type ApiError } from "../lib/api";
import type { AuthState, CalendarSlot } from "../lib/types";
import { clinicDateTime, CLINIC_TIME_NOTICE } from "../lib/clinicTime";
import { useClinicTimeNotice } from "../lib/useClinicTimeNotice";
import { Notice } from "./AppShell";

export type BookingRequest = { patientId: number; doctorId: number; calendarId: number; reason: string };
type Suggestions = {
  requestedSlot: CalendarSlot;
  patientId: number;
  window: { startDate: string; endDate: string; timeZone: "Europe/Warsaw" };
  sameDay: CalendarSlot[];
  laterDates: CalendarSlot[];
};

export function isSlotUnavailable(caught: unknown) {
  const error = caught as ApiError | undefined;
  return error?.status === 409 && typeof error.payload === "object" && error.payload !== null &&
    "code" in error.payload && error.payload.code === "SLOT_UNAVAILABLE";
}

export function BookingAlternatives({ request, auth, pending, onSelect, onClose, onBrowse }: {
  request: BookingRequest; auth: AuthState; pending: boolean;
  onSelect: (slot: CalendarSlot) => void; onClose: () => void; onBrowse: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const showClinicNotice = useClinicTimeNotice();

  async function refresh() {
    const current = ++revision.current;
    setLoading(true); setError(""); setSuggestions(null);
    try {
      const response = await apiRequest<Suggestions>(`/calendars/${request.calendarId}/alternatives${buildQuery({
        patientId: auth.role === "PATIENT" ? undefined : request.patientId,
      })}`, { token: auth.token });
      if (current !== revision.current) return;
      if (response.patientId !== request.patientId || response.requestedSlot.id !== request.calendarId || response.requestedSlot.doctorId !== request.doctorId) {
        setError("Booking context changed. Browse available slots again.");
        return;
      }
      setSuggestions(response);
    } catch (caught) {
      if (current === revision.current) setError(caught instanceof Error ? caught.message : "Could not load alternatives");
    } finally { if (current === revision.current) setLoading(false); }
  }

  useEffect(() => {
    void refresh();
    return () => { revision.current++; };
    // The parent remounts for each failed attempt and removes this flow on any context change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <section className="form-card" aria-label="Booking alternatives">
    <h2>Choose another time</h2>
    <p>This slot is no longer available. Choose another time.</p>
    <p>Same doctor, same duration. Selection reserves nothing.</p>
    {showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
    {error ? <Notice message={error} tone="error" /> : null}
    {loading ? <p role="status">Loading alternatives…</p> : null}
    <fieldset disabled={loading || pending}>
      {([['Same clinic day', suggestions?.sameDay], ['Later clinic dates', suggestions?.laterDates]] as const).map(([title, slots]) =>
        <section key={title} aria-label={title}>
          <h3>{title}</h3>
          {slots?.length ? <ul>{slots.map((slot) => <li key={slot.id}>
            {slot.doctor?.user.name ?? slot.doctorId} · {clinicDateTime(slot.startTime)} – {clinicDateTime(slot.endTime)}{' '}
            <button className="button button-secondary" type="button"
              aria-label={`Review booking on ${clinicDateTime(slot.startTime)}`}
              onClick={() => onSelect(slot)}>Review booking</button>
          </li>)}</ul> : suggestions ? <p>No suitable alternatives.</p> : null}
        </section>)}
      <button className="button button-secondary" type="button" onClick={refresh}>Refresh alternatives</button>
    </fieldset>
    <div className="row-actions">
      <button className="button button-secondary" type="button" disabled={pending} onClick={onBrowse}>Browse other available slots</button>
      <button className="button button-secondary" type="button" disabled={pending} onClick={onClose}>Close alternatives</button>
    </div>
  </section>;
}
