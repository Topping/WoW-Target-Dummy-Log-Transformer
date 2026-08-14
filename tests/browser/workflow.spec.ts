import { readFile } from "node:fs/promises";

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

  await page.goto("./");
  const analyzerUrl = page.url();
  const analyzerBase = new URL(".", analyzerUrl);
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
  const jsonDownloadPath = await jsonDownload.path();
  const downloadedJson = JSON.parse(
    await readFile(jsonDownloadPath, "utf8"),
  ) as { readonly format?: unknown; readonly version?: unknown };
  expect(downloadedJson).toMatchObject({
    format: "wow-training-dummy-session",
    version: 1,
  });
  await expect(page.locator(".export-feedback[role='status']")).toContainText(
    "is ready in your downloads",
  );

  const logDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export encounter combat log" })
    .click();
  const logDownload = await logDownloadPromise;
  expect(logDownload.suggestedFilename()).toMatch(
    /\.session\.encounter\.log$/u,
  );
  const logDownloadPath = await logDownload.path();
  const downloadedLog = await readFile(logDownloadPath, "utf8");
  await expect
    .poll(() => downloadedLog)
    .toMatch(/ENCOUNTER_START,610,"Razorgore the Untamed",9,40,469/u);
  expect(downloadedLog).toContain('ZONE_CHANGE,469,"Blackwing Lair",9');
  expect(downloadedLog).toContain(
    'MAP_CHANGE,287,"Blackwing Lair",-7394.120117,-7727.069824,-844.622009,-1344.050049',
  );
  expect(downloadedLog).toContain("Creature-0-1465-469-4188-12435-00007EE8CE");
  expect(downloadedLog).not.toContain("Cleave Training Dummy");
  expect(downloadedLog).not.toContain("-243208-");
  expect(downloadedLog).toContain(
    'Creature-0-1465-469-4188-12435-00007EE8CE,"Razorgore the Untamed",0x10a48,',
  );
  expect(downloadedLog).not.toContain('"Razorgore the Untamed",0x10a28,');
  expect(downloadedLog).toContain(",287,");
  expect(downloadedLog).not.toContain(",2393,");
  expect(downloadedLog).toMatch(
    /ENCOUNTER_END,610,"Razorgore the Untamed",9,40,0,/u,
  );
  await expect(page.locator(".export-feedback[role='status']")).toContainText(
    "verified Blackwing Lair/Razorgore template",
  );

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
