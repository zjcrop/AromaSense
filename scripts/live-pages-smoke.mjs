import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const LIVE_URL = process.env.AROMASENSE_LIVE_URL || "https://zjcrop.github.io/AromaSense/";
const TIMEOUT_MS = 45_000;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function chromeExecutable() {
  for (const executable of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium"].filter(Boolean)) {
    const probe = spawnSync(executable, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return executable;
  }
  throw new Error("Chrome/Chromium not available");
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Unable to allocate Chrome debugging port");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitUntil(check, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(120);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`);
}

class CDP {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.handle(String(event.data)));
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed")), { once: true });
    });
  }

  handle(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    if (["Runtime.exceptionThrown", "Log.entryAdded", "Network.loadingFailed", "Network.responseReceived"].includes(message.method)) {
      this.events.push(message);
    }
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluation failed");
    return result.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

function diagnostics(cdp) {
  const rows = [];
  for (const event of cdp.events) {
    if (event.method === "Runtime.exceptionThrown") {
      rows.push(`EXCEPTION ${event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text || "unknown"}`);
    } else if (event.method === "Log.entryAdded") {
      const entry = event.params?.entry;
      if (entry?.level === "error" || entry?.level === "warning") rows.push(`LOG ${entry.level} ${entry.text}`);
    } else if (event.method === "Network.loadingFailed") {
      rows.push(`NETWORK FAILED ${event.params?.errorText || "unknown"} ${event.params?.type || ""}`);
    } else if (event.method === "Network.responseReceived") {
      const response = event.params?.response;
      const url = String(response?.url || "");
      if (/sql-wasm\.wasm|app\.js|luckybean-recognition-core\.js|coffee-foundation-runtime\.js/.test(url)) {
        rows.push(`NETWORK ${Math.round(response.status || 0)} ${response.mimeType || ""} ${url}`);
      }
    }
  }
  return rows;
}

const executable = chromeExecutable();
const debugPort = await freePort();
const chrome = spawn(executable, [
  "--headless=new",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--no-first-run",
  `--remote-debugging-port=${debugPort}`,
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", (chunk) => { stderr += chunk; });
let cdp;
try {
  await waitUntil(async () => {
    try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; }
  }, "Chrome startup", 20_000);
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  requireCondition(targetResponse.ok, `Unable to create target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Log.enable"), cdp.send("Network.enable")]);
  await cdp.send("Page.navigate", { url: LIVE_URL });

  let state;
  try {
    state = await waitUntil(async () => {
      const current = await cdp.evaluate(`(() => ({
        screen: document.querySelector('#app')?.dataset.screen || '',
        progress: document.querySelector('.startup__progress-value')?.textContent || '',
        text: document.querySelector('#app')?.textContent?.slice(0, 300) || ''
      }))()`);
      return current?.screen === "setup" ? current : false;
    }, "live setup screen", 35_000);
  } catch (error) {
    const snapshot = await cdp.evaluate(`(() => ({
      screen: document.querySelector('#app')?.dataset.screen || '',
      progress: document.querySelector('.startup__progress-value')?.textContent || '',
      text: document.querySelector('#app')?.textContent?.slice(0, 500) || ''
    }))()`);
    console.error("LIVE SNAPSHOT", JSON.stringify(snapshot));
    console.error(diagnostics(cdp).join("\n"));
    throw error;
  }
  console.log("AromaSense live Pages smoke: PASS", JSON.stringify(state));
  if (process.env.AROMASENSE_VERIFY_OCR === "1") {
    const expectedBuild = (process.env.GITHUB_SHA || "").slice(0, 16);
    const actualBuild = await cdp.evaluate(`document.querySelector('meta[name="build-revision"]')?.content || ''`);
    requireCondition(!expectedBuild || actualBuild === expectedBuild, `Live build mismatch: ${actualBuild} != ${expectedBuild}`);
    const ocr = await cdp.evaluate(`(async () => {
      const api = globalThis.LuckyBeanPaddleOCR;
      if (api?.version !== '0.4.9') throw new Error('Expected repaired PP-OCR 0.4.9 provider');
      const canvas = document.createElement('canvas');
      canvas.width = 960; canvas.height = 640;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 960, 640);
      ctx.fillStyle = '#111'; ctx.font = 'bold 52px Arial';
      ctx.fillText('ETHIOPIA GUJI', 70, 180);
      ctx.fillText('WASHED 1950M', 70, 300);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      try {
        const result = await api.recognizeCoffeeBag([{ id: 'live-ocr-check', blob }]);
        return { text: result.fullText, blocks: result.blocks.length, version: api.version, workerBootstrap: api.workerBootstrap };
      } finally { await api.dispose(); }
    })()`);
    requireCondition(/ETHIOPIA/i.test(ocr?.text) && /WASHED/i.test(ocr?.text), `Live OCR text mismatch: ${JSON.stringify(ocr)}`);
    requireCondition(ocr.workerBootstrap === 'preloaded-blob-module', 'Live OCR must use the verified Worker');
    console.log("AromaSense live OCR recognition: PASS", JSON.stringify({ build: actualBuild, ...ocr }));
  }
  console.log(diagnostics(cdp).join("\n"));
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await delay(600);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  if (process.env.AROMASENSE_ACCEPTANCE_DEBUG === "1" && stderr) console.error(stderr);
}
