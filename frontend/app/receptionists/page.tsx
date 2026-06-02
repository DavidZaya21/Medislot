"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import type { PaginationMeta, User } from "../lib/types";
import { useAuth } from "../lib/useAuth";

type UsersResponse = {
  data: User[];
  meta: PaginationMeta;
};

export default function ReceptionistsPage() {
  return (
    <AppShell>
      <RequireAuth roles={["ADMIN"]}>
        <ReceptionistsContent />
      </RequireAuth>
    </AppShell>
  );
}

function ReceptionistsContent() {
  const { auth } = useAuth();
  const [receptionists, setReceptionists] = useState<User[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
  });
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function loadReceptionists(nextPage = page, nextSearch = search) {
    if (!auth) return;
    setLoading(true);
    setError("");
    const normalizedSearch = nextSearch.trim();
    apiRequest<UsersResponse>(
      `/users${buildQuery({
        role: "RECEPTIONIST",
        search: normalizedSearch.length >= 2 ? normalizedSearch : undefined,
        page: nextPage,
        pageSize: 10,
      })}`,
      { token: auth.token },
    )
      .then((response) => {
        setReceptionists(response.data);
        setMeta(response.meta);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load receptionists"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadReceptionists(1);
  }, [auth]);

  async function createReceptionist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    const form = new FormData(event.currentTarget);
    setMessage("");
    setError("");
    try {
      await apiRequest("/receptionists", {
        method: "POST",
        token: auth.token,
        body: {
          name: String(form.get("name")),
          email: String(form.get("email")),
          password: String(form.get("password")),
        },
      });
      setMessage("Receptionist created.");
      event.currentTarget.reset();
      setShowCreateForm(false);
      setPage(1);
      loadReceptionists(1, search);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create receptionist");
    }
  }

  async function updateReceptionist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !editing) return;
    const form = new FormData(event.currentTarget);
    setMessage("");
    setError("");
    try {
      await apiRequest(`/users/${editing.id}`, {
        method: "PUT",
        token: auth.token,
        body: {
          name: String(form.get("name")),
          email: String(form.get("email")),
        },
      });
      setMessage("Receptionist updated.");
      setEditing(null);
      loadReceptionists(page, search);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update receptionist");
    }
  }

  async function deleteReceptionist(userId: number) {
    if (!auth) return;
    if (!window.confirm("Delete this receptionist account?")) return;
    setMessage("");
    setError("");
    try {
      await apiRequest(`/users/${userId}`, {
        method: "DELETE",
        token: auth.token,
      });
      setMessage("Receptionist deleted.");
      loadReceptionists(page, search);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete receptionist");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Receptionists" title="Receptionist management">
        <button className="button button-primary" onClick={() => setShowCreateForm(true)} type="button">
          Create receptionist
        </button>
      </PageHeader>

      {editing ? (
        <form className="form-card compact" onSubmit={updateReceptionist}>
          <h2>Edit receptionist</h2>
          <div className="form-grid">
            <label>
              Name
              <input defaultValue={editing.name} maxLength={100} minLength={2} name="name" required type="text" />
            </label>
            <label>
              Email
              <input defaultValue={editing.email} name="email" required type="email" />
            </label>
          </div>
          <div className="row-actions">
            <button className="button button-primary" type="submit">Save changes</button>
            <button className="button button-secondary" onClick={() => setEditing(null)} type="button">Cancel</button>
          </div>
        </form>
      ) : showCreateForm ? (
        <form className="form-card compact" onSubmit={createReceptionist}>
          <div className="form-title-row">
            <h2>Create receptionist</h2>
            <button className="button button-secondary" onClick={() => setShowCreateForm(false)} type="button">
              Cancel
            </button>
          </div>
          <div className="form-grid">
            <label>
              Name
              <input maxLength={100} minLength={2} name="name" required type="text" />
            </label>
            <label>
              Email
              <input name="email" required type="email" />
            </label>
            <label>
              Password
              <input maxLength={255} minLength={8} name="password" required type="password" />
            </label>
          </div>
          <button className="button button-primary" type="submit">Create receptionist</button>
        </form>
      ) : null}

      <form
        className="filter-card"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          loadReceptionists(1, search);
        }}
      >
        <span className="filter-summary">{meta.total} total</span>
        <label>
          Search
          <input
            maxLength={100}
            minLength={2}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or email"
            type="search"
            value={search}
          />
        </label>
        <button className="button button-primary" disabled={loading} type="submit">Filter</button>
        <button
          className="button button-secondary"
          disabled={loading}
          onClick={() => {
            setSearch("");
            setPage(1);
            loadReceptionists(1, "");
          }}
          type="button"
        >
          Clear
        </button>
      </form>

      {error ? <Notice message={error} tone="error" /> : null}
      {message ? <Notice message={message} /> : null}

      <section className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {receptionists.map((receptionist) => (
                <tr key={receptionist.id}>
                  <td>{receptionist.id}</td>
                  <td>{receptionist.name}</td>
                  <td>{receptionist.email}</td>
                  <td>
                    <div className="row-actions">
                      <button className="button button-secondary" onClick={() => setEditing(receptionist)} type="button">
                        Edit
                      </button>
                      <button className="button button-danger" onClick={() => deleteReceptionist(receptionist.id)} type="button">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && receptionists.length === 0 ? (
                <tr>
                  <td colSpan={4}>No receptionists match the current filter.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="pagination-row">
          <span>
            Page {meta.page} of {Math.max(meta.totalPages, 1)}
          </span>
          <div className="pagination-actions">
            <button
              className="button button-secondary"
              disabled={page <= 1 || loading}
              onClick={() => {
                const nextPage = page - 1;
                setPage(nextPage);
                loadReceptionists(nextPage, search);
              }}
              type="button"
            >
              Previous
            </button>
            <button
              className="button button-secondary"
              disabled={page >= meta.totalPages || meta.totalPages === 0 || loading}
              onClick={() => {
                const nextPage = page + 1;
                setPage(nextPage);
                loadReceptionists(nextPage, search);
              }}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
