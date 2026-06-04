"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest, buildQuery } from "../lib/api";
import type { Doctor } from "../lib/types";
import { useAuth } from "../lib/useAuth";

type DoctorsResponse = {
  data: Doctor[];
};

export default function DoctorsPage() {
  return (
    <AppShell>
      <RequireAuth>
        <DoctorsContent />
      </RequireAuth>
    </AppShell>
  );
}

function DoctorsContent() {
  const { auth, role } = useAuth();
  const [search, setSearch] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingSpecialization, setEditingSpecialization] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canManage = role === "ADMIN";

  function loadDoctors(nextSearch = search, nextSpecialization = specialization) {
    if (!auth) return;
    setLoading(true);
    setError("");
    setMessage("");
    const normalizedSearch = nextSearch.trim();
    const normalizedSpecialization = nextSpecialization.trim();
    apiRequest<DoctorsResponse>(
      `/doctors${buildQuery({
        search: normalizedSearch.length >= 2 ? normalizedSearch : undefined,
        specialization: normalizedSpecialization.length >= 2 ? normalizedSpecialization : undefined,
      })}`,
      { token: auth.token },
    )
      .then((response) => setDoctors(response.data))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load doctors"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDoctors("", "");
  }, [auth]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadDoctors();
  }

  async function createDoctor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    setError("");

    try {
      await apiRequest("/doctors", {
        method: "POST",
        token: auth.token,
        body: {
          name: String(form.get("name")),
          email: String(form.get("email")),
          password: String(form.get("password")),
          specialization: String(form.get("specialization")),
        },
      });
      setMessage("Doctor created.");
      formElement.reset();
      setShowCreateForm(false);
      loadDoctors(search, specialization);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create doctor");
    }
  }

  async function updateDoctor(doctorId: number) {
    if (!auth) return;
    setMessage("");
    setError("");
    try {
      await apiRequest(`/doctors/${doctorId}`, {
        method: "PUT",
        token: auth.token,
        body: { specialization: editingSpecialization },
      });
      setEditingId(null);
      setEditingSpecialization("");
      setMessage("Doctor updated.");
      loadDoctors(search, specialization);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update doctor");
    }
  }

  async function deleteDoctor(doctorId: number) {
    if (!auth) return;
    if (!window.confirm("Delete this doctor and related availability?")) return;
    setMessage("");
    setError("");
    try {
      await apiRequest(`/doctors/${doctorId}`, {
        method: "DELETE",
        token: auth.token,
      });
      setMessage("Doctor deleted.");
      loadDoctors(search, specialization);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete doctor");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Doctors" title={canManage ? "Doctor management" : "Browse doctors"}>
        {canManage ? (
          <button className="button button-primary" onClick={() => setShowCreateForm(true)} type="button">
            Create doctor
          </button>
        ) : null}
      </PageHeader>

      {canManage && showCreateForm ? (
        <form className="form-card compact" onSubmit={createDoctor}>
          <div className="form-title-row">
            <h2>Create doctor</h2>
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
            <label className="wide">
              Specialization
              <input maxLength={100} minLength={2} name="specialization" required type="text" />
            </label>
          </div>
          <button className="button button-primary" type="submit">Create doctor</button>
        </form>
      ) : null}

      <form className="filter-card filter-card-fields with-action" onSubmit={handleSubmit}>
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
        <label>
          Specialization
          <input
            maxLength={100}
            minLength={2}
            onChange={(event) => setSpecialization(event.target.value)}
            placeholder="Cardiology, pediatrics..."
            type="search"
            value={specialization}
          />
        </label>
        <button className="button button-primary" disabled={loading} type="submit">
          Filter
        </button>
        <button
          className="button button-secondary button-small"
          disabled={loading}
          onClick={() => {
            setSearch("");
            setSpecialization("");
            loadDoctors("", "");
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
                <th>Specialization</th>
                {canManage ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {doctors.map((doctor) => (
                <tr key={doctor.id}>
                  <td>{doctor.id}</td>
                  <td>{doctor.user.name}</td>
                  <td>{doctor.user.email}</td>
                  <td>
                    {editingId === doctor.id ? (
                      <input
                        maxLength={100}
                        minLength={2}
                        onChange={(event) => setEditingSpecialization(event.target.value)}
                        required
                        value={editingSpecialization}
                      />
                    ) : (
                      doctor.specialization ?? "General practice"
                    )}
                  </td>
                  {canManage ? (
                    <td>
                      {editingId === doctor.id ? (
                        <div className="row-actions">
                          <button className="button button-primary" onClick={() => updateDoctor(doctor.id)} type="button">
                            Save
                          </button>
                          <button className="button button-secondary" onClick={() => setEditingId(null)} type="button">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="row-actions">
                          <button
                            className="button button-secondary"
                            onClick={() => {
                              setEditingId(doctor.id);
                              setEditingSpecialization(doctor.specialization ?? "");
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                          <button className="button button-danger" onClick={() => deleteDoctor(doctor.id)} type="button">
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
              {!loading && doctors.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 5 : 4}>No doctors match the current filter.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
