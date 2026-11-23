"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import { clinicDateTime } from "../lib/clinicTime";
import type { PaginationMeta, User } from "../lib/types";
import { useAuth } from "../lib/useAuth";

export default function ManagersPage() {
  return <AppShell><RequireAuth roles={["ADMIN"]}><ManagersContent /></RequireAuth></AppShell>;
}
function ManagersContent() {
  const { auth } = useAuth();
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [rows, setRows] = useState<User[]>([]), [page, setPage] = useState(1), [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false), [listError, setListError] = useState("");
  const revision = useRef(0), inFlight = useRef(false);
  function loadManagers(nextPage = page, newest = false) {
    if (!auth) return;
    const current = ++revision.current;
    setPage(nextPage); setLoading(true); setRows([]); setListError("");
    apiRequest<{ data: User[]; meta: PaginationMeta }>("/users" + buildQuery({ role: "MANAGER", page: nextPage, pageSize: 10 }), { token: auth.token })
      .then(response => {
        if (current !== revision.current) return;
        const last = Math.max(1, response.meta.totalPages);
        if (nextPage > last || (newest && nextPage !== last)) { loadManagers(last); return; }
        setPages(response.meta.totalPages); setRows(response.data);
      }).catch(caught => {
        if (current === revision.current) setListError(caught instanceof Error ? caught.message : "Could not load managers");
      }).finally(() => { if (current === revision.current) setLoading(false); });
  }
  useEffect(() => { loadManagers(1); return () => { revision.current++; }; }, [auth]);
  async function createManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!auth || inFlight.current) return;
    const form = event.currentTarget, values = new FormData(form);
    inFlight.current = true; setSaving(true); setMessage(""); setError("");
    try {
      const created = await apiRequest<User>("/managers", { method: "POST", token: auth.token,
        body: { name: String(values.get("name")), email: String(values.get("email")), password: String(values.get("password")) } });
      form.reset(); setMessage(`Manager ${created.name} created.`); loadManagers(1, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create manager"); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <>
    <PageHeader eyebrow="Staff" title="Managers" />
    <form className="form-card compact" onSubmit={createManager} aria-label="Create manager">
      <h2>Create manager</h2><fieldset disabled={saving}><div className="form-grid">
        <label>Name<input maxLength={100} minLength={2} name="name" required type="text" /></label>
        <label>Email<input name="email" required type="email" /></label>
        <label>Password<input maxLength={255} minLength={8} name="password" required type="password" /></label>
      </div><button className="button button-primary" disabled={saving} type="submit">{saving ? "Creating…" : "Create manager"}</button></fieldset>
    </form>
    {message ? <Notice message={message} /> : null}{error ? <Notice message={error} tone="error" /> : null}
    <section aria-label="Manager list">
      <div className="row-actions"><h2>Manager accounts</h2><button className="button button-secondary" disabled={loading} onClick={() => loadManagers()}>Refresh managers</button></div>
      {loading ? <p role="status">Loading managers…</p> : null}{listError ? <Notice message={`Could not load managers: ${listError}`} tone="error" /> : null}
      <div className="table-card table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Created (clinic)</th></tr></thead><tbody>
        {rows.map(manager => <tr key={manager.id}><td>{manager.name}</td><td>{manager.email}</td><td>{manager.createdAt ? clinicDateTime(manager.createdAt) : "Not specified"}</td></tr>)}
        {!loading && !listError && !rows.length ? <tr><td colSpan={3}>No managers yet.</td></tr> : null}
      </tbody></table></div>
      {!loading && !listError && pages > 1 ? <nav className="row-actions" aria-label="Manager pagination">
        <button disabled={page <= 1} onClick={() => loadManagers(page - 1)}>Previous managers</button><span>Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => loadManagers(page + 1)}>Next managers</button>
      </nav> : null}
    </section>
  </>;
}
