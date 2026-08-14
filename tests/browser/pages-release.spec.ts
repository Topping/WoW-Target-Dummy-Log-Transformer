import { test, expect } from "@playwright/test";

test("repository-scoped production entry point loads directly and after refresh", async ({
  page,
}) => {
  const failedRequests: string[] = [];
  const responseStatuses: { readonly status: number; readonly url: string }[] =
    [];
  page.on("requestfailed", (request) => {
    failedRequests.push(request.url());
  });
  page.on("response", (response) => {
    responseStatuses.push({ status: response.status(), url: response.url() });
  });

  const response = await page.goto("./");
  expect(response?.status()).toBe(200);
  const directUrl = page.url();
  const base = new URL(".", directUrl);
  const expectedBasePath = process.env["PAGES_BASE_PATH"];
  if (expectedBasePath !== undefined) {
    expect(base.pathname).toBe(expectedBasePath);
  }
  await expect(
    page.getByRole("heading", {
      name: "Find the clean attempt inside your combat log.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Your combat log stays on your computer.",
    }),
  ).toBeVisible();

  const loadedStaticPaths = responseStatuses
    .filter((entry) => new URL(entry.url).origin === base.origin)
    .map((entry) => new URL(entry.url).pathname);
  expect(loadedStaticPaths).toContain(base.pathname);
  expect(
    loadedStaticPaths.every((path) => path.startsWith(base.pathname)),
  ).toBe(true);
  expect(
    loadedStaticPaths.some((path) =>
      /\/assets\/index-[A-Za-z0-9_-]+\.js$/u.test(path),
    ),
  ).toBe(true);
  expect(
    loadedStaticPaths.some((path) =>
      /\/assets\/index-[A-Za-z0-9_-]+\.css$/u.test(path),
    ),
  ).toBe(true);
  expect(
    responseStatuses.every(
      (entry) => entry.status >= 200 && entry.status < 400,
    ),
  ).toBe(true);
  expect(failedRequests).toEqual([]);

  await page.reload();
  expect(page.url()).toBe(directUrl);
  await expect(
    page.getByRole("button", { name: "Choose a combat log" }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(base.pathname);
});
