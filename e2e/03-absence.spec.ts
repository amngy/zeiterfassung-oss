import { expect, test } from "@playwright/test";
import { EMPLOYEE, STATE, futureLeave, germanDay } from "./helpers";

test("employee requests leave, admin approves it", async ({ browser }) => {
  const { from, to } = futureLeave();
  const note = `E2E-Urlaub ${from}`;

  const employee = await (await browser.newContext({ storageState: STATE.employee })).newPage();
  await employee.goto("/abwesenheit");
  await employee.getByRole("button", { name: "Urlaub & Abwesenheit beantragen öffnen" }).click();
  await employee.locator("#v-type").selectOption({ label: "Urlaub" });
  await employee.locator("#v-start").fill(from);
  await employee.locator("#v-end").fill(to);
  await employee.locator("#v-note").fill(note);
  await employee.getByRole("button", { name: "Antrag einreichen" }).click();
  await expect(employee.getByText("Antrag (Urlaub) eingereicht.")).toBeVisible();

  const admin = await (await browser.newContext({ storageState: STATE.admin })).newPage();
  await admin.goto("/admin/abwesenheiten");
  const approve = admin.getByRole("button", { name: "Genehmigen" });
  const request = admin.locator("li", { hasText: note }).filter({ has: approve });
  await expect(request).toContainText(`${EMPLOYEE.name} · Urlaub`);
  await expect(request).toContainText(`${germanDay(from)} – ${germanDay(to)}`);
  await request.getByRole("button", { name: "Genehmigen" }).click();
  await expect(request).toHaveCount(0);

  await employee.reload();
  const row = employee.locator("li", { hasText: `${germanDay(from)} – ${germanDay(to)}` }).first();
  await expect(row).toContainText("genehmigt");
});
