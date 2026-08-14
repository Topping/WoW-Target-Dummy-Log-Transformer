import { test, expect } from "@playwright/test";

import {
  expectAutomaticResult,
  expectFocusedHeading,
  expectNoAccessibilityViolations,
} from "./helpers";

const CLEAVE_CAPTURE = "data/cleave-logs.txt";

test("real five-target encounter-log workflow is accessible and local-only", async ({
  page,
}, testInfo) => {
  const requestsAfterIntake: {
    readonly method: string;
    readonly url: string;
    readonly postData: string | null;
  }[] = [];

  await page.goto("./");
  const analyzerUrl = page.url();
  const analyzerBase = new URL(".", analyzerUrl);
  await expectNoAccessibilityViolations(page, "waiting for file");
  await expect(page.getByText("Browser only", { exact: true })).toHaveCount(0);

  const chooserPromise = page.waitForEvent("filechooser");
  const chooseButton = page.getByRole("button", {
    name: "Choose combat log",
  });
  await chooseButton.focus();
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  page.on("request", (request) => {
    requestsAfterIntake.push({
      method: request.method(),
      url: request.url(),
      postData: request.postData(),
    });
  });
  await chooser.setFiles(CLEAVE_CAPTURE);

  await expectAutomaticResult(page);
  await expectFocusedHeading(page, /Your encounter log is ready/u);
  await expect(page.locator(".result-meta")).toContainText("5 targets");
  await expect(
    page.getByRole("button", { name: "Download encounter log" }),
  ).toBeDisabled();
  await expect(page.getByText("Character profile required")).toBeVisible();
  await expect(
    page.getByText(/validated SimulationCraft profile/u),
  ).toBeVisible();
  await expect(
    page.getByText("Export session JSON", { exact: true }),
  ).toHaveCount(0);
  await page.getByText("View attempt details", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "5 targets" })).toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.getByText(/parserVersion/u)).toBeVisible();
  await expectNoAccessibilityViolations(page, "processed result");

  await expect(page.locator(".export-feedback")).toHaveCount(0);
  await expect(page.getByText(/WowCoach/u)).toHaveCount(0);

  expect(requestsAfterIntake.length).toBeGreaterThan(0);
  expect(requestsAfterIntake.every((request) => request.method === "GET")).toBe(
    true,
  );
  expect(
    requestsAfterIntake.every((request) => request.postData === null),
  ).toBe(true);
  const networkRequests = requestsAfterIntake.filter((request) =>
    ["http:", "https:"].includes(new URL(request.url).protocol),
  );
  expect(
    requestsAfterIntake.every((request) =>
      ["http:", "https:", "blob:"].includes(new URL(request.url).protocol),
    ),
  ).toBe(true);
  expect(networkRequests.length).toBeGreaterThan(0);
  expect(
    networkRequests.every((request) => {
      const requestUrl = new URL(request.url);
      return (
        requestUrl.origin === analyzerBase.origin &&
        requestUrl.pathname.startsWith(analyzerBase.pathname)
      );
    }),
  ).toBe(true);
  expect(
    networkRequests.some((request) =>
      /\/assets\/parser\.worker-[A-Za-z0-9_-]+\.js$/u.test(
        new URL(request.url).pathname,
      ),
    ),
  ).toBe(true);
  const serializedRequests = JSON.stringify(requestsAfterIntake);
  expect(serializedRequests).not.toContain("Player-3702");
  expect(serializedRequests).not.toContain("Creature-0-");
  expect(serializedRequests).not.toContain("P%C3%B8lsefatter");

  const privacyState = await page.evaluate(async () => ({
    url: window.location.href,
    localStorageEntries: window.localStorage.length,
    sessionStorageEntries: window.sessionStorage.length,
    cookie: document.cookie,
    indexedDatabases:
      typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).length
        : 0,
    serviceWorkers:
      "serviceWorker" in navigator
        ? (await navigator.serviceWorker.getRegistrations()).length
        : 0,
  }));
  expect(privacyState).toEqual({
    url: analyzerUrl,
    localStorageEntries: 0,
    sessionStorageEntries: 0,
    cookie: "",
    indexedDatabases: 0,
    serviceWorkers: 0,
  });

  await page
    .getByRole("button", { name: "Choose a different attempt" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose an attempt" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use this attempt" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expectNoAccessibilityViolations(page, "attempt selection");

  testInfo.annotations.push({
    type: "browser-version",
    description: await page.evaluate(() => navigator.userAgent),
  });
  process.stdout.write(
    `D10_BROWSER_MATRIX ${JSON.stringify({
      project: testInfo.project.name,
      userAgent: await page.evaluate(() => navigator.userAgent),
    })}\n`,
  );
});
