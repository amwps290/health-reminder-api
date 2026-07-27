import { AppError } from "../core/errors";
import type { Env } from "../core/types";
import { getConfig } from "../core/types";

export interface BarkMessage {
  title: string;
  body: string;
  group: string;
  level: "critical" | "active" | "timeSensitive" | "passive";
  sound?: string;
  icon?: string;
}

export interface BarkResult {
  success: boolean;
  httpStatus: number | null;
  providerCode: number | null;
  providerMessage: string | null;
  errorCode: string | null;
}

export interface NotificationChannel {
  send(message: BarkMessage): Promise<BarkResult>;
}

type BarkLogger = Pick<Console, "log" | "error">;
type BarkFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface BarkStyle {
  sound: string;
  iconFile: string;
}

const BARK_STYLES: Readonly<Record<string, BarkStyle>> = {
  "health-medication": { sound: "healthnotification", iconFile: "medication.png" },
  "health-injection": { sound: "bell", iconFile: "injection.png" },
  "health-event-registration": { sound: "calypso", iconFile: "registration.png" },
  "health-event-checkup": { sound: "chime", iconFile: "checkup.png" },
  "health-event-follow_up": { sound: "minuet", iconFile: "follow-up.png" },
  "health-event-other": { sound: "glass", iconFile: "event.png" },
  "health-event": { sound: "glass", iconFile: "event.png" },
  "health-test": { sound: "electronic", iconFile: "test.png" },
};

// Workers fetch must be invoked through the global binding. Storing it directly on
// a class and calling it as a method gives it the class instance as `this`.
const defaultBarkFetcher: BarkFetcher = (input, init) => fetch(input, init);

export async function sendBarkTest(env: Env, message: BarkMessage): Promise<BarkResult> {
  const result = await new BarkChannel(env).send(message);
  if (!result.success) {
    const networkFailure = result.errorCode === "BARK_NETWORK_ERROR";
    const message = networkFailure
      ? "无法连接 Bark 服务，请检查网络或代理配置"
      : result.providerMessage
        ? `Bark 推送失败：${result.providerMessage}`
        : "Bark 拒绝了测试通知";
    throw new AppError(
      502,
      result.errorCode || "BARK_TEST_FAILED",
      message,
    );
  }
  const acceptedAt = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO maintenance_state (key, value, updated_at)
       VALUES ('last_bark_test_success_at', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .bind(acceptedAt, acceptedAt)
    .run();
  return result;
}

export class BarkChannel implements NotificationChannel {
  constructor(
    private readonly env: Env,
    private readonly fetcher: BarkFetcher = defaultBarkFetcher,
    private readonly logger: BarkLogger = console,
  ) {}

  async send(message: BarkMessage): Promise<BarkResult> {
    const deviceKey = this.env.BARK_DEVICE_KEY;
    if (!deviceKey) {
      this.logFailure({ phase: "configuration", errorCode: "BARK_DEVICE_NOT_CONFIGURED" });
      throw new AppError(503, "BARK_DEVICE_NOT_CONFIGURED", "服务端尚未配置 Bark device key");
    }

    const config = getConfig(this.env);
    const endpoint = `${config.barkBaseUrl}/push`;
    const style = BARK_STYLES[message.group];
    const sound = message.sound ?? style?.sound;
    const icon = message.icon ?? buildIconUrl(this.env.BARK_ICON_BASE_URL, style?.iconFile);
    const pushId = crypto.randomUUID();
    const startedAt = Date.now();
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
    const username = this.env.BARK_BASIC_AUTH_USER;
    const password = this.env.BARK_BASIC_AUTH_PASSWORD;
    if (username || password) {
      headers.set("Authorization", `Basic ${btoa(`${username || ""}:${password || ""}`)}`);
    }

    const requestLog = {
      pushId,
      endpoint,
      method: "POST",
      authConfigured: Boolean(username || password),
      group: message.group,
      level: message.level,
      sound,
      iconConfigured: Boolean(icon),
      titleLength: message.title.length,
      bodyLength: message.body.length,
    };
    if (isDebugEnabled(this.env.BARK_DEBUG)) {
      this.logger.log(JSON.stringify({ event: "bark_push_started", ...requestLog }));
    }

    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          device_key: deviceKey,
          title: message.title,
          body: message.body,
          group: message.group,
          level: message.level,
          sound,
          icon,
        }),
      });
    } catch (error) {
      this.logFailure({
        ...requestLog,
        phase: "network",
        durationMs: Date.now() - startedAt,
        errorCode: "BARK_NETWORK_ERROR",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: getErrorMessage(error),
      });
      return {
        success: false,
        httpStatus: null,
        providerCode: null,
        providerMessage: null,
        errorCode: "BARK_NETWORK_ERROR",
      };
    }

    let responseBody: Awaited<ReturnType<typeof readResponse>>;
    try {
      responseBody = await readResponse(response);
    } catch (error) {
      this.logFailure({
        ...requestLog,
        phase: "response_read",
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        responseCfRay: response.headers.get("CF-Ray"),
        errorCode: "BARK_RESPONSE_READ_ERROR",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: getErrorMessage(error),
      });
      return {
        success: false,
        httpStatus: response.status,
        providerCode: null,
        providerMessage: null,
        errorCode: "BARK_RESPONSE_READ_ERROR",
      };
    }

    const { payload, text } = responseBody;
    const providerCode = typeof payload?.code === "number" ? payload.code : null;
    const providerMessage = typeof payload?.message === "string"
      ? payload.message
      : text || null;
    const success = response.ok && (providerCode === null || providerCode === 200);
    const responseLog = {
      ...requestLog,
      phase: "response",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      responseContentType: response.headers.get("Content-Type"),
      responseCfRay: response.headers.get("CF-Ray"),
      providerCode,
      providerMessage: truncateForLog(providerMessage),
    };
    if (success) {
      if (isDebugEnabled(this.env.BARK_DEBUG)) {
        this.logger.log(JSON.stringify({ event: "bark_push_succeeded", ...responseLog }));
      }
    } else {
      this.logFailure({ ...responseLog, errorCode: `BARK_REJECTED_${response.status}` });
    }
    return {
      success,
      httpStatus: response.status,
      providerCode,
      providerMessage,
      errorCode: success ? null : `BARK_REJECTED_${response.status}`,
    };
  }

  private logFailure(details: Record<string, unknown>): void {
    this.logger.error(JSON.stringify({ event: "bark_push_failed", ...details }));
  }
}

function buildIconUrl(baseUrl: string | undefined, iconFile: string | undefined): string | undefined {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl || !iconFile) return undefined;
  return `${normalizedBaseUrl}/notification-icons/${iconFile}`;
}

function isDebugEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
}

function getErrorMessage(error: unknown): string {
  return truncateForLog(error instanceof Error ? error.message : String(error)) || "Unknown error";
}

function truncateForLog(value: string | null, maximumLength = 500): string | null {
  if (!value) return null;
  return value.length <= maximumLength ? value : `${value.slice(0, maximumLength)}...`;
}

async function readResponse(response: Response): Promise<{
  payload: Record<string, unknown> | null;
  text: string;
}> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as unknown;
    return {
      payload: body && typeof body === "object" ? (body as Record<string, unknown>) : null,
      text,
    };
  } catch {
    return { payload: null, text: text.trim() };
  }
}
