import type { ApiErrorBody, Contact } from "@shared/types";

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  matches: Contact[];

  constructor(status: number, body: ApiErrorBody["error"] | undefined) {
    super(body?.message || "Something went wrong. Try again.");
    this.status = status;
    this.code = body?.code || "CRM_UNAVAILABLE";
    this.fields = body?.fields ?? {};
    this.matches = body?.matches ?? [];
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "evoq");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, {
      code: "CRM_UNAVAILABLE",
      message: "The network request failed. Check your connection and try again.",
    });
  }

  const payload = (await response.json().catch(() => null)) as ApiErrorBody | T | null;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
    throw new ApiError(response.status, error);
  }
  return payload as T;
}
