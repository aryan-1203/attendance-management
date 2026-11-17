import { expect, test } from "@playwright/test";
import { iso, login } from "./helpers";

function lastWorkingDay(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  // skip Sundays and the seeded public holiday on 9 Nov
  while (d.getDay() === 0 || iso(d).endsWith("-11-09")) d.setDate(d.getDate() - 1);
  return iso(d);
}

/** Critical flow 3: HR imports attendance from a file: upload → mapping → validation → confirm → history/rollback. */
test("Excel import wizard: upload, validate (with an error row), import, roll back", async ({ page }) => {
  const day = lastWorkingDay();
  const csv = ["Emp Code,Date,Status,Note", `AE003,${day},A,imported`, `AE005,${day},HD,imported`,
    `ZZ999,${day},P,unknown employee`].join("\n");

  await login(page, "shraddha@prosparity.in");
  await page.goto("/import");
  await page.locator("input[type=file]").setInputFiles({ name: "e2e-attendance.csv", mimeType: "text/csv",
    buffer: Buffer.from(csv) });

  // mapping step auto-detects the long layout
  await expect(page.getByRole("button", { name: /Validate file/ })).toBeVisible();
  await page.getByRole("button", { name: /Validate file/ }).click();

  // validation preview: 2 importable, 1 error
  await expect(page.getByText(/Unknown employee code/).first()).toBeVisible();
  await page.getByRole("button", { name: /Review & confirm/ }).click();
  await page.getByRole("button", { name: /Import 2 marks/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible();

  // the grid now shows the imported absence
  await page.getByRole("button", { name: "View history" }).click();
  const batch = page.getByRole("row").filter({ hasText: "e2e-attendance.csv" }).first();
  await expect(batch).toContainText(/imported/i);
  await batch.getByRole("button", { name: /Roll back/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Roll back/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "e2e-attendance.csv" }).first()).toContainText(/rolled back/i);
});
