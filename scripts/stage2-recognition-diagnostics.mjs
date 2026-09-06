import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const site = resolve(root, "site");
const benchmarkOutput = resolve(site, "stage2-recognition-diagnostics.js");
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
  throw new Error("Chrome/Chromium is required for Stage 2 recognition diagnostics");
}

async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  requireCondition(address && typeof address === "object", "Unable to allocate Stage 2 port");
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
  requireCondition(address && typeof address === "object", "Stage 2 server did not expose port");
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
    entryPoints: [resolve(root, "tests/stage2-recognition-browser-benchmark.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["chrome120"],
    outfile: benchmarkOutput,
    loader: { ".sql": "text" },
    logLevel: "warning"
  });
}

function isKnownOnnxWarning(message) {
  const text = String(message || "");
  return /\[W:onnxruntime[:,]/i.test(text) && /CleanUnusedInitializersAndNodeArgs|Removing initializer/i.test(text);
}

function validTiming(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

async function run() {
  await buildBenchmarkBundle();
  const { server, url } = await startStaticServer();
  const executable = chromeExecutable();
  const port = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), "aromasense-stage2-recognition-"));
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
      script.src = './stage2-recognition-diagnostics.js';
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('Stage 2 benchmark bundle failed to load'));
      document.head.append(script);
    })`);
    await waitUntil(async () => Boolean(await cdp.evaluate("Boolean(globalThis.Stage2AromaSenseBenchmark?.run)")), "Stage 2 benchmark API", 20_000);
    const result = await cdp.evaluate("globalThis.Stage2AromaSenseBenchmark.run()");

    requireCondition(result?.fixtureKind === "deterministic-camera-like-jpeg", "Unexpected Stage 2 fixture kind");
    requireCondition(result?.runtime?.browserSafe === true, "Stage 2 requires LuckyBean browserSafe=true");
    requireCondition(result?.runtime?.workerOnly === false, "Stage 2 current provider must not advertise legacy workerOnly=true");
    requireCondition(["module-worker", "webkit-direct-wasm-no-simd"].includes(result?.runtime?.primaryIsolation), `Unsupported Stage 2 primaryIsolation: ${result?.runtime?.primaryIsolation}`);
    requireCondition(result?.runtime?.autoPreload === false, "Stage 2 current provider must keep autoPreload=false");
    requireCondition(result?.semanticCanonicalSplitAvailable === true, "Stage 2 semantic/canonical timing split is unavailable");
    requireCondition(result?.singleCold?.samples >= 1, "Stage 2 single cold fixture produced no sample");
    requireCondition(result?.multiEntryWarm?.samples >= 2, `Stage 2 multi-entry fixture produced ${result?.multiEntryWarm?.samples ?? 0} sample(s)`);

    for (const item of [result.singleCold, result.multiEntryWarm]) {
      for (const key of [
        "imagePreparationMs", "ocrMs", "ocrRuntimeInitMs", "ocrPredictMs",
        "layoutDocumentMs", "primarySegmentationMs", "recordGroupingRefinementMs",
        "recognitionDocumentMs", "semanticMs", "canonicalMs", "aiMs",
        "analysisEnvelopeMs", "totalRecognitionMs"
      ]) requireCondition(validTiming(item?.[key]), `Invalid Stage 2 ${key}`);
      requireCondition(Number(item.ocrPredictMs) > 0, "Stage 2 OCR predict timing was not captured by LuckyBean diagnostic sink");
      requireCondition(Number(item.semanticMs) > 0, "Stage 2 semantic timing was not captured by LuckyBean diagnostic sink");
    }
    requireCondition(Number(result.singleCold.ocrRuntimeInitMs) > 0, "Stage 2 cold case did not capture runtime initialization");
    requireCondition(Number(result.multiEntryWarm.ocrRuntimeInitMs) === 0, "Stage 2 warm case unexpectedly reinitialized OCR runtime");
    requireCondition(validTiming(result.persistenceMs) && Number(result.persistenceMs) > 0, "Stage 2 DB persistence timing invalid");
    requireCondition(validTiming(result.uiRenderMs) && Number(result.uiRenderMs) > 0, "Stage 2 UI timing invalid");

    console.log(`STAGE2_AROMASENSE_RECOGNITION_DIAGNOSTICS ${JSON.stringify(result)}`);
    const relevantErrors = cdp.errors
      .filter((message) => /recognition|paddle|onnx|sqlite|stage 2|diagnostic/i.test(String(message)))
      .filter((message) => !isKnownOnnxWarning(message));
    requireCondition(relevantErrors.length === 0, `Browser errors during Stage 2 diagnostics: ${relevantErrors.join(" | ")}`);
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
  console.error(`AromaSense Stage 2 recognition diagnostics failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
