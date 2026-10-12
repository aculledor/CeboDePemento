import type { ApiError } from "@cebo/shared";
import { setReachable, isReachable } from "./connectivity";
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function newOperationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (response.status >= 500) setReachable(false);
      const body = (await response
        .json()
        .catch(() => ({ code: "SERVER_ERROR" }))) as ApiError;
      if (
        body.code === "AUTH_REQUIRED" &&
        path !== "/auth/me" &&
        typeof window !== "undefined"
      )
        window.dispatchEvent(new Event("cebo-auth-expired"));
      throw new ApiFailure(response.status, body.code);
    }
    const body = (await response.json()) as T;
    if (path === "/health") setReachable(true);
    return body;
  } catch (error) {
    if (!(error instanceof ApiFailure)) setReachable(false);
    throw error;
  }
}
export async function write<T>(
  path: string,
  body: unknown,
  key?: string,
  method = "POST",
): Promise<T> {
  if (!isReachable()) throw new ApiFailure(503, "SERVER_UNAVAILABLE");
  const { token } = await api<{ token: string }>("/auth/csrf");
  return api<T>(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": token,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}
