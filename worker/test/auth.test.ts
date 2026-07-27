import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import type { Env } from "../src/core/types";

describe("authentication", () => {
  it("protects API routes", async () => {
    const response = await app.request("http://local.test/api/v1/system/status", {}, env as Env);
    expect(response.status).toBe(401);
  });

  it("accepts a Bearer token", async () => {
    const response = await app.request(
      "http://local.test/api/v1/system/status",
      { headers: { Authorization: `Bearer ${env.ADMIN_API_TOKEN}` } },
      env as Env,
    );
    expect(response.status).toBe(200);
  });

  it("exchanges the admin token for an HttpOnly session", async () => {
    const login = await app.request(
      "https://local.test/api/v1/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: env.ADMIN_API_TOKEN }),
      },
      env as Env,
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("hr_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const session = await app.request(
      "https://local.test/api/v1/auth/session",
      { headers: { Cookie: cookie.split(";")[0]! } },
      env as Env,
    );
    expect(session.status).toBe(200);
  });
});
