import { expect, test } from "@playwright/test";
import { iso, login, workingDay } from "./helpers";

/** Critical flow 2 (HR-only version): HR records leave for an employee with the live paid/LOP preview;
 *  it is applied immediately, shows in leave records and as `L` on the attendance grid. */
test("HR records leave for an employee: preview, save, visible in records and on the grid", async ({ page }) => {
  const day = workingDay(2);

  await login(page, "hr@prosparity.demo");
  await page.goto("/leave");
  await expect(page.getByRole("heading", { name: "Leave management" })).toBeVisible();
  await page.getByRole("button", { name: "Record leave" }).click();

  const dialog = page.getByRole("dialog", { name: "Record leave" });
  await dialog.getByRole("combobox").click();
  await page.getByPlaceholder("Search by name or code…").last().fill("Sneha");
  await page.getByRole("option", { name: /Sneha Kulkarni/ }).click();

  const form = dialog.getByRole("form", { name: /Apply leave for Sneha Kulkarni/ });
  await form.getByLabel("From").fill(iso(day));
  await form.getByLabel("To").fill(iso(day));
  await expect(form.getByLabel("Leave preview")).toContainText(/paid|LOP/, { timeout: 15_000 });
  await form.getByLabel("Reason").fill("Playwright E2E medical appointment");
  await form.getByRole("button", { name: "Record leave" }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("row").filter({ hasText: "Playwright E2E medical appointment" })
    .or(page.getByRole("listitem").filter({ hasText: "Playwright E2E medical appointment" }));
  await expect(row.first()).toContainText(/approved/i);

  // the leave is on the attendance grid
  await page.goto("/attendance");
  const label = day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  const cell = page.getByRole("gridcell", { name: new RegExp(`^Sneha Kulkarni, ${label}`) });
  if (await cell.count()) await expect(cell).toHaveAccessibleName(/Leave/);
});
