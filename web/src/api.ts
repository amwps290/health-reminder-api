import { todayInBusinessTimeZone } from "./utils";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch (error) {
    const message = navigator.onLine ? "无法连接到服务器，请稍后重试" : "当前网络不可用，请恢复连接后重试";
    throw new ApiError(0, "NETWORK_ERROR", message);
  }
  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null) as
    | { data?: T; error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code || "REQUEST_FAILED",
      payload?.error?.message || `请求失败（${response.status}）`,
    );
  }
  if (!payload || !("data" in payload)) {
    throw new ApiError(response.status, "INVALID_RESPONSE", "服务器返回格式不正确");
  }
  return payload?.data as T;
}

export function jsonBody(value: unknown): Pick<RequestInit, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  };
}

export async function downloadApiFile(path: string): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { credentials: "same-origin" });
  } catch {
    const message = navigator.onLine ? "无法连接到服务器，请稍后重试" : "当前网络不可用，请恢复连接后重试";
    throw new ApiError(0, "NETWORK_ERROR", message);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      response.status,
      payload?.error?.code || "DOWNLOAD_FAILED",
      payload?.error?.message || `下载失败（${response.status}）`,
    );
  }

  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
    || `health-reminder-backup-${todayInBusinessTimeZone()}.json`;
  return { blob: await response.blob(), filename };
}
