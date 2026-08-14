import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env["PLAYWRIGHT_BASE_URL"];
const requestedBasePath = process.env["PAGES_BASE_PATH"] ?? "/";
const basePath = `/${requestedBasePath.split("/").filter(Boolean).join("/")}${
  requestedBasePath === "/" ? "" : "/"
}`;
const localBaseUrl = `http://127.0.0.1:4173${basePath}`;
const baseUrl =
  externalBaseUrl === undefined
    ? localBaseUrl
    : externalBaseUrl.endsWith("/")
      ? externalBaseUrl
      : `${externalBaseUrl}/`;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: baseUrl,
    trace: "retain-on-failure",
  },
  ...(externalBaseUrl === undefined
    ? {
        webServer: {
          command: "npm run preview:pages",
          url: localBaseUrl,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      }
    : {}),
  projects: [
    {
      name: "chromium-proxy",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "firefox-proxy",
      use: { ...devices["Desktop Firefox"], browserName: "firefox" },
    },
    {
      name: "webkit-proxy",
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
    {
      name: "installed-chrome",
      use: {
        browserName: "chromium",
        channel: "chrome",
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
