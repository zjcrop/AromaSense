import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const site = resolve(root, "site");
const TIMEOUT_MS = 45_000;

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser"
  ].filter(Boolean);
  for (const executable of candidates) {
    const probe = spawnSync(executable, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      console.log(`Browser acceptance Chrome: ${String(probe.stdout || probe.stderr).trim()}`);
      return executable;
    }
  }
  throw new Error(`No Chrome/Chromium executable found. Tried: ${candidates.join(", ")}`);
}

async function startStaticServer() {
  await stat(resolve(site, "index.html"));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
      const file = resolve(site, relative);
      if (file !== site && !file.startsWith(`${site}${sep}`)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not-file");
      const bytes = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME.get(extname(file).toLowerCase()) || "application/octet-stream",
        "cache-control": "no-store"
      });
      response.end(bytes);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Static server did not expose a TCP port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Unable to allocate Chrome debugging port");
  const port = address.port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitUntil(check, label, timeoutMs = TIMEOUT_MS, intervalMs = 80) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`);
}

class CdpSession {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
    this.browserErrors = [];
  }

  async open() {
    requireCondition(typeof WebSocket === "function", "Node 24 WebSocket global is required for dependency-free CDP acceptance");
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed to open")), { once: true });
    });
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`CDP ${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails;
      this.browserErrors.push(`exception: ${detail?.text || detail?.exception?.description || "unknown"}`);
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      this.browserErrors.push(`log: ${message.params.entry.text}`);
    }
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

function jsString(value) {
  return JSON.stringify(value);
}

async function waitForExpression(cdp, expression, label, timeoutMs = TIMEOUT_MS) {
  return waitUntil(async () => {
    const value = await cdp.evaluate(expression);
    return value || false;
  }, label, timeoutMs);
}

async function setValue(cdp, selector, value) {
  const result = await cdp.evaluate(`(() => {
    const node = document.querySelector(${jsString(selector)});
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) return false;
    node.value = ${jsString(value)};
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return node.value;
  })()`);
  requireCondition(result === String(value), `Unable to set ${selector} to ${value}`);
}

async function click(cdp, selector) {
  const clicked = await cdp.evaluate(`(() => {
    const node = document.querySelector(${jsString(selector)});
    if (!(node instanceof HTMLElement)) return false;
    node.click();
    return true;
  })()`);
  requireCondition(clicked === true, `Unable to click ${selector}`);
}

