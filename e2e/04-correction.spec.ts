import { expect, test } from "@playwright/test";
import { EMPLOYEE, STATE, lastMonthWeek, userIdFor } from "./helpers";

test.use({ storageState: STATE.admin });

test("admin back-fills a week, corrects a day, and the old version stays visible", async ({ page }) => {
  const { from, to, month } = lastMonthWeek();

  await page.goto("/admin/nachtragen");
  await page.locator("#b-user").selectOption({ label: EMPLOYEE.name });
  await page.locator("#b-from").fill(from);
  await page.locator("#b-to").fill(to);
  await page.locator("#b-start").fill("08:00");
  await page.locator("#b-end").fill("16:00");
  await page.getByRole("button", { name: "Vorschau berechnen" }).click();
  await page.locator("#b-reason").fill("E2E: Stempeluhr defekt");
  await page.getByRole("button", { name: /Tag\(e\) verbindlich nachtragen/ }).click();
  await expect(page.getByText(/\d+ Tag\(e\) nachgetragen/)).toBeVisible();

  const userId = await userIdFor(page, "b-user", EMPLOYEE.name);
  await page.goto(`/admin/zeiten?user=${userId}&monat=${month}`);
  const entry = page.locator("li", { hasText: "08:00 – 16:00" }).filter({ hasText: "Arbeit" }).first();
  await entry.getByRole("button", { name: "Ändern" }).click();
  const end = entry.getByLabel("Ende");
  await end.fill((await end.inputValue()).replace("T16:00", "T15:30"));
  await entry.getByLabel("Grund der Änderung").fill("E2E: früher gegangen");
  await entry.getByRole("button", { name: "Verbindlich ändern" }).click();
  await expect(page.getByText("Zeit geändert.")).toBeVisible();

  const corrected = page.locator("li", { hasText: "08:00 – 15:30" }).first();
  await corrected.getByText("Verlauf: 1 frühere Version").click();
  await expect(corrected).toContainText("08:00–16:00");
  await expect(corrected).toContainText("Grund: E2E: früher gegangen");
});
