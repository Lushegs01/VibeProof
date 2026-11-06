import { defineConfig, devices } from "@playwright/test";
import { APP_URL, APP_PORT, RPC_URL, EXPLORER_PORT, REGISTRY, FACTORY } from "./tests/wallet/settings";
const db = process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/vibeproof_test";
const testDb = new URL(db);
testDb.pathname = "/vibeproof_wallet_test";
process.env.WALLET_DATABASE_URL = testDb.href;
export default defineConfig({
  testDir: "tests/wallet",
  testMatch: "*.spec.ts",
  globalSetup: "./tests/wallet/setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
  },
  projects: [
    { name: "wallet-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "wallet-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next dev -p ${APP_PORT}`,
    url: `${APP_URL}/api/live`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: ".next-wallet",
      NEXT_PUBLIC_APP_URL: APP_URL,
      NEXT_PUBLIC_DEMO_MODE: "false",
      NEXT_PUBLIC_VIBEPROOF_NETWORK: "robinhood-testnet",
      NEXT_PUBLIC_REGISTRY_ADDRESS: REGISTRY,
      DATABASE_URL: testDb.href,
      POSTGRES_URL: "",
      REDIS_URL: process.env.REDIS_URL ?? "",
      SESSION_SECRET: "local-wallet-test-session-secret-only-not-production",
      ROBINHOOD_TESTNET_RPC_URL: RPC_URL,
      BLOCKSCOUT_TESTNET_API_URL: `http://127.0.0.1:${EXPLORER_PORT}/api`,
      VIBE_V6_FACTORY: FACTORY,
      VIBE_V6_START_BLOCK: "1",
      PROOF_CONFIRMATIONS: "2",
      EVIDENCE_STORAGE: "database",
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "",
    },
  },
});
