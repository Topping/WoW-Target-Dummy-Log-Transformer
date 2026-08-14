import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const VERSION_LINE =
  "8/14/2026 15:00:00.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1";

export async function expectNoAccessibilityViolations(
  page: Page,
  state: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    })),
    `${state} accessibility violations`,
  ).toEqual([]);
}

export async function expectFocusedHeading(
  page: Page,
  name: RegExp,
): Promise<void> {
  const heading = page.getByRole("heading", { level: 2, name });
  await expect(heading).toBeFocused();
}

export async function expectAttemptSelection(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Choose an attempt" }),
  ).toBeVisible();
}

export async function useFirstAttempt(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Use this attempt" }).first().click();
  await expectAutomaticResult(page);
}

export async function expectAutomaticResult(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Your encounter log is ready" }),
  ).toBeVisible();
}
