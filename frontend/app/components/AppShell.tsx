"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "../lib/useAuth";
import type { Role } from "../lib/types";

type NavItem = {
  href: string;
  label: string;
  roles: Role[];
};

const navItems: NavItem[] = [
  { href: "/", label: "Home", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  { href: "/users", label: "Users", roles: ["ADMIN"] },
  { href: "/doctors", label: "Doctors", roles: ["ADMIN", "DOCTOR", "PATIENT"] },
  { href: "/receptionists", label: "Receptionists", roles: ["ADMIN"] },
  { href: "/calendars", label: "Schedule", roles: ["ADMIN", "DOCTOR", "PATIENT"] },
  { href: "/appointments", label: "Appointments", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "PATIENT"] },
  { href: "/profile", label: "Profile", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "PATIENT"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { auth, profile, role, ready, logout } = useAuth();

  const visibleItems = navItems.filter((item) => role && item.roles.includes(role));

  return (
    <main className="app-frame">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">M</span>
          <span>
            <strong>Medislot</strong>
            <small>Clinic appointments</small>
          </span>
        </Link>

        {auth ? (
          <nav className="nav-list" aria-label="Main navigation">
            {visibleItems.map((item) => (
              <Link
                className={pathname === item.href ? "nav-link active" : "nav-link"}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : (
          <nav className="nav-list" aria-label="Authentication navigation">
            <Link className={pathname === "/login" ? "nav-link active" : "nav-link"} href="/login">
              Login
            </Link>
            <Link
              className={pathname === "/register" ? "nav-link active" : "nav-link"}
              href="/register"
            >
              Register
            </Link>
          </nav>
        )}

        <div className="session-card">
          {!ready ? (
            <span>Loading...</span>
          ) : auth ? (
            <>
              <span>
                <strong>{profile?.name ?? "Signed in"}</strong>
                <small>{profile?.email ?? `User #${auth.userId}`}</small>
              </span>
              <button
                className="button button-secondary"
                onClick={() => {
                  logout();
                  router.push("/login");
                }}
                type="button"
              >
                Logout
              </button>
            </>
          ) : (
            <Link className="button button-primary" href="/login">
              Login
            </Link>
          )}
        </div>
      </header>
      <section className="content-shell">{children}</section>
    </main>
  );
}

export function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: Role[];
}) {
  const { ready, isAuthenticated, hasRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, ready, router]);

  if (!ready) return <StatusPanel title="Loading" message="Checking your session." />;
  if (!isAuthenticated) return null;
  if (roles && !hasRole(roles)) {
    return (
      <StatusPanel
        message="This area is not available for your account."
        title="Not allowed"
      />
    );
  }

  return children;
}

export function PageHeader({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  );
}

export function StatusPanel({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <section className="status-panel">
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </section>
  );
}

export function Notice({ message, tone = "info" }: { message: string; tone?: "info" | "error" }) {
  return <p className={tone === "error" ? "notice error" : "notice"}>{message}</p>;
}
