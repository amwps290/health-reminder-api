export interface Env {
  DB: D1Database;
  ADMIN_API_TOKEN?: string;
  SESSION_SECRET?: string;
  APP_TIME_ZONE?: string;
  BARK_BASE_URL?: string;
  BARK_DEVICE_KEY?: string;
  BARK_BASIC_AUTH_USER?: string;
  BARK_BASIC_AUTH_PASSWORD?: string;
  BARK_DEBUG?: string;
  JOB_HORIZON_DAYS?: string;
  MAX_DELIVERY_ATTEMPTS?: string;
  SCHEDULER_RUN_RETENTION_DAYS?: string;
  NOTIFICATION_HISTORY_RETENTION_DAYS?: string;
}

export interface AppVariables {
  requestId: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: AppVariables;
};

export const DEFAULT_PROFILE_ID = "default";
export const DEFAULT_TARGET_ID = "default-bark";

export interface AppConfig {
  timeZone: string;
  barkBaseUrl: string;
  horizonDays: number;
  maxDeliveryAttempts: number;
  schedulerRunRetentionDays: number;
  notificationHistoryRetentionDays: number;
}

export function getConfig(env: Env): AppConfig {
  return {
    timeZone: env.APP_TIME_ZONE || "Asia/Shanghai",
    barkBaseUrl: (env.BARK_BASE_URL || "https://bark.191315.xyz").replace(/\/+$/, ""),
    horizonDays: parseInteger(env.JOB_HORIZON_DAYS, 30, 1, 90),
    maxDeliveryAttempts: parseInteger(env.MAX_DELIVERY_ATTEMPTS, 4, 1, 10),
    schedulerRunRetentionDays: parseInteger(env.SCHEDULER_RUN_RETENTION_DAYS, 30, 7, 365),
    notificationHistoryRetentionDays: parseInteger(
      env.NOTIFICATION_HISTORY_RETENTION_DAYS,
      365,
      30,
      3650,
    ),
  };
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
