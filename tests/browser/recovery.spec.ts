import { test, expect } from "@playwright/test";

import {
  VERSION_LINE,
  expectFocusedHeading,
  expectNoAccessibilityViolations,
  reachSessionSelection,
} from "./helpers";

const DAMAGE_A =
  '8/14/2026 15:00:01.0000  SPELL_DAMAGE,Player-1,"First Character",0x510,0x0,Creature-1,"Localized Target",0xa28,0x0,1,"Strike",0x1,100';
const DAMAGE_B =
  '8/14/2026 15:00:02.0000  SPELL_DAMAGE,Player-2,"Second Character",0x510,0x0,Creature-2,"Another Target",0xa28,0x0,1,"Strike",0x1,100';
const SELF_BUFF =
  '8/14/2026 15:00:01.0000  SPELL_AURA_APPLIED,Player-1,"Recorder",0x511,0x0,Player-1,"Recorder",0x511,0x0,1,"Buff",0x1,BUFF';

test("explicit character selection and no-session recovery remain usable", async ({
  page,
}) => {
  await page.goto("./");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "multiple.log",
    mimeType: "text/plain",
    buffer: Buffer.from([VERSION_LINE, DAMAGE_A, DAMAGE_B].join("\n")),
  });

  await expect(
    page.getByRole("heading", {
      name: "Which character do you want to analyze?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "First Character" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Second Character" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "First Character" }).check();
  await page.getByRole("button", { name: "Continue to sessions" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Training sessions for First Character",
    }),
  ).toBeVisible();

  await input.setInputFiles({
    name: "no-session.log",
    mimeType: "text/plain",
    buffer: Buffer.from([VERSION_LINE, SELF_BUFF].join("\n")),
  });
  await reachSessionSelection(page);
  await expect(
    page.getByRole("heading", {
      name: "No training sessions found for this character",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/fight continuously for at least 20–30 seconds/u),
  ).toBeVisible();
});

test("retry and replacement-file recovery remain usable", async ({ page }) => {
  await page.goto("./");
  const input = page.locator('input[type="file"]');

  await input.setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("ordinary prose"),
  });
  await expect(
    page.getByRole("heading", {
      name: "This doesn't look like a supported WoW combat log",
    }),
  ).toBeVisible();
  await expectFocusedHeading(page, /This doesn't look like/u);
  await expectNoAccessibilityViolations(page, "recoverable invalid-file error");
  await page.getByRole("button", { name: "Try this file again" }).click();
  await expect(
    page.getByRole("heading", {
      name: "This doesn't look like a supported WoW combat log",
    }),
  ).toBeVisible();

  await input.setInputFiles("data/cleave-logs.txt");
  await expect(
    page.getByRole("heading", {
      name: "Is this the character that recorded the log?",
    }),
  ).toBeVisible();
});

test("large-capture cancellation suppresses stale completion and permits replacement", async ({
  page,
}, testInfo) => {
  test.skip(
    !["chromium-proxy", "installed-chrome"].includes(testInfo.project.name),
    "The timing-sensitive real-capture cancellation smoke runs in Chromium proxy and installed Chrome; lifecycle races also have deterministic unit coverage.",
  );

  await page.goto("./");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles("data/dummy-encounter.txt");
  const cancel = page.getByRole("button", { name: "Cancel scanning" });
  await cancel.waitFor({ state: "attached" });
  await cancel.evaluate((button: HTMLButtonElement) => {
    button.click();
  });
  await expect(
    page.getByRole("heading", { name: "File scanning was cancelled" }),
  ).toBeVisible();

  await input.setInputFiles("data/cleave-logs.txt");
  await expect(
    page.getByRole("heading", {
      name: "Is this the character that recorded the log?",
    }),
  ).toBeVisible();
  await page.waitForTimeout(250);
  await expect(
    page.getByRole("heading", { name: "File scanning was cancelled" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const session = page
    .getByRole("radio", { name: /training attempt/u })
    .first();
  await session.check();
  await page
    .getByRole("button", { name: "Process selected attempt" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
    });
  const cancelProcessing = page.getByRole("button", {
    name: "Cancel processing",
  });
  await cancelProcessing.waitFor({ state: "attached" });
  await cancelProcessing.evaluate((button: HTMLButtonElement) => {
    button.click();
  });
  await expect(
    page.getByRole("heading", { name: "Session processing was cancelled" }),
  ).toBeVisible();
});
