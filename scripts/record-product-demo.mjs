/* global DataTransfer, document, DragEvent, HTMLElement, HTMLTextAreaElement, InputEvent, requestAnimationFrame, window, Worker */

import { spawn, spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const COMBAT_LOG = resolve(ROOT, "data/dummy-encounter.txt");
const SIMC_PROFILE = resolve(ROOT, "data/example-simc.txt");
const OUTPUT_DIRECTORY = resolve(ROOT, "demo-output");
const VIDEO_PATH = resolve(OUTPUT_DIRECTORY, "product-demo.webm");
const GIF_PATH = resolve(OUTPUT_DIRECTORY, "product-demo.gif");
const README_GIF_PATH = resolve(ROOT, "assets/product-demo.gif");
const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${String(PORT)}/`;
const VIEWPORT = { width: 1280, height: 800 };
const DISCOVERY_MINIMUM_MS = 2_200;
const PROCESSING_MINIMUM_MS = 1_800;

const wait = (milliseconds) =>
  new Promise((resolveWait) => {
    setTimeout(resolveWait, milliseconds);
  });

async function requireInput(path, description) {
  try {
    await access(path);
  } catch {
    throw new Error(`${description} is missing: ${path}`);
  }
}

async function waitForServer(server, serverDiagnostics) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(
        `The local demo server exited with code ${String(server.exitCode)}.${serverDiagnostics()}`,
      );
    }
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The server normally needs a few attempts before it accepts connections.
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${BASE_URL}.`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => {
      server.once("exit", resolveExit);
    }),
    wait(2_000),
  ]);
}

async function installDemoPacing(context) {
  await context.addInitScript(
    ({ discoveryMinimumMs, processingMinimumMs }) => {
      const NativeWorker = Worker;

      class DemoPacedWorker extends NativeWorker {
        operationStartedAt = new Map();
        replayedEvents = new WeakSet();

        constructor(...arguments_) {
          super(...arguments_);
          super.addEventListener("message", (event) => {
            if (this.replayedEvents.has(event)) return;
            const response = event.data;
            if (
              typeof response !== "object" ||
              response === null ||
              !("type" in response) ||
              !["DISCOVERY_COMPLETE", "SESSION_COMPLETE"].includes(
                response.type,
              ) ||
              !("operationId" in response) ||
              typeof response.operationId !== "string"
            ) {
              return;
            }

            event.stopImmediatePropagation();
            const startedAt =
              this.operationStartedAt.get(response.operationId) ??
              performance.now();
            this.operationStartedAt.delete(response.operationId);
            const minimumDuration =
              response.type === "DISCOVERY_COMPLETE"
                ? discoveryMinimumMs
                : processingMinimumMs;
            const remaining = Math.max(
              0,
              minimumDuration - (performance.now() - startedAt),
            );
            const replay = new MessageEvent("message", { data: response });
            this.replayedEvents.add(replay);
            setTimeout(() => {
              this.dispatchEvent(replay);
            }, remaining);
          });
        }

        postMessage(message, options) {
          if (
            typeof message === "object" &&
            message !== null &&
            "type" in message &&
            ["DISCOVER_FILE", "PROCESS_SESSION"].includes(message.type) &&
            "operationId" in message &&
            typeof message.operationId === "string"
          ) {
            this.operationStartedAt.set(message.operationId, performance.now());
          }
          if (arguments.length === 1) super.postMessage(message);
          else super.postMessage(message, options);
        }
      }

      window.Worker = DemoPacedWorker;
    },
    {
      discoveryMinimumMs: DISCOVERY_MINIMUM_MS,
      processingMinimumMs: PROCESSING_MINIMUM_MS,
    },
  );
}

