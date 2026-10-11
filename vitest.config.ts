import { defineConfig } from "vitest/config";
import path from "node:path";

// The time-calculation logic is the part that must be correct, so it has a
// dedicated unit-test suite that runs without a database or a browser.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
});
