"use client";

import { FormEvent, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest } from "../lib/api";
import { useAuth } from "../lib/useAuth";

export default function ManagersPage() {
  return (
    <AppShell>
      <RequireAuth roles={["ADMIN"]}>
        <CreateManagerForm />
      </RequireAuth>
    </AppShell>
  );
}

function CreateManagerForm() {
  const { auth } = useAuth();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function createManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || saving) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setMessage("");
    setError("");

    try {
      await apiRequest("/managers", {
        method: "POST",
        token: auth.token,
        body: {
          name: String(form.get("name")),
          email: String(form.get("email")),
          password: String(form.get("password")),
        },
      });
      formElement.reset();
      setMessage("Manager created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create manager");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Managers" title="Create manager" />
      <form className="form-card compact" onSubmit={createManager}>
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
        <button className="button button-primary" disabled={saving} type="submit">
          {saving ? "Creating…" : "Create manager"}
        </button>
      </form>
      {message ? <Notice message={message} /> : null}
      {error ? <Notice message={error} tone="error" /> : null}
    </>
  );
}
