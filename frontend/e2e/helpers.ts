import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Demo@1234";

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
}

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Next working day (Mon–Sat) on/after today + offset. */
export function workingDay(offset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
}
