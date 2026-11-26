"use client";
import { useEffect, useRef, useState } from "react";
import { apiRequest, getStoredAuth, type ApiError } from "../lib/api";
import type { Appointment, AuthState, AppointmentStatus } from "../lib/types";
import { clinicDateTime } from "../lib/clinicTime";
import { Notice } from "./AppShell";

type Action = "CANCELLED" | "COMPLETED" | "NO_SHOW";
const labels: Record<Action, string> = { CANCELLED: "Cancel", COMPLETED: "Complete", NO_SHOW: "No-show" };
export function AppointmentStatusActions({ appointment, auth, onChanged, onPendingChange, initialAction, onClose, onStale, disabled = false }: {
  appointment: Appointment; auth: AuthState; onChanged: (changed: boolean) => void; onPendingChange?: (value: boolean, operationId: string, allowRefresh?: boolean) => boolean | void;
  initialAction?: Action; onClose?: () => void; onStale?: () => void; disabled?: boolean;
}) {
  const [choice, setChoice] = useState<{ action: Action; snapshot: Appointment } | null>(initialAction ? { action: initialAction, snapshot: appointment } : null);
  const [pending, setPending] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const inFlight = useRef(false), generation = useRef(0);
  useEffect(() => { const id = ++generation.current; return () => { if (generation.current === id) generation.current++; }; }, [auth.token, auth.userId, auth.sessionId]);
  const role = auth.role, assigned = role !== "DOCTOR" || appointment.doctorId === auth.userId;
  const owns = role !== "PATIENT" || appointment.patientId === auth.userId;
  const staff = ["ADMIN", "RECEPTIONIST", "DOCTOR"].includes(role), now = Date.now();
  const canCancel = owns && assigned && !appointment.patient?.closedAt &&
    ((appointment.status === "CONFIRMED" && role !== "MANAGER" && !!appointment.slotStartTime && Date.parse(appointment.slotStartTime) > now) ||
      appointment.status === "NEEDS_RESCHEDULING");
  const canOutcome = staff && assigned && appointment.status === "CONFIRMED" && !!appointment.slotEndTime && Date.parse(appointment.slotEndTime) <= now;
  async function run(reload = false) {
    if (inFlight.current || disabled || (!reload && (!choice || stale))) return;
    const id = generation.current;
    const current = () => { const stored = getStoredAuth(); return generation.current === id && stored?.token === auth.token && stored.userId === auth.userId && stored.sessionId === auth.sessionId; };
    if (!current()) return;
    const operationId = crypto.randomUUID();
    if (onPendingChange?.(true, operationId) === false) return;
    inFlight.current = true; setPending(true); setError("");
    let conflict = false;
    try {
      if (reload) {
        await apiRequest<Appointment>(`/appointments/${appointment.id}`, { token: auth.token });
        if (!current()) return;
        setStale(false); setChoice(null); onChanged(false); onClose?.();
      } else {
        const { snapshot, action } = choice!;
        await apiRequest(`/appointments/${snapshot.id}`, { method: "PUT", token: auth.token, body: {
          status: action, expectedVersion: snapshot.version, currentCalendarId: snapshot.calendarId,
          ...(snapshot.status === "NEEDS_RESCHEDULING" ? snapshot.disruption ?? { legacyDisruption: true } : {}),
        } });
        if (!current()) return;
        setChoice(null); setMessage("Appointment updated."); onChanged(true); onClose?.();
      }
    } catch (caught) {
      if (!current()) return;
      setError(caught instanceof Error ? caught.message : "Could not update appointment");
      if ((caught as ApiError).status === 409) { conflict = true; setStale(true); setChoice(null); onStale?.(); }
    } finally {
      inFlight.current = false;
      if (current()) setPending(false);
      // Lease release is independent of mounted UI effects. The parent fences it
      // by operation ID and session, so an old request cannot release a new one.
      onPendingChange?.(false, operationId, !conflict);
    }
  }
  return <div aria-label={`Appointment ${appointment.id} status actions`}>
    {message ? <Notice message={message} /> : null}{error ? <Notice message={error} tone="error" /> : null}
    {stale ? <><p>Reload the appointment, then choose and confirm a fresh action.</p><button className="button button-secondary" disabled={pending || disabled} onClick={() => run(true)}>Reload appointment</button></> : null}
    {!choice && !stale ? <div className="row-actions">
      {canCancel ? <button className="button button-secondary" disabled={pending || disabled} onClick={() => { setMessage(""); setChoice({ action: "CANCELLED", snapshot: appointment }); }}>Cancel</button> : null}
      {canOutcome ? (["COMPLETED", "NO_SHOW"] as Action[]).map(action => <button key={action} className="button button-secondary" disabled={pending || disabled} onClick={() => { setMessage(""); setChoice({ action, snapshot: appointment }); }}>{labels[action]}</button>) : null}
    </div> : null}
    {choice ? <section className="form-card" aria-label="Confirm appointment status">
      <h2>{labels[choice.action]} this appointment?</h2>
      <p>{choice.snapshot.doctor?.user.name} · {choice.snapshot.slotStartTime ? clinicDateTime(choice.snapshot.slotStartTime) : ""}</p>
      <div className="row-actions"><button className="button button-danger" disabled={pending || disabled} onClick={() => run()}>{pending ? "Updating…" : choice.action === "CANCELLED" ? "Confirm cancellation" : choice.action === "COMPLETED" ? "Confirm completion" : "Confirm no-show"}</button>
      <button className="button button-secondary" disabled={pending || disabled} onClick={() => { setChoice(null); onClose?.(); }}>Keep appointment</button></div>
    </section> : null}
  </div>;
}
