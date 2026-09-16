import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.integration.test.ts", "**/.next/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts", "packages/**/*.integration.test.ts", "apps/**/*.integration.test.ts"],
          exclude: ["**/node_modules/**"],
          environment: "node",
          globalSetup: ["./tests/integration/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
    coverage: { provider: "v8", reporter: ["text", "lcov"], include: ["packages/**/src/**"] },
  },
});
