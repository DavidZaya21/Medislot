"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppShell, Notice, PageHeader, RequireAuth } from "../components/AppShell";
import { apiRequest } from "../lib/api";
import type { User } from "../lib/types";
import { useAuth } from "../lib/useAuth";

export default function ProfilePage() {
  return (
    <AppShell>
      <RequireAuth>
        <ProfileContent />
      </RequireAuth>
    </AppShell>
  );
}

function ProfileContent() {
  const { auth, profile } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setUser(profile);
  }, [profile]);

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    const form = new FormData(event.currentTarget);
    setMessage("");
    setError("");
    try {
      const updated = await apiRequest<User>(`/users/${auth.userId}`, {
        method: "PUT",
        token: auth.token,
        body: {
          name: String(form.get("name")),
          email: String(form.get("email")),
        },
      });
      setUser(updated);
      setMessage("Profile updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update profile");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Profile" title="My account" />
      {error ? <Notice message={error} tone="error" /> : null}
      {message ? <Notice message={message} /> : null}
      <form className="form-card narrow" onSubmit={updateProfile}>
        <label>
          Name
          <input defaultValue={user?.name ?? ""} maxLength={100} minLength={2} name="name" required type="text" />
        </label>
        <label>
          Email
          <input defaultValue={user?.email ?? ""} name="email" required type="email" />
        </label>
        <label>
          Role
          <input disabled value={user?.role ?? ""} />
        </label>
        <button className="button button-primary" type="submit">Save profile</button>
      </form>
    </>
  );
}

