import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_API_TOKEN: "test-admin-token-at-least-16",
          SESSION_SECRET: "test-session-secret-at-least-32-characters",
          BARK_DEVICE_KEY: "test-device-key",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
