import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const liveUrl = process.env.AROMASENSE_LIVE_URL || "https://zjcrop.github.io/AromaSense/";
const chromeBinary = process.env.CHROME_BIN || "google-chrome";
const userDataDir = await mkdtemp(join(tmpdir(), "aromasense-live-smoke-"));
const port = 9222 + Math.floor(Math.random() * 500);
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  liveUrl
], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
chrome.stderr.on("data", chunk => { stderr += chunk.toString(); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await json(`http://127.0.0.1:${port}/json`);
      const target = targets.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {}
    await delay(250);
  }
  throw new Error(`Chrome target unavailable\n${stderr}`);
}

class CDP {
  constructor(url) { this.socket = new WebSocket(url); this.sequence = 0; this.pending = new Map(); this.events = []; }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      } else this.events.push(message);
    });
  }
  command(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluation failed");
    return result.result?.value;
  }
  close() { try { this.socket.close(); } catch {} }
}

function diagnostics(cdp) {
  return cdp.events
    .filter(event => ["Runtime.exceptionThrown", "Log.entryAdded"].includes(event.method))
    .map(event => JSON.stringify(event));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function eventually(fn, label, timeoutMs = 30_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
      last = value;
    } catch (error) { last = error; }
    await delay(250);
  }
  throw new Error(`${label} timed out: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

let cdp;
try {
  const target = await waitForTarget();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.command("Runtime.enable");
  await cdp.command("Log.enable");
  await cdp.command("Page.enable");
  const state = await eventually(async () => {
    const current = await cdp.evaluate(`(() => ({
      screen: document.querySelector('#app')?.dataset.screen || '',
      progress: document.querySelector('.startup__progress-value')?.textContent || '',
      text: document.querySelector('#app')?.textContent?.slice(0, 300) || ''
    }))()`);
    return current?.screen === "setup" ? current : false;
  }, "live setup screen", 35_000);
  console.log("AromaSense live Pages smoke: PASS", JSON.stringify(state));
  if (process.env.AROMASENSE_VERIFY_OCR === "1") {
    const expectedBuild = (process.env.GITHUB_SHA || "").slice(0, 16);
    const actualBuild = await cdp.evaluate(`document.querySelector('meta[name="build-revision"]')?.content || ''`);
    requireCondition(!expectedBuild || actualBuild === expectedBuild, `Live build mismatch: ${actualBuild} != ${expectedBuild}`);
    const ocr = await cdp.evaluate(`(async () => {
      const api = globalThis.LuckyBeanPaddleOCR;
      if (api?.version !== '0.4.10') throw new Error('Expected worker-first low-memory PP-OCR 0.4.10 provider');
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
        return { text: result.fullText, blocks: result.blocks.length, version: api.version, workerBootstrap: api.workerBootstrap, memoryFallback: api.memoryFallback };
      } finally { await api.dispose(); }
    })()`);
    requireCondition(/ETHIOPIA/i.test(ocr?.text) && /WASHED/i.test(ocr?.text), `Live OCR text mismatch: ${JSON.stringify(ocr)}`);
    requireCondition(ocr.workerBootstrap === 'preloaded-blob-module', 'Live OCR must use the verified Worker');
    requireCondition(ocr.memoryFallback === 'direct-module-worker-wasm-no-simd-low-memory->direct-wasm-no-simd-last-resort', 'Live OCR must expose the worker-first low-memory fallback');
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
