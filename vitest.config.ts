// vitest.config.ts — Unit test runner for pure-function helpers.
// Doesn't touch DB, network, or Next.js — those need integration tests
// which we'll add separately when there's a CI hook.
//
// Run all tests:    npm test
// Watch mode:       npm run test:watch
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules", ".next", "scripts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
