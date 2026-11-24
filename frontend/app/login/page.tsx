"use client";

import { FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Notice } from "../components/AppShell";
import { returnDestination } from "../lib/returnDestination";
import { useAuth } from "../lib/useAuth";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => { setClosed(previous => previous || new URLSearchParams(window.location.search).get("accountClosed") === "1" || window.sessionStorage.getItem("medislot.accountClosed") === "1"); }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    try {
      const auth = await login(String(form.get("email")), String(form.get("password")));
      window.sessionStorage.removeItem("medislot.accountClosed");
      const destination = returnDestination(new URLSearchParams(window.location.search).get("next"));
      router.push(destination ?? (auth.role === "PATIENT" ? "/calendars" : "/"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-layout">
        <form className="form-card" onSubmit={handleSubmit}>
          <div>
            <h1>Welcome back</h1>
            <p>Log in to your Medislot account.</p>
          </div>
          <label>
            Email
            <input autoComplete="email" name="email" placeholder="you@example.com" required type="email" />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              minLength={8}
              name="password"
              placeholder="Your password"
              required
              type="password"
            />
          </label>
          {closed ? <Notice message="Your account is closed. Login and contact details have been removed; authorized staff retain the history described in your confirmation." /> : null}
          {error ? <Notice message={error} tone="error" /> : null}
          <button className="button button-primary" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Log in"}
          </button>
          <p className="form-help">
            New patient? <Link href="/register">Create an account</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
