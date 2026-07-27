import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/core/types";
import { BarkChannel } from "../src/integrations/bark";

describe("BarkChannel", () => {
  it("uses Bark V2 JSON fields and Basic Auth", async () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ code: 200, message: "success" }),
    );
    const channel = new BarkChannel(
      {
        BARK_BASE_URL: "https://bark.example.test/",
        BARK_DEVICE_KEY: "device-key",
        BARK_BASIC_AUTH_USER: "user",
        BARK_BASIC_AUTH_PASSWORD: "password",
        BARK_DEBUG: "true",
      } as Env,
      fetcher,
      logger,
    );
    const result = await channel.send({
      title: "服药提醒",
      body: "钙片 1 片",
      group: "health-medication",
      level: "timeSensitive",
    });

    expect(result.success).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://bark.example.test/push");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${btoa("user:password")}`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      device_key: "device-key",
      title: "服药提醒",
      level: "timeSensitive",
    });
    expect(logger.log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(logger.log.mock.calls[0]![0])).toMatchObject({
      event: "bark_push_started",
      endpoint: "https://bark.example.test/push",
      method: "POST",
      authConfigured: true,
      group: "health-medication",
      level: "timeSensitive",
    });
    expect(JSON.parse(logger.log.mock.calls[1]![0])).toMatchObject({
      event: "bark_push_succeeded",
      httpStatus: 200,
      providerCode: 200,
      providerMessage: "success",
    });
    expect(logger.log.mock.calls.flat().join(" ")).not.toContain("device-key");
    expect(logger.log.mock.calls.flat().join(" ")).not.toContain("钙片");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("matches bark-serverless auth and plain-text error behavior", async () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("I'm a teapot", { status: 418 }),
    );
    const channel = new BarkChannel(
      {
        BARK_BASE_URL: "https://bark.example.test",
        BARK_DEVICE_KEY: "device-key",
        BARK_BASIC_AUTH_USER: "user",
        BARK_BASIC_AUTH_PASSWORD: "",
      } as Env,
      fetcher,
      logger,
    );
    const result = await channel.send({
      title: "服药提醒",
      body: "钙片",
      group: "health-medication",
      level: "timeSensitive",
    });

    const [, init] = fetcher.mock.calls[0]!;
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${btoa("user:")}`);
    expect(result).toMatchObject({
      success: false,
      httpStatus: 418,
      providerMessage: "I'm a teapot",
      errorCode: "BARK_REJECTED_418",
    });
    expect(JSON.parse(logger.error.mock.calls[0]![0])).toMatchObject({
      event: "bark_push_failed",
      phase: "response",
      httpStatus: 418,
      providerMessage: "I'm a teapot",
      errorCode: "BARK_REJECTED_418",
    });
  });

  it("logs the underlying network error without exposing notification content", async () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connect ETIMEDOUT"));
    const channel = new BarkChannel(
      {
        BARK_BASE_URL: "https://bark.example.test",
        BARK_DEVICE_KEY: "secret-device-key",
        BARK_DEBUG: "false",
      } as Env,
      fetcher,
      logger,
    );

    const result = await channel.send({
      title: "私人提醒",
      body: "敏感健康信息",
      group: "health-test",
      level: "active",
    });

    expect(result.errorCode).toBe("BARK_NETWORK_ERROR");
    const failureLog = logger.error.mock.calls[0]![0];
    expect(JSON.parse(failureLog)).toMatchObject({
      event: "bark_push_failed",
      phase: "network",
      endpoint: "https://bark.example.test/push",
      errorCode: "BARK_NETWORK_ERROR",
      errorName: "TypeError",
      errorMessage: "connect ETIMEDOUT",
    });
    expect(failureLog).not.toContain("secret-device-key");
    expect(failureLog).not.toContain("私人提醒");
    expect(failureLog).not.toContain("敏感健康信息");
    expect(logger.log).not.toHaveBeenCalled();
  });
});
