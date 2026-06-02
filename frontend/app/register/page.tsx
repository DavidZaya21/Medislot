"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Notice } from "../components/AppShell";
import { apiRequest } from "../lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    try {
      await apiRequest("/users", {
        method: "POST",
        body: {
          name: String(form.get("name")),
          email: String(form.get("email")),
          password: String(form.get("password")),
        },
      });
      setMessage("Patient account created. You can login now.");
      event.currentTarget.reset();
      setTimeout(() => router.push("/login"), 900);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-layout">
        <form className="form-card" onSubmit={handleSubmit}>
          <div>
            <h1>Create an account</h1>
            <p>Register as a patient to book visits.</p>
          </div>
          <label>
            Full name
            <input maxLength={100} minLength={2} name="name" placeholder="Your full name" required type="text" />
          </label>
          <label>
            Email
            <input autoComplete="email" name="email" placeholder="you@example.com" required type="email" />
          </label>
          <label>
            Password
            <input
              autoComplete="new-password"
              maxLength={255}
              minLength={8}
              name="password"
              placeholder="At least 8 characters"
              required
              type="password"
            />
          </label>
          {error ? <Notice message={error} tone="error" /> : null}
          {message ? <Notice message={message} /> : null}
          <button className="button button-primary" disabled={loading} type="submit">
            {loading ? "Creating account..." : "Create account"}
          </button>
          <p className="form-help">
            Already registered? <Link href="/login">Log in</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
