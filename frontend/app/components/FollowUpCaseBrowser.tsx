"use client";

import { useEffect, useRef, useState } from "react";
import { CompactTabs } from "./CompactTabs";
import { Notice } from "./AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import { clinicDateTime } from "../lib/clinicTime";
import type { AuthState, PaginationMeta } from "../lib/types";

type CaseRow = { notificationId: number; appointmentRef: number; patientName: string | null; doctorName: string;
  slotStartTime: string; slotEndTime: string; resolvedAt: string | null; contactCount: number };
export function FollowUpCaseBrowser({ auth, disabled, refresh, selectedId, onSelect }: {
  auth: AuthState; disabled: boolean; refresh: number; selectedId: number | null; onSelect: (id: number) => void;
}) {
  const [view, setView] = useState<"Active" | "Resolved">("Active"), [page, setPage] = useState(1), [pages, setPages] = useState(0);
  const [rows, setRows] = useState<CaseRow[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const revision = useRef(0);
  function invalidate() { revision.current++; setRows([]); setLoading(true); }
  useEffect(() => {
    let active = true; const request = ++revision.current;
    setLoading(true); setRows([]); setError("");
    apiRequest<{data: CaseRow[]; meta: PaginationMeta}>("/rescheduling/followUps/cases" + buildQuery({ status: view.toUpperCase(), page, pageSize: 10 }), { token: auth.token })
      .then(response => {
        if (!active || request !== revision.current) return;
        setPages(response.meta.totalPages); const last = Math.max(1, response.meta.totalPages);
        if (page > last) { invalidate(); setPage(last); return; }
        setRows(response.data);
      }).catch(caught => { if (active && request === revision.current) setError(caught instanceof Error ? caught.message : "Request failed"); })
      .finally(() => { if (active && request === revision.current) setLoading(false); });
    return () => { active = false; };
  }, [auth, view, page, refresh, reload]);
  return <section aria-label="Case history browsing">
    <h2>Case history</h2>
    <div className="inbox-toolbar"><CompactTabs options={["Active", "Resolved"] as const} value={view} disabled={disabled}
      label="Case history views" idPrefix="follow-up-case-tab" panelId="follow-up-case-results"
      onChange={next => { if (disabled || next === view) return; invalidate(); setPage(1); setView(next); }} />
      <button className="button button-secondary" disabled={disabled || loading} onClick={() => { invalidate(); setReload(value => value + 1); }}>Refresh cases</button>
    </div>
    <section role="tabpanel" id="follow-up-case-results" aria-labelledby={`follow-up-case-tab-${view.toLowerCase()}`} tabIndex={0}>
      {loading ? <p role="status">Loading cases…</p> : null}
      {error ? <Notice message={`Could not load ${view.toLowerCase()} cases: ${error}`} tone="error" /> : null}
      <div className="table-card table-scroll"><table><thead><tr><th>Case</th><th>Patient</th><th>Disrupted visit</th><th>Contact attempts</th><th>History</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.notificationId} aria-selected={selectedId === row.notificationId}>
          <td>#{row.notificationId}</td><td>{row.patientName ?? "Patient no longer available"}</td>
          <td>{row.doctorName} · {clinicDateTime(row.slotStartTime)} – {clinicDateTime(row.slotEndTime)}</td><td>{row.contactCount}</td>
          <td><button className="button button-secondary" type="button" disabled={disabled} onClick={() => onSelect(row.notificationId)} aria-label={`Open history for case ${row.notificationId}`}>Contact history</button></td>
        </tr>)}
        {!loading && !error && !rows.length ? <tr><td colSpan={5}>No {view.toLowerCase()} cases.</td></tr> : null}
      </tbody></table></div>
    </section>
    {!loading && !error && pages > 1 ? <nav className="row-actions" aria-label="Case history pagination">
      <button disabled={disabled || page <= 1} onClick={() => { if (disabled) return; invalidate(); setPage(value => value - 1); }}>Previous cases</button>
      <span>Page {page} of {pages}</span><button disabled={disabled || page >= pages} onClick={() => { if (disabled) return; invalidate(); setPage(value => value + 1); }}>Next cases</button>
    </nav> : null}
  </section>;
}