async function stageFileDrop(page, inputPath) {
  const dropZone = page.locator(".drop-zone");
  const box = await dropZone.boundingBox();
  if (box === null)
    throw new Error("Could not locate the combat-log drop zone.");

  const fileName = basename(inputPath);
  const start = {
    x: Math.max(28, box.x - 220),
    y: box.y + box.height / 2 - 48,
  };
  const end = {
    x: box.x + box.width / 2 - 118,
    y: box.y + box.height / 2 - 48,
  };

  await page.evaluate(
    ({ end, fileName, start }) => {
      const layer = document.createElement("div");
      layer.id = "demo-file-drag";
      layer.setAttribute("aria-hidden", "true");
      layer.style.setProperty("--start-x", `${String(start.x)}px`);
      layer.style.setProperty("--start-y", `${String(start.y)}px`);
      layer.style.setProperty("--end-x", `${String(end.x)}px`);
      layer.style.setProperty("--end-y", `${String(end.y)}px`);

      const style = document.createElement("style");
      style.textContent = `
        #demo-file-drag {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          pointer-events: none;
          opacity: 0;
          transition: opacity 260ms ease;
        }
        #demo-file-drag.demo-visible { opacity: 1; }
        #demo-file-card {
          position: absolute;
          left: var(--start-x);
          top: var(--start-y);
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr);
          align-items: center;
          gap: 12px;
          width: 236px;
          min-height: 88px;
          padding: 14px;
          border: 1px solid #5b6267;
          border-radius: 12px;
          color: #e8e8e4;
          background: rgba(28, 32, 35, 0.98);
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.48);
          transition:
            left 1500ms cubic-bezier(0.22, 1, 0.36, 1),
            top 1500ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 180ms ease;
        }
        #demo-file-drag.demo-moving #demo-file-card {
          left: var(--end-x);
          top: var(--end-y);
          transform: scale(0.96);
        }
        #demo-file-icon {
          display: grid;
          width: 42px;
          height: 50px;
          place-items: center;
          border: 1px solid #8e7648;
          border-radius: 6px;
          color: #e0bc72;
          background: #282317;
          font: 800 11px/1 system-ui, sans-serif;
          letter-spacing: 0.06em;
        }
        #demo-file-copy { min-width: 0; }
        #demo-file-name {
          overflow: hidden;
          margin: 0;
          font: 700 14px/1.3 system-ui, sans-serif;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #demo-file-label {
          margin: 5px 0 0;
          color: #a4aaad;
          font: 600 11px/1.2 system-ui, sans-serif;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        #demo-drag-cursor {
          position: absolute;
          left: calc(var(--start-x) + 205px);
          top: calc(var(--start-y) + 62px);
          color: #fff;
          font: 38px/1 system-ui, sans-serif;
          filter: drop-shadow(0 2px 2px #000);
          transform: rotate(-42deg);
          transition:
            left 1500ms cubic-bezier(0.22, 1, 0.36, 1),
            top 1500ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        #demo-file-drag.demo-moving #demo-drag-cursor {
          left: calc(var(--end-x) + 205px);
          top: calc(var(--end-y) + 62px);
        }
      `;

      const card = document.createElement("div");
      card.id = "demo-file-card";
      const icon = document.createElement("div");
      icon.id = "demo-file-icon";
      icon.textContent = "LOG";
      const copy = document.createElement("div");
      copy.id = "demo-file-copy";
      const name = document.createElement("p");
      name.id = "demo-file-name";
      name.textContent = fileName;
      const label = document.createElement("p");
      label.id = "demo-file-label";
      label.textContent = "Demo combat log";
      copy.append(name, label);
      card.append(icon, copy);

      const cursor = document.createElement("div");
      cursor.id = "demo-drag-cursor";
      cursor.textContent = "➤";
      layer.append(style, card, cursor);
      document.body.append(layer);
      requestAnimationFrame(() => {
        layer.classList.add("demo-visible");
      });
    },
    { end, fileName, start },
  );

  await wait(650);
  await page.evaluate(() => {
    document.querySelector("#demo-file-drag")?.classList.add("demo-moving");
  });
  await wait(900);
  await dropZone.evaluate((element) => {
    element.dispatchEvent(
      new DragEvent("dragenter", {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      }),
    );
  });
  await wait(700);
  await page.locator('input[type="file"]').setInputFiles(inputPath);
  await wait(250);
  await page.evaluate(() => {
    document.querySelector("#demo-file-drag")?.remove();
  });
}

async function stageSimcPaste(page, textarea, simcProfile) {
  const box = await textarea.boundingBox();
  if (box === null) throw new Error("Could not locate the SIMC profile field.");

  await page.evaluate(
    ({ box, profileSize }) => {
      const cue = document.createElement("div");
      cue.id = "demo-paste-cue";
      cue.setAttribute("aria-hidden", "true");
      cue.style.left = `${String(Math.min(box.x + box.width - 292, window.innerWidth - 312))}px`;
      cue.style.top = `${String(Math.max(20, box.y - 84))}px`;
      cue.style.cssText += `
        position: fixed;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 292px;
        padding: 12px 14px;
        border: 1px solid #5b6267;
        border-radius: 10px;
        color: #e8e8e4;
        background: rgba(28, 32, 35, 0.98);
        box-shadow: 0 15px 42px rgba(0, 0, 0, 0.45);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 180ms ease, transform 180ms ease;
        font-family: system-ui, sans-serif;
      `;

      const shortcut = document.createElement("span");
      shortcut.textContent = "⌘ V";
      shortcut.style.cssText = `
        flex: 0 0 auto;
        padding: 7px 9px;
        border: 1px solid #777f84;
        border-bottom-width: 3px;
        border-radius: 6px;
        color: #fff;
        background: #111416;
        font-size: 14px;
        font-weight: 750;
      `;

      const copy = document.createElement("span");
      copy.style.cssText = "display:grid;gap:3px;";
      const title = document.createElement("strong");
      title.textContent = "Paste /simc output";
      title.style.fontSize = "14px";
      const detail = document.createElement("span");
      detail.textContent = `${(profileSize / 1024).toFixed(1)} KB copied for this demo`;
      detail.style.cssText = "color:#a4aaad;font-size:12px;";
      copy.append(title, detail);
      cue.append(shortcut, copy);
      document.body.append(cue);
      requestAnimationFrame(() => {
        cue.style.opacity = "1";
        cue.style.transform = "translateY(0)";
      });
    },
    { box, profileSize: Buffer.byteLength(simcProfile) },
  );

  await wait(750);
  await textarea.evaluate((element, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    );
    descriptor?.set?.call(element, value);
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertFromPaste",
      }),
    );
    element.scrollTop = 0;
  }, simcProfile);
  await wait(1_050);
  await page.evaluate(() => {
    const cue = document.querySelector("#demo-paste-cue");
    if (!(cue instanceof HTMLElement)) return;
    cue.style.opacity = "0";
    cue.style.transform = "translateY(-6px)";
    setTimeout(() => {
      cue.remove();
    }, 200);
  });
}

