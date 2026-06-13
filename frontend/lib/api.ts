const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

// Tutte le chiamate al backend usano il cookie di sessione (koa-session).
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_URL + path, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("unauthorized");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "request_failed" }));
    throw new Error(body.error ?? "request_failed");
  }
  return response.status === 204 ? (null as T) : response.json();
}

export const usdFromMicros = (micros: number, digits = 2) =>
  `$${(micros / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
