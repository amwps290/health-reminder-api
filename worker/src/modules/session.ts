import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createSession, secureEqual, SESSION_COOKIE } from "../core/auth";
import { AppError } from "../core/errors";
import { parseJson } from "../core/http";
import type { AppContext } from "../core/types";

const loginInput = z.object({
  token: z.string().min(16).max(512),
});

export const publicSessionRoutes = new Hono<AppContext>();
export const protectedSessionRoutes = new Hono<AppContext>();

publicSessionRoutes.post("/login", async (context) => {
  const input = await parseJson(context, loginInput);
  const expected = context.env.ADMIN_API_TOKEN;
  if (!expected || !(await secureEqual(input.token, expected))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "管理令牌不正确");
  }

  const session = await createSession(context.env.SESSION_SECRET);
  setCookie(context, SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return context.json({ data: { authenticated: true } });
});

protectedSessionRoutes.get("/session", (context) =>
  context.json({ data: { authenticated: true } }),
);

protectedSessionRoutes.post("/logout", (context) => {
  deleteCookie(context, SESSION_COOKIE, { path: "/", secure: true });
  return context.json({ data: { authenticated: false } });
});