function renderGif() {
  const available = spawnSync("ffmpeg", ["-version"], {
    encoding: "utf8",
    stdio: "ignore",
  });
  if (available.error !== undefined || available.status !== 0) return false;

  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      VIDEO_PATH,
      "-filter_complex",
      "fps=12,scale=960:-2:flags=lanczos,split[frames][paletteframes];[paletteframes]palettegen=max_colors=160:stats_mode=diff[palette];[frames][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
      "-loop",
      "0",
      GIF_PATH,
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with code ${String(result.status)}.`);
  }
  return true;
}

async function recordDemo() {
  await requireInput(COMBAT_LOG, "Demo combat log");
  await requireInput(SIMC_PROFILE, "Demo SIMC profile");
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const simcProfile = await readFile(SIMC_PROFILE, "utf8");

  const server = spawn(process.execPath, ["scripts/serve-pages-artifact.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      serverOutput += String(chunk);
    });
  }
  let browser;

  try {
    await waitForServer(server, () =>
      serverOutput.trim() === "" ? "" : `\n${serverOutput.trim()}`,
    );
    browser = await chromium.launch({
      headless: process.env.DEMO_HEADED !== "1",
    });
    const context = await browser.newContext({
      acceptDownloads: true,
      colorScheme: "dark",
      viewport: VIEWPORT,
    });
    await installDemoPacing(context);
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(BASE_URL).origin) await route.continue();
      else await route.abort("blockedbyclient");
    });

    await page.goto(BASE_URL);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.screencast.start({
      path: VIDEO_PATH,
      quality: 90,
      size: VIEWPORT,
    });
    await page.screencast.showActions({
      cursor: "pointer",
      duration: 750,
      fontSize: 18,
      position: "top-right",
    });

    await page.screencast.showChapter("From training dummy to encounter log", {
      description: "Processed locally in your browser",
      duration: 1_500,
    });
    await wait(1_750);

    await stageFileDrop(page, COMBAT_LOG);
    await page
      .getByRole("heading", { name: "Your encounter log is ready" })
      .waitFor({ timeout: 120_000 });
    await wait(1_000);

    await page.screencast.showChapter("Add character details", {
      description: "Paste the SimulationCraft addon's /simc output",
      duration: 1_350,
    });
    await wait(1_550);

    const characterProfile = page.getByText("Character profile", {
      exact: true,
    });
    await characterProfile.click();
    const textarea = page.getByLabel("SimulationCraft addon output");
    await textarea.scrollIntoViewIfNeeded();
    await wait(450);
    await textarea.click();
    await stageSimcPaste(page, textarea, simcProfile);
    await page.getByRole("button", { name: "Use profile" }).click();
    await page.getByText("Active profile · Pølsefatter").waitFor();
    await page.locator(".character-profile-panel:not([open])").waitFor();
    await wait(1_050);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download encounter log" }).click();
    await downloadPromise;
    await page.getByText("Encounter log downloaded.").waitFor();
    await wait(700);

    await page.screencast.showChapter("Ready to analyze", {
      description: "Upload the generated encounter log to Warcraft Logs",
      duration: 1_700,
    });
    await wait(2_100);
    await page.screencast.stop();
    await context.close();
  } finally {
    await browser?.close();
    await stopServer(server);
  }

  process.stdout.write(`Recorded ${VIDEO_PATH}\n`);
  if (renderGif()) {
    await mkdir(resolve(ROOT, "assets"), { recursive: true });
    await copyFile(GIF_PATH, README_GIF_PATH);
    process.stdout.write(`Rendered ${GIF_PATH}\nUpdated ${README_GIF_PATH}\n`);
  } else {
    process.stdout.write(
      "GIF rendering skipped because ffmpeg is not installed. Install it with `brew install ffmpeg`, then rerun this command.\n",
    );
  }
}

await recordDemo();
