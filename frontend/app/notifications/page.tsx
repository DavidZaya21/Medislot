"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppShell, RequireAuth, PageHeader, Notice } from "../components/AppShell";
import { CompactTabs, compactTabId } from "../components/CompactTabs";
import { apiRequest, buildQuery } from "../lib/api";
import { clinicDateTime, CLINIC_TIME_NOTICE } from "../lib/clinicTime";
import { useClinicTimeNotice } from "../lib/useClinicTimeNotice";
import { useAuth } from "../lib/useAuth";
type Notification = { id: number; doctorName: string; slotStartTime: string; slotEndTime: string; createdAt: string; readAt: string | null; resolvedAt: string | null; href: string | null };
type InboxView = "All" | "Needs action" | "Unread";
const views: InboxView[] = ["All", "Needs action", "Unread"];
const emptyText = { All: "No notifications yet.", "Needs action": "No disruptions need action.", Unread: "No unread notifications." };
export default function InboxPage() { return <AppShell><RequireAuth roles={["PATIENT"]}><Inbox /></RequireAuth></AppShell>; }
function Inbox() {
  const { auth } = useAuth();
  const showClinicNotice = useClinicTimeNotice();
  const [rows, setRows] = useState<Notification[]>([]), [page, setPage] = useState(1), [pages, setPages] = useState(0);
  const [view, setView] = useState<InboxView>("All"), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [reading, setReading] = useState<Set<number>>(new Set());
  const readRequests = useRef(new Set<number>());
  const requestRevision = useRef(0);
  function invalidate() {
    requestRevision.current++;
    setRows([]);
    setLoading(true);
  }
  useEffect(() => {
    if (!auth) return;
    let active = true;
    const revision = ++requestRevision.current;
    const isCurrent = () => active && revision === requestRevision.current;
    setLoading(true); setError(""); setRows([]);
    apiRequest<{ data: Notification[]; meta: { totalPages: number } }>("/notifications" + buildQuery({
      page, pageSize: 20, unread: view === "Unread" ? true : undefined, needsAction: view === "Needs action" ? true : undefined,
    }), { token: auth.token })
      .then((response) => {
        if (!isCurrent()) return;
        setPages(response.meta.totalPages);
        const lastPage = Math.max(1, response.meta.totalPages);
        if (page > lastPage) {
          invalidate();
          setPage(lastPage);
          return;
        }
        setRows(response.data);
      })
      .catch(() => { if (isCurrent()) setError("Could not load inbox."); })
      .finally(() => { if (isCurrent()) setLoading(false); });
    return () => { active = false; };
  }, [auth, page, view, refresh]);
  async function markRead(id: number) {
    if (!auth || readRequests.current.has(id)) return;
    readRequests.current.add(id); setReading(new Set(readRequests.current));
    try { await apiRequest(`/notifications/${id}/read`, { method: "PATCH", token: auth.token }); invalidate(); setRefresh((n) => n + 1); }
    catch { setError("Could not mark notification read."); }
    finally { readRequests.current.delete(id); setReading(new Set(readRequests.current)); }
  }
  return <><PageHeader eyebrow="Appointments" title="Inbox" />
    <div className="inbox-toolbar">
      <CompactTabs options={views} value={view} label="Inbox views" idPrefix="inbox-tab" panelId="inbox-panel"
        onChange={(next) => { if (next === view) return; invalidate(); setView(next); setPage(1); }} />
      <button className="button button-secondary" onClick={() => { invalidate(); setRefresh((n) => n + 1); }} disabled={loading}>Refresh inbox</button>
    </div>
    {showClinicNotice ? <Notice message={CLINIC_TIME_NOTICE} /> : null}
    {error ? <Notice message={error} tone="error" /> : null}
    <section id="inbox-panel" role="tabpanel" aria-labelledby={compactTabId("inbox-tab", view)} tabIndex={0}>
      {loading ? <p role="status">Loading inbox…</p> : null}
      {rows.map((notice) => <section className="form-card" key={notice.id} aria-label={`Notification ${notice.id}`}>
        <h2>{notice.readAt ? "Read" : "Unread"} · Appointment disruption</h2>
        <p>{notice.doctorName} · {clinicDateTime(notice.slotStartTime)} – {clinicDateTime(notice.slotEndTime)}</p>
        <p>{notice.resolvedAt ? "Resolved" : "Needs rescheduling"}</p>
        {notice.href ? <Link className="button button-primary" href={notice.href}>{notice.resolvedAt ? "View appointment" : "Choose a replacement"}</Link> : <p>Appointment no longer available.</p>}
        {!notice.readAt ? <button className="button button-secondary" disabled={reading.has(notice.id)} onClick={() => markRead(notice.id)}>Mark as read</button> : null}
      </section>)}
      {!loading && !error && !rows.length ? <section className="form-card" aria-label="Empty inbox"><h2>{emptyText[view]}</h2></section> : null}
    </section>
    {!loading && !error && pages > 1 ? <nav className="row-actions" aria-label="Inbox pagination">
      <button className="button button-secondary" disabled={page <= 1} onClick={() => { invalidate(); setPage((n) => n - 1); }}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="button button-secondary" disabled={page >= pages} onClick={() => { invalidate(); setPage((n) => n + 1); }}>Next</button>
    </nav> : null}
  </>;
}
