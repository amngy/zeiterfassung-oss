import { expect, test } from "@playwright/test";
import { EMPLOYEE, STATE } from "./helpers";

test.use({ storageState: STATE.admin });

test("staff without a phone punch at the terminal with a PIN", async ({ page, browser }, testInfo) => {
  // Admin: a terminal with PIN punching switched on, and a PIN for Anna.
  const label = `PIN-Terminal ${Date.now()}`;
  await page.goto("/admin/terminals");
  await page.getByLabel("Bezeichnung").fill(label);
  await page.getByRole("button", { name: "Terminal anlegen" }).click();
  const pairUrl = new URL((await page.locator("code", { hasText: "/terminal/einrichten" }).textContent())!);

  const row = page.locator("li", { hasText: label });
  await row.getByRole("button", { name: "Einschalten" }).click();
  await expect(row.getByRole("button", { name: "Ausschalten" })).toBeVisible();

  await page.goto("/admin/mitarbeitende");
  await page.getByRole("link", { name: EMPLOYEE.name }).first().click();
  await page.getByRole("button", { name: /PIN erzeugen/ }).click();
  const pin = (await page.getByRole("status").locator("strong").textContent())!.trim();
  expect(pin).toMatch(/^\d{6}$/);

  // The tablet: paired without anyone signed in.
  const kiosk = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const tablet = await kiosk.newPage();
  await tablet.goto(pairUrl.pathname + pairUrl.search);
  await tablet.getByRole("button", { name: "Dieses Gerät als Terminal einrichten" }).click();
  await expect(tablet).toHaveURL(/\/terminal$/);

  const punch = async (pinValue: string, action: "Einstempeln" | "Ausstempeln") => {
    await tablet.getByRole("button", { name: "Ohne Handy stempeln (PIN)" }).click();
    await tablet.getByRole("button", { name: EMPLOYEE.name }).click();
    await tablet.locator("#kiosk-pin").fill(pinValue);
    await tablet.getByRole("button", { name: action }).click();
  };

  // 000000 is never issued (trivial), so it is always wrong.
  await punch("000000", "Einstempeln");
  await expect(tablet.getByRole("alert").filter({ hasText: "Name oder PIN stimmt nicht." })).toBeVisible();
  await expect(tablet.locator("#kiosk-pin")).toHaveValue("");
  await tablet.getByRole("button", { name: "Abbrechen" }).click();

  await punch(pin, "Einstempeln");
  await expect(tablet.getByRole("status")).toContainText(`${EMPLOYEE.name}: eingestempelt um`);
  await tablet.getByRole("button", { name: "Fertig" }).click();

  await punch(pin, "Ausstempeln");
  await expect(tablet.getByRole("status")).toContainText(`${EMPLOYEE.name}: ausgestempelt um`);
  await kiosk.close();

  await page.goto("/admin/terminals");
  await expect(page.locator("li", { hasText: label })).toContainText("2 Stempelungen");
});
