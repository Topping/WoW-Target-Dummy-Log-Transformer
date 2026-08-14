import { test, expect } from "@playwright/test";

import {
  expectFocusedHeading,
  expectNoAccessibilityViolations,
  reachSessionSelection,
  selectFirstSessionAndProcess,
} from "./helpers";

const CLEAVE_CAPTURE = "data/cleave-logs.txt";

test("real five-target file-to-both-exports workflow is accessible and local-only", async ({
  page,
}, testInfo) => {
  const requestsAfterIntake: {
    readonly method: string;
    readonly url: string;
    readonly postData: string | null;
  }[] = [];

  await page.goto("/");
  await expectNoAccessibilityViolations(page, "waiting for file");

  const chooserPromise = page.waitForEvent("filechooser");
  const chooseButton = page.getByRole("button", {
    name: "Choose a combat log",
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

  await expect(
    page.getByRole("heading", {
      name: "Is this the character that recorded the log?",
    }),
  ).toBeVisible();
  await expectFocusedHeading(
    page,
    /Is this the character that recorded the log/u,
  );
  await expectNoAccessibilityViolations(page, "recorder confirmation");

  await reachSessionSelection(page);
  await expect(page.getByText("5 targets", { exact: true })).toBeVisible();
  await expectNoAccessibilityViolations(page, "session selection");

  await selectFirstSessionAndProcess(page);
  await expectFocusedHeading(page, /Your clean training session/u);
  await expect(
    page.getByRole("heading", { name: "All 5 targets" }),
  ).toBeVisible();
  await expect(page.getByText("Target 5:", { exact: false })).toBeVisible();
  await page.getByText("Technical and debug details", { exact: true }).click();
  await expect(page.getByText(/parserVersion/u)).toBeVisible();
  await expectNoAccessibilityViolations(page, "processed result");

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toMatch(/\.session\.json$/u);
  await expect(page.locator(".export-feedback[role='status']")).toContainText(
    "is ready in your downloads",
  );

  const logDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export filtered combat log" })
    .click();
  const logDownload = await logDownloadPromise;
  expect(logDownload.suggestedFilename()).toMatch(/\.session\.filtered\.log$/u);

  expect(requestsAfterIntake.every((request) => request.method === "GET")).toBe(
    true,
  );
  expect(
    requestsAfterIntake.every((request) => request.postData === null),
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
    url: "http://127.0.0.1:4173/",
    localStorageEntries: 0,
    sessionStorageEntries: 0,
    cookie: "",
    indexedDatabases: 0,
    serviceWorkers: 0,
  });

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
