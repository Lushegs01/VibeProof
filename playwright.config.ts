import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a DEMO-MODE build (deterministic fixtures, no chain/DB needed):
 *   npm run test:e2e:build && npm run test:e2e
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure", launchOptions: { executablePath } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_DEMO_MODE: "true", NEXT_DIST_DIR: ".next-e2e", DATABASE_URL: "", REDIS_URL: "" },
  },
});
