import vm from "node:vm";
import { cp, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const pagesOut = resolve(root, "site");
const foundationPackage = resolve(root, "node_modules/luckybean-static-app");
const foundationOcrSource = resolve(foundationPackage, "public/vendor/paddleocr");
const pagesOcrOut = resolve(pagesOut, "vendor/paddleocr");

const REQUIRED_ASSETS = [
  ["sdk.mjs", 10_000],
  ["worker.js", 100_000],
  ["roi-worker.js", 1_000],
  ["models/PP-OCRv5_mobile_det_onnx_infer.tar", 1_000_000],
  ["models/PP-OCRv5_mobile_rec_onnx_infer.tar", 1_000_000],
  ["ort/ort-wasm-simd-threaded.mjs", 10_000],
  ["ort/ort-wasm-simd-threaded.wasm", 5_000_000],
  ["ort/ort-wasm-simd-threaded.jsep.mjs", 10_000],
  ["ort/ort-wasm-simd-threaded.jsep.wasm", 5_000_000]
];

async function existsFile(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function ensureFoundationRuntimePrepared() {
  const manifestPath = resolve(foundationOcrSource, "manifest.json");
  const roiWorkerPath = resolve(foundationOcrSource, "roi-worker.js");
  if (await existsFile(manifestPath) && await existsFile(roiWorkerPath)) return;

  // npm 11 may deliberately suppress git-dependency lifecycle scripts unless
  // they are explicitly approved. Do not rely on LuckyBean's postinstall for a
  // production-critical OCR runtime: execute the pinned Foundation preparer as
  // an explicit AromaSense build step when generated assets are absent/incomplete.
  const preparer = resolve(foundationPackage, "scripts/prepare-paddleocr-vendor.mjs");
  if (!(await existsFile(preparer))) {
    throw new Error("Pinned LuckyBean package does not contain the Foundation PP-OCR vendor preparer");
  }
  console.log("Foundation OCR assets absent/incomplete after npm install; preparing pinned same-origin runtime explicitly...");
  await import(`${pathToFileURL(preparer).href}?aromasense=${Date.now()}`);
  if (!(await existsFile(manifestPath)) || !(await existsFile(roiWorkerPath))) {
    throw new Error("LuckyBean Foundation OCR vendor preparer completed without ROI runtime assets");
  }
}

async function assertAsset(relativePath, minimumBytes) {
  const info = await stat(resolve(pagesOcrOut, relativePath));
  if (!info.isFile() || info.size < minimumBytes) {
    throw new Error(`Foundation OCR asset invalid: ${relativePath} (${info.size} bytes)`);
  }
}

async function installPagesRuntime() {
  await ensureFoundationRuntimePrepared();
  await cp(foundationOcrSource, pagesOcrOut, { recursive: true, force: true });
  await Promise.all(REQUIRED_ASSETS.map(([relativePath, minimumBytes]) => assertAsset(relativePath, minimumBytes)));
}

async function configurePagesRuntime() {
  const indexPath = resolve(pagesOut, "index.html");
  let html = await readFile(indexPath, "utf8");
  const coreTagPattern = /<script src="luckybean-recognition-core\.js\?v=[^"]+"><\/script>/;
  const coreTag = html.match(coreTagPattern)?.[0];
  if (!coreTag) throw new Error("Pages recognition core script tag is missing");

  const baseBootstrap = `<script data-coffee-foundation-ocr-base>globalThis.CoffeeFoundationOcrAssetBase=new URL("vendor/paddleocr/",document.baseURI).href;</script>`;
  html = html.replace(/\s*<script data-coffee-foundation-ocr-base>[\s\S]*?<\/script>/g, "");
  html = html.replace(coreTag, `  ${baseBootstrap}\n  ${coreTag}`);
  await writeFile(indexPath, html, "utf8");

  const baseIndex = html.indexOf("data-coffee-foundation-ocr-base");
  const coreIndex = html.indexOf("luckybean-recognition-core.js");
  if (baseIndex < 0 || coreIndex < 0 || baseIndex > coreIndex) {
    throw new Error("Foundation OCR asset base must be configured before the formal recognition core loads");
  }
}

function createRuntimeContext() {
  const context = {
    URL,
    Blob: globalThis.Blob,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    structuredClone: globalThis.structuredClone,
    console,
    navigator: { deviceMemory: 8, userAgent: "AromaSense-CI" },
    location: { href: "https://example.test/AromaSense/" },
    document: {
      baseURI: "https://example.test/AromaSense/",
      hidden: false,
      addEventListener() {},
      documentElement: { dataset: {} }
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    Worker: class Worker {},
    Image: class Image {},
    HTMLCanvasElement: class HTMLCanvasElement {},
    OffscreenCanvas: class OffscreenCanvas {},
    createImageBitmap: async () => ({}),
    fetch: async () => { throw new Error("runtime smoke must not fetch during initialization"); },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
    requestIdleCallback() { return 1; },
    cancelIdleCallback() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    CoffeeFoundationOcrAssetBase: "https://example.test/AromaSense/vendor/paddleocr/"
  };
  context.globalThis = context;
  context.window = context;
  context.self = context;
  return context;
}

async function executeRecognitionCoreSmoke() {
  const corePath = resolve(pagesOut, "luckybean-recognition-core.js");
  const source = await readFile(corePath, "utf8");
  const context = createRuntimeContext();
  vm.runInNewContext(source, context, {
    filename: "luckybean-recognition-core.js",
    timeout: 5000
  });

  const core = context.LuckyBeanRecognitionCore;
  for (const method of [
    "preparePackageImage",
    "recognizeCoffeeBag",
    "recognizeImageRegion",
    "normalizeRecognitionRegion",
    "createRecognitionDocument",
    "analyzeRecognitionDocument"
  ]) {
    if (typeof core?.[method] !== "function") {
      throw new Error(`Formal LuckyBean recognition core failed runtime smoke: ${method} is unavailable`);
    }
  }
  const normalized = core.normalizeRecognitionRegion({ left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 });
  if (normalized.left !== 0.1 || normalized.bottom !== 0.9) {
    throw new Error("Foundation recognition-roi/1.0 normalization failed runtime smoke");
  }

  const paddle = context.LuckyBeanPaddleOCR;
  if (
    paddle?.workerOnly !== true ||
    paddle?.roiWorkerOnly !== true ||
    paddle?.regionRecognition !== "recognition-roi/1.0" ||
    typeof paddle?.recognizeRegion !== "function" ||
    typeof paddle?.runtimeBase !== "function"
  ) {
    throw new Error("Foundation PP-OCR Worker/ROI provider failed runtime smoke");
  }
  const actualBase = paddle.runtimeBase();
  const expectedBase = "https://example.test/AromaSense/vendor/paddleocr/";
  if (actualBase !== expectedBase) {
    throw new Error(`Foundation OCR runtime base mismatch: ${actualBase} != ${expectedBase}`);
  }
}

await installPagesRuntime();
await configurePagesRuntime();
await executeRecognitionCoreSmoke();
console.log("Foundation recognition runtime: executable core + same-origin PP-OCR + ROI Worker assets verified");
