import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running production build and a real, seeded
// PostgreSQL (#27). They change data, so run them against a fresh database:
//   npx prisma migrate deploy && SEED_DEMO=true npm run db:seed
//   npm run build && npm run test:e2e
// See README → Testing.

const PORT = Number(process.env.E2E_PORT ?? 3123);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  // One shared database: run files one after another, in name order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
