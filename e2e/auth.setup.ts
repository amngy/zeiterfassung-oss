import { expect, test as setup } from "@playwright/test";
import { totpCode, totpStep } from "../src/lib/totp";
import { ADMIN, EMPLOYEE, STATE, saveAdminSecret, signIn } from "./helpers";

setup("employee signs in", async ({ page }) => {
  await signIn(page, EMPLOYEE);
  await expect(page.getByRole("button", { name: /Einstempeln|Ausstempeln|Pause beenden/ })).toBeVisible();
  await page.context().storageState({ path: STATE.employee });
});

setup("admin sets up the second factor", async ({ page }) => {
  // Without a second factor the password is enough, but the account acts as
  // an employee account and is sent to the setup page.
  await signIn(page, ADMIN);
  await page.goto("/admin/zeiten");
  await expect(page).toHaveURL(/\/konto\/zwei-faktor/);

  await page.getByRole("button", { name: "Einrichtung starten" }).click();
  const secret = (await page.locator("p.break-all.font-mono").textContent())!.replace(/\s+/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await page.getByLabel("Code aus der App").fill(totpCode(secret, totpStep(new Date())));
  await page.getByRole("button", { name: "Bestätigen und einschalten" }).click();
  await expect(page.getByRole("button", { name: "Ich habe die Codes gesichert" })).toBeVisible();
  saveAdminSecret(secret);

  // The same session is now a full admin session.
  await page.goto("/admin/zeiten");
  await expect(page.getByRole("heading", { name: "Alle Zeiten" })).toBeVisible();
  await page.context().storageState({ path: STATE.admin });
});
