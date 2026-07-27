import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { AppError } from "./errors";
import type { AppContext } from "./types";

export const requireAdmin: MiddlewareHandler<AppContext> = async (context, next) => {
  const expected = context.env.ADMIN_API_TOKEN;
  if (!expected) {
    throw new AppError(503, "ADMIN_TOKEN_NOT_CONFIGURED", "服务端尚未配置管理令牌");
  }

  const header = context.req.header("Authorization") || "";
  const actual = header.startsWith("Bearer ") ? header.slice(7) : "";
  const bearerValid = actual ? await secureEqual(actual, expected) : false;
  const session = getCookie(context, SESSION_COOKIE);
  const sessionValid = bearerValid ? false : await verifySession(session, context.env.SESSION_SECRET);
  if (!bearerValid && !sessionValid) {
    throw new AppError(401, "UNAUTHORIZED", "登录状态或管理令牌无效");
  }

  if (sessionValid && !isSafeMethod(context.req.method)) {
    const origin = context.req.header("Origin");
    if (origin && origin !== new URL(context.req.url).origin) {
      throw new AppError(403, "INVALID_ORIGIN", "请求来源无效");
    }
  }
  await next();
};

export const SESSION_COOKIE = "hr_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function createSession(secret: string | undefined, now = new Date()): Promise<string> {
  if (!secret) {
    throw new AppError(503, "SESSION_SECRET_NOT_CONFIGURED", "服务端尚未配置会话签名密钥");
  }
  const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${expiresAt}.${crypto.randomUUID()}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySession(
  value: string | undefined,
  secret: string | undefined,
  now = new Date(),
): Promise<boolean> {
  if (!value || !secret) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [expiresAtRaw, nonce, signature] = parts;
  const expiresAt = Number.parseInt(expiresAtRaw!, 10);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(now.getTime() / 1000)) return false;
  const payload = `${expiresAtRaw}.${nonce}`;
  return secureEqual(signature!, await sign(payload, secret));
}

export async function secureEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

async function sign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
