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
  const verifier = resolve(foundationPackage, "scripts/verify-ocr-runtime.mjs");
  await import(pathToFileURL(verifier).href);
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

// Legacy pinned Foundation 0.4.12 needed a downstream predict-time ONNX recovery
// patch. The restored 0.5.x session fast path carries that recovery natively, so
// this remains only as a compatibility guard while the immutable package pin is
// still used to supply model/runtime assets.
async function patchDelayedOnnxSessionRecovery() {
  const corePath = resolve(pagesOut, "luckybean-recognition-core.js");
  let source = await readFile(corePath, "utf8");
  if (source.includes("predict-runtime-recovery-success")) {
    console.log("Recognition bundle already contains predict-time runtime recovery; downstream hotfix skipped");
    return;
  }
  if (!source.includes("const VERSION = '0.4.12';")) {
    throw new Error("Recognition provider changed without native predict-time runtime recovery; refusing an unverified OCR bundle");
  }

  const oldBlock = `async function predict(images) {
  const ocr = await ensureEngine(); const blocks = [], groups = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]; emit(\`PP-OCRv5 正在识别第 \${index + 1}/\${images.length} 张图片\`, 20 + Math.round(index / Math.max(1, images.length) * 70));
    const diagnosticStarted = diagnosticNow();
    const prediction = ocr.predict(image.blob, { textDetLimitSideLen:currentLimitSide(), textDetLimitType:'min', textDetMaxSideLimit:currentMaxSide(), textDetThresh:0.22, textDetBoxThresh:0.35, textDetUnclipRatio:1.55, textRecScoreThresh:0.28 });
    const results = await withTimeout(prediction, PREDICT_TIMEOUT_MS, \`PP-OCRv5 第 \${index + 1} 张图片识别超时，已退出本次任务\`, detachEngine);`;

  const newBlock = `async function predict(images) {
  let ocr = await ensureEngine(); const blocks = [], groups = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]; emit(\`PP-OCRv5 正在识别第 \${index + 1}/\${images.length} 张图片\`, 20 + Math.round(index / Math.max(1, images.length) * 70));
    const diagnosticStarted = diagnosticNow();
    const predictOptions = { textDetLimitSideLen:currentLimitSide(), textDetLimitType:'min', textDetMaxSideLimit:currentMaxSide(), textDetThresh:0.22, textDetBoxThresh:0.35, textDetUnclipRatio:1.55, textRecScoreThresh:0.28 };
    let results;
    try {
      const prediction = ocr.predict(image.blob, predictOptions);
      results = await withTimeout(prediction, PREDICT_TIMEOUT_MS, \`PP-OCRv5 第 \${index + 1} 张图片识别超时，已退出本次任务\`, detachEngine);
    } catch (predictError) {
      const onnxFailure = isOnnxSessionCreationFailure(predictError);
      const memoryFailure = isWasmMemoryAllocationFailure(predictError);
      if (!onnxFailure && !memoryFailure) throw predictError;
      recordDiagnostic('predict-runtime-recovery', diagnosticStarted, { reason:String(predictError?.message || predictError), kind:onnxFailure ? 'onnx-session' : 'wasm-memory', imageIndex:index });
      if (onnxFailure) rememberRuntimeCompatibilityConstraint();
      if (memoryFailure) rememberMemoryConstraint();
      detachEngine();
      emit(onnxFailure ? '预测阶段 ONNX session 创建失败，正在切换同一 PP-OCRv5 无 SIMD WASM 兼容模式' : '预测阶段 WASM 内存不足，正在切换同一 PP-OCRv5 低内存模式', 12);
      await delay(80);
      ocr = await ensureEngine();
      const retryPrediction = ocr.predict(image.blob, predictOptions);
      results = await withTimeout(retryPrediction, PREDICT_TIMEOUT_MS, \`PP-OCRv5 第 \${index + 1} 张图片兼容模式重试超时，已退出本次任务\`, detachEngine);
      recordDiagnostic('predict-runtime-recovery-success', diagnosticStarted, { kind:onnxFailure ? 'onnx-session' : 'wasm-memory', imageIndex:index, mode:engineMode });
    }`;

  const occurrences = source.split(oldBlock).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Foundation predict-time recovery patch anchor mismatch: ${occurrences}`);
  }
  source = source.replace(oldBlock, newBlock);
  await writeFile(corePath, source, "utf8");
  const verified = await readFile(corePath, "utf8");
  if (!verified.includes("predict-runtime-recovery-success") || !verified.includes("rememberRuntimeCompatibilityConstraint()")) {
    throw new Error("AromaSense predict-time ONNX recovery hotfix did not materialize in the production bundle");
  }
  console.log("AromaSense downstream hotfix: predict-time ONNX session recovery installed for legacy pinned Foundation 0.4.12");
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
      querySelector() { return null; },
      documentElement: { dataset: {} }
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    Worker: class Worker { terminate() {} },
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
  vm.runInNewContext(source, context, { filename: "luckybean-recognition-core.js", timeout: 5000 });

  const core = context.LuckyBeanRecognitionCore;
  for (const method of [
    "preparePackageImage",
    "recognizeCoffeeBag",
    "recognizeImageRegion",
    "normalizeRecognitionRegion",
    "createRecognitionDocument",
    "analyzeRecognitionDocument",
    "beginOcrSession",
    "endOcrSession"
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
  const safePrimaryIsolation = paddle?.primaryIsolation === "module-worker" || paddle?.primaryIsolation === "webkit-direct-wasm-no-simd";
  const acceptedFallback = [
    "direct-module-worker-wasm-no-simd-low-memory->direct-wasm-no-simd-last-resort",
    "worker-simd-fastpath->worker-no-simd-on-real-failure",
    "webkit-direct-wasm-no-simd"
  ].includes(paddle?.memoryFallback);
  if (
    paddle?.browserSafe !== true ||
    paddle?.workerOnly !== false ||
    !safePrimaryIsolation ||
    paddle?.autoPreload !== false ||
    paddle?.roiWorkerOnly !== true ||
    paddle?.regionRecognition !== "recognition-roi/1.0" ||
    !acceptedFallback ||
    typeof paddle?.recognizeRegion !== "function" ||
    typeof paddle?.runtimeBase !== "function" ||
    (String(paddle?.version || "").includes("fastpath") && paddle?.disposePolicy !== "capture-session") ||
    (String(paddle?.version || "").includes("fastpath") && !String(paddle?.inputPolicy || "").endsWith("/2200"))
  ) {
    throw new Error("Foundation PP-OCR browser-safe provider/ROI/session-fastpath contract failed runtime smoke");
  }
  const actualBase = paddle.runtimeBase();
  const expectedBase = "https://example.test/AromaSense/vendor/paddleocr/";
  if (actualBase !== expectedBase) {
    throw new Error(`Foundation OCR runtime base mismatch: ${actualBase} != ${expectedBase}`);
  }

  const hasNativeRecovery = source.includes("predict-runtime-recovery-success") && source.includes("forceCompatibility = true");
  const hasLegacyRecovery = source.includes("predict-runtime-recovery-success") && source.includes("rememberRuntimeCompatibilityConstraint()");
  if (!hasNativeRecovery && !hasLegacyRecovery) {
    throw new Error("Production recognition core is missing predict-time runtime recovery");
  }
}

await installPagesRuntime();
await configurePagesRuntime();
await patchDelayedOnnxSessionRecovery();
await executeRecognitionCoreSmoke();
console.log("Foundation recognition runtime: session-scoped fast path + native predict recovery + 2200px detector budget + same-origin ROI Worker assets verified");
