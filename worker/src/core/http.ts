import type { Context } from "hono";
import type { ZodType } from "zod";
import { AppError } from "./errors";
import type { AppContext } from "./types";

export async function parseJson<T>(context: Context<AppContext>, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "请求正文必须是有效的 JSON");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "请求参数不正确", result.error.flatten());
  }
  return result.data;
}

export function getPaginationLimit(raw: string | undefined, fallback = 50): number {
  const value = Number.parseInt(raw || "", 10);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, 1), 100);
}
