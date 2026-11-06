import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    // Setup applies the full additive migration chain and boots Anvil on cold CI workers.
    hookTimeout: 60_000,
    // Integration files share one test database; run files sequentially.
    fileParallelism: false,
  },
});
