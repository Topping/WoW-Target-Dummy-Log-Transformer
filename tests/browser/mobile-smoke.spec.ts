import { test, expect } from "@playwright/test";

test("narrow desktop/mobile-sized viewport remains operable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Choose combat log" }),
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
    page.getByRole("heading", { name: "Your encounter log is ready" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download encounter log" }),
  ).toBeInViewport();
  const resultDimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));
  expect(resultDimensions.contentWidth).toBeLessThanOrEqual(
    resultDimensions.viewportWidth,
  );
});
