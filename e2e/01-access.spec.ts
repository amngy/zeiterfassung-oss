import { expect, test } from "@playwright/test";
import { STATE } from "./helpers";

test.describe("signed out", () => {
  test("app pages lead to the sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("admin exports are closed", async ({ request }) => {
    const res = await request.get("/api/admin/export/roh?monat=2026-01", { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
    expect(res.headers()["content-type"] ?? "").not.toContain("text/csv");
  });
});

test.describe("as an employee", () => {
  test.use({ storageState: STATE.employee });

  test("admin pages send you back to the dashboard", async ({ page }) => {
    await page.goto("/admin/zeiten");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("admin exports are closed", async ({ page }) => {
    const res = await page.request.get("/api/admin/export/roh?monat=2026-01", { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
    expect(res.headers()["content-type"] ?? "").not.toContain("text/csv");
  });
});
