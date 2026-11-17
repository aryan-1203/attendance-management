import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { client, setSessionExpiredHandler, tokens, unwrap } from "@/lib/api";
import type { Me, Role } from "@/lib/types";

interface AuthCtx {
  user: Me | null;
  role: Role | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: (reason?: string) => void;
  can: (...roles: Role[]) => boolean;
  expiredReason: string | null;
}

const Ctx = React.createContext<AuthCtx | null>(null);
const IDLE_EVENTS = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"] as const;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [hasToken, setHasToken] = React.useState(() => !!tokens.access);
  const [expiredReason, setExpired] = React.useState<string | null>(null);
  const me = useQuery({
    queryKey: ["me"],
    enabled: hasToken,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => unwrap(client.GET("/api/auth/me")),
  });

  const logout = React.useCallback((reason?: string) => {
    tokens.clear();
    setHasToken(false);
    setExpired(reason ?? null);
    qc.clear();
  }, [qc]);

  React.useEffect(() => setSessionExpiredHandler(() => logout("Your session expired. Please sign in again.")), [logout]);

  // inactivity timeout: sign out after the server-configured session length with no interaction
  React.useEffect(() => {
    if (!me.data) return;
    const ms = (me.data.session_minutes ?? 60) * 60_000;
    let timer = window.setTimeout(() => logout("You were signed out after a period of inactivity."), ms);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => logout("You were signed out after a period of inactivity."), ms);
    };
    IDLE_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [me.data, logout]);

  const login = React.useCallback(async (email: string, password: string) => {
    const t = await unwrap(client.POST("/api/auth/login", { body: { email, password } }));
    tokens.set(t.access_token, t.refresh_token);
    setExpired(null);
    setHasToken(true);
    const user = await qc.fetchQuery({ queryKey: ["me"], queryFn: () => unwrap(client.GET("/api/auth/me")) });
    return user;
  }, [qc]);

  const user = hasToken ? me.data ?? null : null;
  const role = (user?.role_name as Role) ?? null;
  const value: AuthCtx = {
    user, role, loading: hasToken && me.isLoading, login, logout, expiredReason,
    can: (...roles) => !!role && roles.includes(role),
  };
  React.useEffect(() => {
    if (me.isError) logout("Please sign in again.");
  }, [me.isError, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export const ROLE_LABEL: Record<Role, string> = {
  hr_admin: "HR Admin", manager: "Manager", employee: "Employee", accounts: "Accounts",
};
