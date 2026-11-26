"use client";
import { useEffect, useRef, useState } from "react";
import { getStoredAuth } from "./api";
import type { AuthState } from "./types";

type Lease = { id: string; kind: "booking" | "status"; appointmentId?: number };
// The parent owns the lease until the request settles, even if a child unmounts.
// Only the exact lease in its original session may release it or flush a refresh.
export function useAppointmentOperations(auth: AuthState | null) {
  const lease = useRef<Lease | null>(null), deferred = useRef<(() => void) | null>(null), mounted = useRef(false);
  const [active, setActive] = useState<Lease | null>(null);
  useEffect(() => {
    mounted.current = true; lease.current = null; deferred.current = null; setActive(null);
    return () => { mounted.current = false; lease.current = null; deferred.current = null; };
  }, [auth?.userId, auth?.token, auth?.sessionId]);
  function current() {
    const stored = getStoredAuth();
    return mounted.current && !!auth && stored?.userId === auth.userId && stored.token === auth.token && stored.sessionId === auth.sessionId;
  }
  function begin(id: string, kind: Lease["kind"], appointmentId?: number) {
    if (!current() || lease.current) return false;
    lease.current = { id, kind, appointmentId }; setActive(lease.current); return true;
  }
  function finish(id: string, allowRefresh = true) {
    if (!current() || lease.current?.id !== id) return false;
    lease.current = null; setActive(null);
    const refresh = deferred.current; deferred.current = null; if (allowRefresh) refresh?.(); return true;
  }
  function refresh(run: () => void) {
    if (!current()) return;
    if (lease.current) deferred.current = run; else run();
  }
  return { active, busy: !!active, isBusy: () => !!lease.current, begin, finish, refresh };
}
