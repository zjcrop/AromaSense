import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = readFileSync("package.json", "utf8");
const parsedPackage = JSON.parse(packageJson) as { dependencies?: Record<string, string> };
const luckyBeanDependency = parsedPackage.dependencies?.["luckybean-static-app"] ?? "";
const commonEntry = readFileSync("app/vendor/luckybean-recognition-entry.js", "utf8");
const recognitionService = readFileSync("app/core/sample-recognition-service.ts", "utf8");
const buildScript = readFileSync("scripts/build-web.mjs", "utf8");
const runtimeHardener = readFileSync("scripts/harden-recognition-runtime.mjs", "utf8");
const roiRefinement = readFileSync("app/core/sample-roi-refinement.ts", "utf8");
const preview = readFileSync("app/ui/dom/image-preview-data.ts", "utf8");
const mobileCss = readFileSync("app/ui/dom/mobile-ocr-emergency.css", "utf8");
const template = readFileSync("web/index.template.html", "utf8");

const P3_OFFICIAL_PRODUCER_SHA = "f425ec658a44e021c5010db2996cc80808f137fa";
const executableImageWork = /createImageBitmap\s*\(|createElement\s*\(\s*['"]canvas['"]|\.toDataURL\s*\(|getImageData\s*\(|new\s+FileReader\s*\(/;
const executableTesseractFallback = /TESSERACT_VERSION|TESSERACT_URL|ensureTesseract|createWorker\s*\(\s*\[?['"]chi_sim|cdn\.jsdelivr\.net\/npm\/tesseract/iu;

test("AromaSense pins the exact immutable official LuckyBean Recognition producer", () => {
  assert.match(luckyBeanDependency, /^github:zjcrop\/luckybean#[0-9a-f]{40}$/u);
  assert.equal(luckyBeanDependency, `github:zjcrop/luckybean#${P3_OFFICIAL_PRODUCER_SHA}`);
  assert.doesNotMatch(luckyBeanDependency, /9bbf1060bee69fce417470d0fb2c5b68403fa3b8/u);
  assert.doesNotMatch(commonEntry, /recognition-web-ocr\.js/);
  assert.doesNotMatch(commonEntry, /recognition-quality-controller\.js/);
  assert.match(commonEntry, /recognition-paddle-ocr\.js/);
  assert.match(commonEntry, /recognizeImageRegion/);
  assert.match(commonEntry, /normalizeRecognitionRegion/);
  assert.match(commonEntry, /RECOGNITION_RECORD_HYPOTHESIS_SCHEMA/);
  assert.match(commonEntry, /RECOGNITION_STRUCTURE_RECOVERY_SCHEMA/);
  assert.match(commonEntry, /AI_STRUCTURE_RESULT_SCHEMA/);
  assert.match(commonEntry, /recoverRecognitionStructure/);
  assert.match(buildScript, /candidateCoreCode/);
  assert.match(buildScript, /manualConfirmationRequired/);
  assert.match(buildScript, /historicalCoreCompatibility/);
  assert.match(buildScript, /knowledgeOnlyVariety/);
  assert.match(buildScript, /qrCoreCode/);
  assert.match(buildScript, /productionCoreApproved/);
  assert.match(runtimeHardener, /browserSafe/);
  assert.match(runtimeHardener, /primaryIsolation/);
  assert.match(runtimeHardener, /module-worker/);
  assert.match(runtimeHardener, /webkit-direct-wasm-no-simd/);
  assert.match(runtimeHardener, /autoPreload/);
  assert.match(runtimeHardener, /CoffeeFoundationOcrAssetBase/);
  assert.match(runtimeHardener, /vendor\/paddleocr/);
  assert.match(runtimeHardener, /roi-worker\.js/);
  assert.match(runtimeHardener, /recognition-roi\/1\.0/);
  assert.match(runtimeHardener, /vm\.runInNewContext/);
  assert.match(runtimeHardener, /Formal LuckyBean recognition core failed runtime smoke/);
});

test("recognition path never decodes or re-encodes full images on the UI thread", () => {
  assert.match(commonEntry, /__LUCKYBEAN_ANDROID__/);
  assert.match(commonEntry, /nativeSource:\s*android/);
  assert.match(commonEntry, /native-direct/);
  assert.match(commonEntry, /runtime-direct/);
  assert.doesNotMatch(commonEntry, executableImageWork);
  assert.doesNotMatch(recognitionService, executableTesseractFallback);
  assert.doesNotMatch(recognitionService, executableImageWork);
  assert.doesNotMatch(roiRefinement, executableImageWork);
  assert.match(roiRefinement, /recognizeImageRegion/);
  assert.match(roiRefinement, /recognition-roi\/1\.0/);
  assert.match(preview, /return Promise\.resolve\(["']{2}\)/);
  assert.doesNotMatch(preview, executableImageWork);
});

test("mobile capture, batch recognition and manual input remain on one row", () => {
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobileCss, /\.batch-setup__capture-actions \.batch-setup__add/);
  assert.match(mobileCss, /grid-column:\s*auto/);
  assert.match(template, /mobile-ocr-emergency\.css/);
});
