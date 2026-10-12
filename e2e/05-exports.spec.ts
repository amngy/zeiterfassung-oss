import { expect, test } from "@playwright/test";
import { EMPLOYEE, STATE, lastMonthWeek, userIdFor } from "./helpers";

test.use({ storageState: STATE.admin });

// Runs after 04-correction, whose entries it finds in last month's files.
test("monthly, raw and GDPR exports for one person", async ({ page }) => {
  const { month } = lastMonthWeek();
  await page.goto("/admin/zeiten");
  const id = await userIdFor(page, "admin-zeiten-user", EMPLOYEE.name);

  const csv = await page.request.get(`/api/admin/export/monat?user=${id}&monat=${month}&format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain(EMPLOYEE.name);

  const pdf = await page.request.get(`/api/admin/export/monat?user=${id}&monat=${month}&format=pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  const raw = await (await page.request.get(`/api/admin/export/roh?user=${id}&monat=${month}`)).text();
  const withVersions = await (
    await page.request.get(`/api/admin/export/roh?user=${id}&monat=${month}&versionen=1`)
  ).text();
  expect(raw).toContain("manuell");
  expect(raw).not.toContain(";ersetzt;");
  expect(withVersions).toContain(";ersetzt;");

  const gdpr = await page.request.get(`/api/admin/export/dsgvo?user=${id}`);
  expect(gdpr.status()).toBe(200);
  expect(await gdpr.text()).toContain(EMPLOYEE.email);
});
