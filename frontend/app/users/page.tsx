"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import type { PaginationMeta, Role, User } from "../lib/types";
import { useAuth } from "../lib/useAuth";

const roles: Array<Role | ""> = ["", "PATIENT", "DOCTOR", "RECEPTIONIST", "ADMIN"];

function userType(role: Role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

type UsersResponse = {
  data: User[];
  meta: PaginationMeta;
};

export default function UsersPage() {
  return (
    <AppShell>
      <RequireAuth roles={["ADMIN"]}>
        <UsersTable />
      </RequireAuth>
    </AppShell>
  );
}

function UsersTable() {
  const { auth, role: currentRole } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<User | null>(null);
  const [meta, setMeta] = useState<PaginationMeta>({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
  });
  const [role, setRole] = useState<Role | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canManage = currentRole === "ADMIN";

  function loadUsers(nextPage = page) {
    if (!auth) return;
    setLoading(true);
    setError("");
    const normalizedSearch = search.trim();

    apiRequest<UsersResponse>(
      `/users${buildQuery({
        role,
        search: normalizedSearch.length >= 2 ? normalizedSearch : undefined,
        page: nextPage,
        pageSize,
      })}`,
      { token: auth.token },
    )
      .then((response) => {
        setUsers(response.data);
        setMeta(response.meta);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load users"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadUsers(page);
  }, [auth, role, search, page, pageSize]);

  async function updateUser(event: FormEvent<HTMLFormElement>) {
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
      setMessage("User updated.");
      setEditing(null);
      loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update user");
    }
  }

  async function deleteUser(userId: number) {
    if (!auth) return;
    if (!window.confirm("Delete this user account?")) return;
    setMessage("");
    setError("");
    try {
      await apiRequest(`/users/${userId}`, {
        method: "DELETE",
        token: auth.token,
      });
      setMessage("User deleted.");
      loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete user");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Users" title="People directory" />

      {editing ? (
        <form className="form-card compact" onSubmit={updateUser}>
          <h2>Edit user</h2>
          <div className="form-grid">
            <label>
              Name
              <input defaultValue={editing.name} maxLength={100} minLength={2} name="name" required type="text" />
            </label>
            <label>
              Email
              <input defaultValue={editing.email} name="email" required type="email" />
            </label>
            <label>
              Type
              <input disabled value={userType(editing.role)} />
            </label>
          </div>
          <div className="row-actions">
            <button className="button button-primary" type="submit">Save changes</button>
            <button className="button button-secondary" onClick={() => setEditing(null)} type="button">Cancel</button>
          </div>
        </form>
      ) : null}

      <section className="filter-card filter-card-fields">
        <label>
          Search
          <input
            maxLength={100}
            minLength={2}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Name or email"
            type="search"
            value={search}
          />
        </label>
        <label>
          Type
          <select
            onChange={(event) => {
              setRole(event.target.value as Role | "");
              setPage(1);
            }}
            value={role}
          >
            {roles.map((item) => (
              <option key={item || "all"} value={item}>
                {item ? userType(item) : "All people"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Page size
          <select
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            value={pageSize}
          >
            {[5, 10, 20, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </section>

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
                <th>Type</th>
                <th>Specialization</th>
                {canManage ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td><span className="role-badge">{userType(user.role)}</span></td>
                  <td>{user.specialization ?? "-"}</td>
                  {canManage ? (
                    <td>
                      <div className="row-actions">
                        <button className="button button-secondary" onClick={() => setEditing(user)} type="button">
                          Edit
                        </button>
                        <button className="button button-danger" onClick={() => deleteUser(user.id)} type="button">
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!loading && users.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5}>No users match the current filters.</td>
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
            <button className="button button-secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} type="button">
              Previous
            </button>
            <button
              className="button button-secondary"
              disabled={page >= meta.totalPages || meta.totalPages === 0 || loading}
              onClick={() => setPage(page + 1)}
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