async function runAcceptance(appUrl) {
  const executable = chromeExecutable();
  const debugPort = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), "aromasense-refresh-"));
  const chrome = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeStderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => { chromeStderr += chunk; });

  let cdp;
  try {
    await waitUntil(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        return response.ok;
      } catch { return false; }
    }, "Chrome remote debugging startup", 20_000);

    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" });
    requireCondition(targetResponse.ok, `Unable to create Chrome target: HTTP ${targetResponse.status}`);
    const target = await targetResponse.json();
    requireCondition(target.webSocketDebuggerUrl, "Chrome target did not expose a DevTools WebSocket");

    cdp = new CdpSession(target.webSocketDebuggerUrl);
    await cdp.open();
    await Promise.all([
      cdp.send("Page.enable"),
      cdp.send("Runtime.enable"),
      cdp.send("Log.enable")
    ]);

    await waitForExpression(cdp, `document.querySelector('#app')?.dataset.screen === 'setup'`, "initial setup screen");
    await setValue(cdp, '[data-session-field="组织方"] input', "AromaSense Refresh Acceptance");
    await setValue(cdp, '[data-session-field="杯测会名称"] input', "Browser Refresh Recovery");
    await click(cdp, 'button[data-cupping-target="blind"]');
    await waitForExpression(cdp, `document.querySelector('button[data-cupping-target="blind"]')?.getAttribute('aria-pressed') === 'true'`, "blind mode selection");
    await click(cdp, ".batch-setup__start");
    await waitForExpression(cdp, `Boolean(document.querySelector('.cupping-count-dialog__input'))`, "blind sample count dialog");
    await setValue(cdp, ".cupping-count-dialog__input", "1");
    await click(cdp, ".cupping-count-dialog__confirm");

    await waitForExpression(cdp, `document.querySelector('#app')?.dataset.screen === 'cupping'`, "new cupping session");
    await click(cdp, ".sample-rail__select");
    await waitForExpression(cdp, `Boolean(document.querySelector('.sensory-range__input'))`, "first sensory stage editor");

    await setValue(cdp, ".sensory-range__input", "7");
    await waitForExpression(cdp, `Boolean(document.querySelector('.cupping-stage-step.is-active')) && document.querySelector('#app')?.getAttribute('aria-busy') !== 'true'`, "persisted active sensory stage");
    const beforeReload = await cdp.evaluate(`(() => ({
      screen: document.querySelector('#app')?.dataset.screen,
      value: document.querySelector('.sensory-range__input')?.value,
      currentStage: document.querySelector('.cupping-stage-step[aria-current="step"]')?.dataset.stageId,
      activeStageLabel: document.querySelector('.cupping-stage-step.is-active')?.textContent?.trim()
    }))()`);
    requireCondition(beforeReload?.value === "7", `Sensory value was not committed before reload: ${JSON.stringify(beforeReload)}`);

    await cdp.evaluate(`window.__aromasenseAcceptanceBeforeReload = true`);
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForExpression(cdp, `typeof window.__aromasenseAcceptanceBeforeReload === 'undefined' && document.querySelector('#app')?.dataset.screen === 'setup'`, "setup after hard browser refresh", 60_000);

    await click(cdp, '[data-history-group="unfinished"] .batch-setup__history-toggle');
    const historyMeta = await waitForExpression(cdp, `(() => {
      const group = document.querySelector('[data-history-group="unfinished"]');
      const item = group?.querySelector('.batch-setup__history-item');
      if (!item || item.closest('.batch-setup__history-list')?.hidden) return false;
      return item.querySelector('.batch-setup__history-meta')?.textContent?.trim() || false;
    })()`, "unfinished session after reload");
    requireCondition(/1\s*个样品/.test(historyMeta) && /进行中/.test(historyMeta), `Recovered session metadata is wrong: ${historyMeta}`);

    await click(cdp, '[data-history-group="unfinished"] .batch-setup__history-item');
    await waitForExpression(cdp, `document.querySelector('#app')?.dataset.screen === 'cupping'`, "reopened unfinished session");
    await click(cdp, ".sample-rail__select");
    await waitForExpression(cdp, `Boolean(document.querySelector('.sensory-range__input')) && document.querySelector('#app')?.getAttribute('aria-busy') !== 'true'`, "reopened active sensory stage");

    const recovered = await cdp.evaluate(`(() => ({
      value: document.querySelector('.sensory-range__input')?.value,
      currentStage: document.querySelector('.cupping-stage-step[aria-current="step"]')?.dataset.stageId,
      activeStageLabel: document.querySelector('.cupping-stage-step.is-active')?.textContent?.trim(),
      historyMeta: ${jsString(historyMeta)}
    }))()`);
    requireCondition(recovered?.value === "7", `Saved sensory observation did not survive reload: ${JSON.stringify(recovered)}`);
    requireCondition(recovered?.currentStage === beforeReload?.currentStage, `Preferred active stage changed after reload: ${JSON.stringify({ beforeReload, recovered })}`);

    if (cdp.browserErrors.length) {
      const benignRuntimeNoise = /favicon|Failed to load resource.*404|onnxruntime:.*CleanUnusedInitializersAndNodeArgs/i;
      const relevant = cdp.browserErrors.filter((entry) => !benignRuntimeNoise.test(entry));
      requireCondition(relevant.length === 0, `Browser runtime errors observed:\n${relevant.join("\n")}`);
    }

    console.log("AromaSense browser refresh acceptance: PASS");
    console.log(JSON.stringify({ beforeReload, recovered }, null, 2));
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => chrome.once("exit", resolveExit)),
      delay(3000)
    ]);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true });
    if (chromeStderr && process.env.AROMASENSE_ACCEPTANCE_DEBUG === "1") console.error(chromeStderr);
  }
}

const { server, url } = await startStaticServer();
try {
  await runAcceptance(url);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
