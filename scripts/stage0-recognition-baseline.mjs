import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const site = resolve(root, "site");
const benchmarkOutput = resolve(site, "stage0-recognition-benchmark.js");
const TIMEOUT_MS = 180_000;
const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".wasm", "application/wasm"],
  [".webp", "image/webp"], [".png", "image/png"], [".jpg", "image/jpeg"]
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function chromeExecutable() {
  for (const executable of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    if (spawnSync(executable, ["--version"], { encoding: "utf8" }).status === 0) return executable;
  }
  throw new Error("Chrome/Chromium is required for Stage 0 recognition benchmark");
}

async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Unable to allocate benchmark port");
  const port = address.port;
  await new Promise((ok) => server.close(ok));
  return port;
}

async function startStaticServer() {
  await stat(resolve(site, "index.html"));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
      const file = resolve(site, relative);
      if (file !== site && !file.startsWith(`${site}${sep}`)) return response.writeHead(403).end("forbidden");
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not-file");
      response.writeHead(200, {
        "content-type": MIME.get(extname(file).toLowerCase()) || "application/octet-stream",
        "cache-control": "no-store"
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    }
  });
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Static server did not expose port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function waitUntil(check, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`${label} timed out`);
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.errors = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => this.message(String(event.data)));
    await new Promise((ok, fail) => {
      this.ws.addEventListener("open", ok, { once: true });
      this.ws.addEventListener("error", () => fail(new Error("CDP websocket failed")), { once: true });
    });
  }
  message(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      return message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "runtime exception");
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") this.errors.push(message.params.entry.text);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluate failed");
    return result.result?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function buildBenchmarkBundle() {
  await build({
    entryPoints: [resolve(root, "tests/stage0-recognition-browser-benchmark.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["chrome120"],
    outfile: benchmarkOutput,
    loader: { ".sql": "text" },
    logLevel: "warning"
  });
}

async function run() {
  await buildBenchmarkBundle();
  const { server, url } = await startStaticServer();
  const executable = chromeExecutable();
  const port = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), "aromasense-stage0-recognition-"));
  const chrome = spawn(executable, [
    "--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox",
    "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let cdp;
  try {
    await waitUntil(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, "Chrome debugging startup", 30_000);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    requireCondition(targetResponse.ok, `Chrome target HTTP ${targetResponse.status}`);
    const target = await targetResponse.json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");

    await waitUntil(async () => Boolean(await cdp.evaluate("Boolean(globalThis.LuckyBeanRecognitionCore?.recognizeCoffeeBag)")), "LuckyBean recognition bootstrap", 45_000);
    await cdp.evaluate(`new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './stage0-recognition-benchmark.js';
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('Stage 0 benchmark bundle failed to load'));
      document.head.append(script);
    })`);
    await waitUntil(async () => Boolean(await cdp.evaluate("Boolean(globalThis.Stage0AromaSenseBenchmark?.run)")), "Stage 0 benchmark API", 20_000);
    const result = await cdp.evaluate("globalThis.Stage0AromaSenseBenchmark.run()");

    requireCondition(result?.fixtureKind === "deterministic-camera-like-jpeg", "Unexpected benchmark fixture kind");
    requireCondition(result?.single?.samples >= 1, "Single-sample fixture did not produce a sample");
    requireCondition(result?.multiEntry?.samples >= 2, `Multi-entry fixture produced only ${result?.multiEntry?.samples ?? 0} sample(s)`);
    for (const item of [result.single, result.multiEntry]) {
      for (const key of ["imagePreparationMs", "ocrMs", "layoutGroupMs", "canonicalMs", "totalRecognitionMs"]) {
        requireCondition(Number.isFinite(Number(item?.[key])) && Number(item[key]) >= 0, `Invalid ${key} benchmark value`);
      }
      requireCondition(Number(item.ocrMs) > 0, "OCR phase did not record positive elapsed time");
      requireCondition(Number(item.totalRecognitionMs) > 0, "Recognition total did not record positive elapsed time");
    }
    requireCondition(Number(result.persistenceMs) > 0, "SQLite persistence benchmark did not record positive elapsed time");
    requireCondition(result.persistedSamples === result.multiEntry.samples, "Persisted sample count differs from recognition result");
    requireCondition(Number(result.uiRenderMs) > 0, "Review UI render benchmark did not record positive elapsed time");
    requireCondition((result.uiFieldCount ?? 0) >= 1, "Review UI benchmark rendered no recognized fields");

    const relevantErrors = cdp.errors.filter((message) => /recognition|paddle|onnx|sqlite|benchmark/i.test(String(message)));
    requireCondition(relevantErrors.length === 0, `Browser errors during benchmark: ${relevantErrors.join(" | ")}`);
    console.log(`STAGE0_AROMASENSE_RECOGNITION_BASELINE ${JSON.stringify(result)}`);
  } finally {
    cdp?.close();
    chrome.kill("SIGKILL");
    await new Promise((resolveKill) => chrome.once("exit", resolveKill)).catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(profile, { recursive: true, force: true });
    await rm(benchmarkOutput, { force: true });
  }
}

run().catch((error) => {
  console.error(`AromaSense Stage 0 recognition benchmark failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
