import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { totpCode, totpStep } from "../src/lib/totp";

export const EMPLOYEE = { email: "anna@firma.de", password: "Mitarbeiter!2026", name: "Anna Becker" };
export const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@firma.de",
  password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!2026",
};

const AUTH_DIR = path.join(__dirname, ".auth");
export const STATE = {
  employee: path.join(AUTH_DIR, "employee.json"),
  admin: path.join(AUTH_DIR, "admin.json"),
};
const SECRET_FILE = path.join(AUTH_DIR, "admin-totp.txt");

export function saveAdminSecret(secret: string): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret);
}

/**
 * A code the server has not seen yet: each code works once, so take the next
 * 30-second step (still inside the accepted window) rather than the current.
 */
export function nextAdminCode(): string {
  return totpCode(fs.readFileSync(SECRET_FILE, "utf8").trim(), totpStep(new Date()) + 1);
}

export async function signIn(page: Page, who: { email: string; password: string }, code?: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(who.email);
  await page.locator("#password").fill(who.password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  if (code) {
    await page.locator("#code").fill(code);
    await page.getByRole("button", { name: "Code bestätigen" }).click();
  }
  await expect(page).toHaveURL(/\/(dashboard|konto)/);
}

/** "YYYY-MM-DD" of a date in Europe/Berlin. */
export function berlinDay(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

/** The value of the <option> for `name` in a <select>, i.e. the user id. */
export async function userIdFor(page: Page, selectId: string, name: string): Promise<string> {
  const value = await page.locator(`#${selectId} option`, { hasText: name }).first().getAttribute("value");
  if (!value) throw new Error(`no option for ${name}`);
  return value;
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Monday to Friday of the second full week of last month (Berlin): far enough
 * back to be editable history, inside one month for the monthly views.
 */
export function lastMonthWeek(now = new Date()): { from: string; to: string; month: string } {
  const [y, m] = berlinDay(now).split("-").map(Number) as [number, number];
  const first = Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1);
  const dow = new Date(first).getUTCDay(); // 0 = Sunday
  const firstMonday = first + ((8 - dow) % 7) * DAY_MS;
  const monday = firstMonday + 7 * DAY_MS;
  return { from: isoDay(monday), to: isoDay(monday + 4 * DAY_MS), month: isoDay(monday).slice(0, 7) };
}

/** Tuesday and Wednesday about nine weeks ahead — clear of anything seeded. */
export function futureLeave(now = new Date()): { from: string; to: string } {
  const base = Date.parse(`${berlinDay(now)}T00:00:00Z`) + 63 * DAY_MS;
  const dow = new Date(base).getUTCDay();
  const tuesday = base + ((9 - dow) % 7) * DAY_MS;
  return { from: isoDay(tuesday), to: isoDay(tuesday + DAY_MS) };
}

/** "Di, 15.12.2026" — how the app prints a day. */
export function germanDay(key: string): string {
  const [y, m, d] = key.split("-");
  const dow = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(`${key}T00:00:00Z`).getUTCDay()];
  return `${dow}, ${d}.${m}.${y}`;
}
