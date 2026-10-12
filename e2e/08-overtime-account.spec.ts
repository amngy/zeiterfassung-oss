import { expect, test, type Page } from "@playwright/test";
import { berlinDay, EMPLOYEE, STATE } from "./helpers";

test.use({ storageState: STATE.admin });

/** "+12:30 h" / "−3:15 h" / "±0:00 h" → signed minutes. */
async function balance(page: Page): Promise<number> {
  const text = (await page.locator("p:text-is('Stand heute') + p").first().textContent())!.trim();
  const m = /^([+−±])(\d+):(\d{2})/.exec(text);
  if (!m) throw new Error(`unexpected balance ${text}`);
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "−" ? -minutes : minutes;
}

test("admin keeps an overtime account: opening balance, payout, reversal, export", async ({ page, browser }, testInfo) => {
  await page.goto("/admin/mitarbeitende");
  await page.getByRole("link", { name: EMPLOYEE.name }).first().click();
  await expect(page).toHaveURL(/\/admin\/mitarbeitende\/[^/?]+$/);
  const userId = new URL(page.url()).pathname.split("/").pop()!;

  // Start this month with ten hours carried over.
  await page.getByLabel("Anfangssaldo (Stunden)").fill("10:00");
  await page.locator("#ot-start-note").fill("Übertrag aus Stundenzettel");
  await page.getByRole("button", { name: "Arbeitszeitkonto einrichten" }).click();
  await expect(page.getByRole("cell", { name: "Anfangssaldo" })).toBeVisible();
  const opened = await balance(page);

  // A payout of four hours takes exactly that off.
  await page.getByLabel("Stunden", { exact: true }).fill("4:00");
  await page.locator("#ot-note").fill("Auszahlung mit der Abrechnung");
  await page.getByRole("button", { name: "Buchen" }).click();
  const payout = page.locator("tr", { hasText: "Auszahlung mit der Abrechnung" });
  await expect(payout).toContainText("−4:00 h");
  await expect.poll(() => balance(page)).toBe(opened - 240);

  // Reversed by a counter booking; the original stays, marked.
  await payout.getByText("Stornieren").click();
  await payout.getByPlaceholder("Grund").fill("Doppelt gebucht");
  await payout.getByRole("button", { name: "Storno buchen" }).click();
  await expect(page.locator("tr", { hasText: "Doppelt gebucht" })).toContainText("Storno: Auszahlung");
  await expect(page.locator("tr", { hasText: "Auszahlung mit der Abrechnung" })).toContainText("storniert");
  await expect.poll(() => balance(page)).toBe(opened);

  // The monthly CSV carries the block.
  const month = berlinDay(new Date()).slice(0, 7);
  const csv = await (await page.request.get(`/api/admin/export/monat?user=${userId}&monat=${month}&format=csv`)).text();
  expect(csv).toContain("Arbeitszeitkonto;;Stunden");
  expect(csv).toContain("Anfangssaldo");
  expect(csv).toContain("Storno: Auszahlung");

  // Anna sees her own account.
  const anna = await browser.newContext({ storageState: STATE.employee, baseURL: testInfo.project.use.baseURL });
  const own = await anna.newPage();
  await own.goto("/zeiten");
  await expect(own.getByText("Arbeitszeitkonto", { exact: true })).toBeVisible();
  expect(await balance(own)).toBe(opened);
  await anna.close();
});
