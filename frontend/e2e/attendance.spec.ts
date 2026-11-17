import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Critical flow 1: HR marks today's attendance (mark all present, then an exception via keyboard, then undo). */
test("HR marks attendance: mark all present, set an exception with the keyboard, undo", async ({ page }) => {
  await login(page, "hr@prosparity.demo");
  await page.getByRole("link", { name: "Attendance" }).first().click();
  await expect(page.getByRole("heading", { name: "Daily attendance" })).toBeVisible();
  const grid = page.getByRole("grid", { name: /Attendance for/ });
  await expect(grid).toBeVisible();

  const markAll = page.getByRole("button", { name: /Mark all present/ });
  if (await markAll.isEnabled()) {
    await markAll.click();
    await expect(page.getByText(/Marked \d+ employees? present|Everyone is already marked/)).toBeVisible();
  }

  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  const cell = grid.getByRole("gridcell", { name: new RegExp(`^Rohan Gupta, ${today}`) });
  await cell.click();
  await expect(page.getByRole("menu", { name: "Set attendance status" })).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByText("Marked A")).toBeVisible();
  await expect(cell).toHaveAccessibleName(/Absent/);

  // live side panel reflects the absence
  await expect(page.getByLabel("Employee summary").getByRole("paragraph").filter({ hasText: "Rohan Gupta" })).toBeVisible();
  await expect(page.getByLabel("Employee summary").getByText("Projected payable days")).toBeVisible();

  await page.getByRole("listitem").filter({ hasText: "Marked A" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Change undone")).toBeVisible();
  await expect(cell).not.toHaveAccessibleName(/Absent/);
});

test("locked cycle is read-only", async ({ page }) => {
  await login(page, "hr@prosparity.demo");
  await page.goto("/attendance");
  await page.getByRole("combobox", { name: "Salary cycle" }).click();
  await page.getByRole("option", { name: /20 Jul|20 Aug/ }).first().click();
  await expect(page.getByText("Locked cycle")).toBeVisible();
  await expect(page.getByRole("grid")).toHaveAttribute("aria-readonly", "true");
});
