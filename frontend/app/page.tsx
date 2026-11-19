"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { AppShell, PageHeader, RequireAuth } from "./components/AppShell";
import { useAuth } from "./lib/useAuth";
import LoginPage from "./login/page";

const roleCopy = {
  ADMIN: {
    title: "Manage the whole clinic from one operational view.",
    cards: [
      ["Doctor unavailability", "Block published slots and flag appointments for rescheduling.", "/doctor-unavailability"],
      ["Generate schedule", "Preview proposed doctor availability.", "/schedule-generation"],
      ["Users", "Filter, paginate, and review all user accounts.", "/users"],
      ["Receptionists", "Create and maintain receptionist accounts.", "/receptionists"],
      ["Doctors", "Create, edit, and review doctor accounts.", "/doctors"],
      ["Appointments", "Review, complete, or cancel appointments.", "/appointments"],
    ],
  },
  MANAGER: {
    title: "Manager dashboard",
    cards: [["Doctor unavailability", "Block published slots and flag appointments for rescheduling.", "/doctor-unavailability"], ["Generate schedule", "Preview proposed doctor availability.", "/schedule-generation"]],
  },
  RECEPTIONIST: {
    title: "Keep the appointment desk moving.",
    cards: [
      ["Appointments", "Search patients, choose doctors, and manage visits.", "/appointments"],
    ],
  },
  DOCTOR: {
    title: "Review appointments and manage your availability.",
    cards: [
      ["Appointments", "See appointment requests and visit status.", "/appointments"],
      ["Calendars", "Create and update available slots.", "/calendars"],
      ["Generate schedule", "Preview proposed doctor availability.", "/schedule-generation"],
      ["Users", "Look up clinic users when needed.", "/users"],
    ],
  },
  PATIENT: {
    title: "Find care and manage your appointments.",
    cards: [
      ["Doctors", "Find the right doctor by specialization.", "/doctors"],
      ["Calendars", "Pick an available doctor slot.", "/calendars"],
      ["Appointments", "Book and review your appointments.", "/appointments"],
    ],
  },
};

export default function HomePage() {
  const { ready, isAuthenticated } = useAuth();

  if (!ready || !isAuthenticated) return <LoginPage />;

  return (
    <AppShell>
      <RequireAuth>
        <Dashboard />
      </RequireAuth>
    </AppShell>
  );
}

function Dashboard() {
  const { role } = useAuth();
  const router = useRouter();
  const content = role ? roleCopy[role] : null;

  useEffect(() => {
    if (role === "PATIENT") router.replace("/doctors");
  }, [role, router]);

  return (
    <>
      <PageHeader eyebrow="Dashboard" title={content?.title ?? "Welcome to Medislot"} />

      <section className="action-grid">
        {content?.cards.map(([title, description, href]) => (
          <Link className="action-card" href={href} key={href}>
            <strong>{title}</strong>
            <span>{description}</span>
          </Link>
        ))}
      </section>
    </>
  );
}
