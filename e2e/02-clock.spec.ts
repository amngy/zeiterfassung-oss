import { expect, test } from "@playwright/test";
import { STATE } from "./helpers";

test.use({ storageState: STATE.employee });

test("clock in, take a break, clock out", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Einstempeln" }).click();
  await page.getByRole("button", { name: "Pause starten" }).click();
  await expect(page.getByText("In Pause")).toBeVisible();
  await page.getByRole("button", { name: "Pause beenden" }).click();
  await page.getByRole("button", { name: "Ausstempeln" }).click();
  await expect(page.getByRole("button", { name: "Einstempeln" })).toBeVisible();

  // Survives a reload: the punches are stored, not just shown.
  await page.reload();
  await expect(page.getByRole("button", { name: "Einstempeln" })).toBeVisible();
});
