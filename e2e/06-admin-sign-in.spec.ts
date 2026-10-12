import { expect, test } from "@playwright/test";
import { ADMIN, EMPLOYEE, nextAdminCode } from "./helpers";

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(EMPLOYEE.email);
  await page.locator("#password").fill("not-the-password");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("E-Mail-Adresse oder Passwort ist falsch.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("an admin needs the code from the app", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(ADMIN.email);
  await page.locator("#password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Anmelden" }).click();

  const code = page.locator("#code");
  await code.fill("000000");
  await page.getByRole("button", { name: "Code bestätigen" }).click();
  await expect(page.getByText("Der Code stimmt nicht.")).toBeVisible();

  await code.fill(nextAdminCode());
  await page.getByRole("button", { name: "Code bestätigen" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/admin/zeiten");
  await expect(page.getByRole("heading", { name: "Alle Zeiten" })).toBeVisible();
});
