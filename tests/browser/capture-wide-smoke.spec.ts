import { test, expect } from "@playwright/test";

test("large real capture keeps the main thread responsive and extraction stops early", async ({
  page,
}, testInfo) => {
  test.skip(
    !["chromium-proxy", "installed-chrome"].includes(testInfo.project.name),
    "The explicitly named large-capture smoke runs in Chromium proxy and installed Chrome.",
  );

  await page.goto("./");
  await page.evaluate(() => {
    const samples: number[] = [];
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      samples.push(now - previous);
      previous = now;
    }, 25);
    Object.assign(window, {
      __d10Heartbeat: { samples, timer, startedAt: performance.now() },
    });
  });

  await page
    .locator('input[type="file"]')
    .setInputFiles("data/dummy-encounter.txt");
  const progress = page.getByRole("progressbar", {
    name: "Combat log processing progress",
  });
  await expect(progress).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/percent/u);

  await expect(
    page.getByRole("heading", { name: "Preparing encounter log" }),
  ).toBeVisible();
  const discoveryMeasurement = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __d10Heartbeat: {
          readonly samples: number[];
          readonly timer: number;
          readonly startedAt: number;
        };
      }
    ).__d10Heartbeat;
    window.clearInterval(state.timer);
    return {
      wallMs: performance.now() - state.startedAt,
      heartbeatCount: state.samples.length,
      maximumHeartbeatGapMs: Math.max(0, ...state.samples),
    };
  });
  expect(discoveryMeasurement.heartbeatCount).toBeGreaterThan(0);
  expect(discoveryMeasurement.maximumHeartbeatGapMs).toBeLessThan(500);

  const extractionStartedAt = performance.now();
  await expect(
    page.getByRole("heading", { name: "Your encounter log is ready" }),
  ).toBeVisible();
  const extractionWallMs = performance.now() - extractionStartedAt;
  await page.getByText("View attempt details", { exact: true }).click();
  await page.getByText("Technical details", { exact: true }).click();
  const technicalDetails = await page
    .locator(".technical-panel pre")
    .textContent();
  const sourceBytesRead = /"bytesRead":\s*(\d+)/u.exec(
    technicalDetails ?? "",
  )?.[1];
  expect(sourceBytesRead).toBeDefined();
  expect(Number(sourceBytesRead)).toBeLessThan(28_880_428);

  const measurement = {
    project: testInfo.project.name,
    userAgent: await page.evaluate(() => navigator.userAgent),
    fixture: "data/dummy-encounter.txt",
    discovery: discoveryMeasurement,
    extraction: { wallMs: extractionWallMs, sourceBytesRead },
  };
  process.stdout.write(`D10_BROWSER_PROFILE ${JSON.stringify(measurement)}\n`);
});
