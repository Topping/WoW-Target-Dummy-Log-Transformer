import { test, expect } from "@playwright/test";

test("narrow desktop/mobile-sized viewport remains operable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Choose a combat log" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);

  await page
    .locator('input[type="file"]')
    .setInputFiles("data/cleave-logs.txt");
  await expect(
    page.getByRole("heading", {
      name: "Is this the character that recorded the log?",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});
