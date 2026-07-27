declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ADMIN_API_TOKEN: string;
    SESSION_SECRET: string;
    BARK_DEVICE_KEY: string;
    APP_TIME_ZONE: string;
    BARK_BASE_URL: string;
    BARK_DEBUG: string;
    JOB_HORIZON_DAYS: string;
    MAX_DELIVERY_ATTEMPTS: string;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  }
}
