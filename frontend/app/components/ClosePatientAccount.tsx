"use client";
import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, getStoredAuth } from "../lib/api";
import { useAuth } from "../lib/useAuth";
import { Notice } from "./AppShell";

export function ClosePatientAccount() {
  const { auth, logout } = useAuth(), router = useRouter();
  const acknowledgementId = useId();
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false), requestId = useRef<string | null>(null);
  const payload = useRef<{ currentPassword: string; confirmed: boolean; requestId: string } | null>(null);
  const context = useRef(0);
  useEffect(() => {
    const generation = ++context.current;
    inFlight.current = false; requestId.current = null; payload.current = null;
    setPending(false); setOpen(false); setUncertain(false); setError("");
    if (auth) {
      const raw = window.sessionStorage.getItem(`medislot.closure.${auth.userId}`);
      try {
        const saved = raw ? JSON.parse(raw) as { requestId: string; sessionId: string | null } : null;
        if (saved && saved.sessionId === (auth.sessionId ?? null) && typeof saved.requestId === "string") {
          requestId.current = saved.requestId;
          // Passwords are never persisted. An open account rejects this receipt probe.
          payload.current = { currentPassword: "receipt-replay", confirmed: true, requestId: saved.requestId };
          setOpen(true); setUncertain(true);
          setError("A previous closure outcome is unconfirmed. Retry to safely check its receipt.");
        }
      } catch { /* An obsolete/invalid receipt cannot initialize recovery. */ }
    }
    return () => { if (context.current === generation) ++context.current; };
  }, [auth?.userId, auth?.token, auth?.sessionId]);
  async function close(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!auth || inFlight.current) return;
    const generation = context.current;
    const isCurrent = () => {
      const stored = getStoredAuth();
      return context.current === generation && stored?.userId === auth.userId &&
        stored.token === auth.token && stored.sessionId === auth.sessionId;
    };
    if (!isCurrent()) return;
    const form = new FormData(event.currentTarget);
    const receiptKey = `medislot.closure.${auth.userId}`;
    requestId.current ??= crypto.randomUUID();
    window.sessionStorage.setItem(receiptKey, JSON.stringify({ requestId: requestId.current, sessionId: auth.sessionId ?? null }));
    payload.current ??= { currentPassword: String(form.get("currentPassword")), confirmed: form.get("confirmed") === "on", requestId: requestId.current };
    inFlight.current = true; setPending(true); setError("");
    try {
      await apiRequest("/users/me/close", { method: "POST", token: auth.token, body: payload.current });
      if (!isCurrent()) return;
      window.sessionStorage.removeItem(receiptKey); window.sessionStorage.setItem("medislot.accountClosed", "1"); payload.current = null; logout(); router.replace("/login?accountClosed=1");
    } catch (caught) {
      if (!isCurrent()) return;
      const status = (caught as { status?: number }).status;
      if (status && status < 500) {
        window.sessionStorage.removeItem(receiptKey); requestId.current = null;
        payload.current = null; setUncertain(false); setError(caught instanceof Error ? caught.message : "Could not close account");
      } else { setUncertain(true); setError("The outcome could not be confirmed. Retry this same request to safely check whether your account was closed."); }
    } finally { if (isCurrent()) { inFlight.current = false; setPending(false); } }
  }
  return <section className="form-card narrow" aria-label="Account closure">
    <h2>Close account</h2>
    <p>Closing your account removes your login and contact details and cancels future bookings and visits needing rescheduling. Authorized clinic staff will retain your appointment history, visit reasons and contact notes.</p>
    {!open ? <button className="button button-secondary" onClick={() => setOpen(true)}>Continue to close account</button> : <form key={`${auth?.userId}:${auth?.sessionId ?? auth?.token}`} onSubmit={close}>
      <p>In-progress and ended visits stay unchanged. Retained history is not fully erased. An email already being sent may still arrive.</p>
      {error ? <Notice message={error} tone="error" /> : null}
      <fieldset disabled={pending || uncertain}>
        <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={255} /></label>
        <div className="account-closure-acknowledgement">
          <input id={acknowledgementId} name="confirmed" type="checkbox" required />
          <label htmlFor={acknowledgementId}>I understand the cancellations and retained history and confirm account closure.</label>
        </div>
      </fieldset>
      <div className="row-actions account-closure-actions">
      <button className="button button-danger" disabled={pending} type="submit">{pending ? "Closing account…" : uncertain ? "Retry closure confirmation" : "Confirm account closure"}</button>
      <button className="button button-secondary" type="button" disabled={pending || uncertain} onClick={() => { setOpen(false); setError(""); payload.current = null; }}>Keep account</button>
      </div>
    </form>}
  </section>;
}
