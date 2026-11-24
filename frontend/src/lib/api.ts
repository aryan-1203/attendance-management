import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@/api/schema";

// VITE_API_URL: the backend's public URL when it is hosted separately (e.g. Vercel + Render); else same origin
const BASE = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : ""))
  .replace(/\/+$/, "");
const ACCESS = "ae-access";
const REFRESH = "ae-refresh";

export const tokens = {
  get access() { return localStorage.getItem(ACCESS); },
  get refresh() { return localStorage.getItem(REFRESH); },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access);
    localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const FRIENDLY: Record<number, string> = {
  0: "Can't reach the server. Check your connection and try again.",
  500: "Something went wrong on our side. Please try again.",
  502: "The server is restarting. Try again in a moment.",
  503: "The server is busy. Try again in a moment.",
};

let refreshing: Promise<boolean> | null = null;
export let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

async function tryRefresh(): Promise<boolean> {
  const rt = tokens.refresh;
  if (!rt) return false;
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const j = await r.json();
      tokens.set(j.access_token, j.refresh_token);
      return true;
    })
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

const auth: Middleware = {
  async onRequest({ request }) {
    const t = tokens.access;
    if (t) request.headers.set("Authorization", `Bearer ${t}`);
    return request;
  },
};

/** fetch wrapper: transparently refreshes the access token once on 401. */
async function authedFetch(input: Request): Promise<Response> {
  const retry = input.clone();
  const res = await fetch(input);
  if (res.status !== 401 || input.url.includes("/auth/")) return res;
  if (await tryRefresh()) {
    retry.headers.set("Authorization", `Bearer ${tokens.access}`);
    return fetch(retry);
  }
  tokens.clear();
  onSessionExpired();
  return res;
}

export const client = createClient<paths>({ baseUrl: BASE, fetch: authedFetch });
client.use(auth);

export async function toApiError(res: Response | undefined, body: unknown): Promise<ApiError> {
  const status = res?.status ?? 0;
  const err = (body as { error?: { code: string; message: string; details?: unknown } })?.error;
  if (err) return new ApiError(status, err.code, err.message, err.details);
  return new ApiError(status, "http_error", FRIENDLY[status] ?? `Request failed (${status})`);
}

/** Unwrap an openapi-fetch result, throwing a friendly ApiError. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let r;
  try {
    r = await p;
  } catch {
    throw new ApiError(0, "network", FRIENDLY[0]);
  }
  if (r.error !== undefined || !r.response.ok) throw await toApiError(r.response, r.error);
  return r.data as T;
}

/** Authenticated binary download (reports, templates). */
export async function download(path: string, params?: Record<string, string | number | undefined>): Promise<{
  blob: Blob; filename: string;
}> {
  const qs = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
  const req = new Request(`${BASE}${path}${qs.toString() ? `?${qs}` : ""}`, {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  const res = await authedFetch(req);
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { /* binary */ }
    throw await toApiError(res, body);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? "download";
  return { blob: await res.blob(), filename };
}

/** Authenticated JSON POST for endpoints not yet in the generated OpenAPI client. */
export async function jsonPost<T>(path: string, body?: unknown): Promise<T> {
  const req = new Request(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await authedFetch(req);
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw await toApiError(res, data);
  return data as T;
}

/** Multipart upload (openapi-fetch's typing of UploadFile is awkward). */
export async function upload<T>(path: string, file: File, params?: Record<string, string | boolean>): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  const qs = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
  const req = new Request(`${BASE}${path}${qs}`, {
    method: "POST",
    body: fd,
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  const res = await authedFetch(req);
  const body = await res.json().catch(() => undefined);
  if (!res.ok) throw await toApiError(res, body);
  return body as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
