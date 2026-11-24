"use client";

import { useEffect, useMemo, useState } from "react";

import {
  apiRequest,
  clearStoredAuth,
  decodeAuthToken,
  getStoredAuth,
  storeAuth,
} from "./api";
import type { AuthState, Role, User } from "./types";

type LoginResponse = {
  accessToken: string;
  tokenType: string;
};

export function useAuth() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => { setAuth(getStoredAuth()); setReady(true); };
    sync();
    const storage = (event: StorageEvent) => { if (event.key === "medislot.auth" || event.key === null) sync(); };
    window.addEventListener("storage", storage);
    window.addEventListener("medislot-auth-changed", sync);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener("medislot-auth-changed", sync); };
  }, []);

  useEffect(() => {
    if (!auth) {
      setProfile(null);
      return;
    }

    let active = true;
    apiRequest<User>(`/users/${auth.userId}`, { token: auth.token })
      .then(user => { if (active) setProfile(user); })
      .catch(() => { if (active) setProfile(null); });
    return () => { active = false; };
  }, [auth]);

  const role = auth?.role ?? null;

  return useMemo(
    () => ({
      auth,
      profile,
      ready,
      role,
      isAuthenticated: Boolean(auth),
      hasRole: (roles: Role[]) => Boolean(role && roles.includes(role)),
      login: async (email: string, password: string) => {
        const response = await apiRequest<LoginResponse>("/sessions", {
          method: "POST",
          body: { email, password },
        });
        const nextAuth = decodeAuthToken(response.accessToken);
        storeAuth(nextAuth);
        setAuth(nextAuth);
        return nextAuth;
      },
      logout: () => {
        clearStoredAuth();
        setAuth(null);
        setProfile(null);
      },
    }),
    [auth, profile, ready, role],
  );
}

