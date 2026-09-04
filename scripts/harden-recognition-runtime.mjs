import vm from "node:vm";
import { cp, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pagesOut = resolve(root, "site");
const foundationOcrSource = resolve(root, "node_modules/luckybean-static-app/public/vendor/paddleocr");
const pagesOcrOut = resolve(pagesOut, "vendor/paddleocr");

const REQUIRED_ASSETS = [
  ["sdk.mjs", 10_000],
  ["worker.js", 100_000],
  ["models/PP-OCRv5_mobile_det_onnx_infer.tar", 1_000_000],
  ["models/PP-OCRv5_mobile_rec_onnx_infer.tar", 1_000_000],
  ["ort/ort-wasm-simd-threaded.mjs", 10_000],
  ["ort/ort-wasm-simd-threaded.wasm", 5_000_000],
  ["ort/ort-wasm-simd-threaded.jsep.mjs", 10_000],
  ["ort/ort-wasm-simd-threaded.jsep.wasm", 5_000_000]
];

async function assertAsset(relativePath, minimumBytes) {
  const info = await stat(resolve(pagesOcrOut, relativePath));
  if (!info.isFile() || info.size < minimumBytes) {
    throw new Error(`Foundation OCR asset invalid: ${relativePath} (${info.size} bytes)`);
  }
}

async function installPagesRuntime() {
  const sourceManifest = await stat(resolve(foundationOcrSource, "manifest.json"));
  if (!sourceManifest.isFile()) throw new Error("LuckyBean Foundation OCR vendor runtime was not prepared by dependency postinstall");
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
  for (const method of ["preparePackageImage", "recognizeCoffeeBag", "createRecognitionDocument", "analyzeRecognitionDocument"]) {
    if (typeof core?.[method] !== "function") {
      throw new Error(`Formal LuckyBean recognition core failed runtime smoke: ${method} is unavailable`);
    }
  }
  const paddle = context.LuckyBeanPaddleOCR;
  if (paddle?.workerOnly !== true || typeof paddle.runtimeBase !== "function") {
    throw new Error("Foundation PP-OCR Worker provider failed runtime smoke");
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
console.log("Foundation recognition runtime: executable core + same-origin PP-OCR assets verified");
