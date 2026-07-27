import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  webServer: {
    command: "node_modules\\.bin\\wrangler.cmd dev --port 8787",
    cwd: "../worker",
    url: "http://127.0.0.1:8787/healthz",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      args: ["--disable-gpu", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
});
