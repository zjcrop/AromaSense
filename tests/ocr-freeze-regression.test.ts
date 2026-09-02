import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = readFileSync("package.json", "utf8");
const commonEntry = readFileSync("app/vendor/luckybean-recognition-entry.js", "utf8");
const buildScript = readFileSync("scripts/build-web.mjs", "utf8");
const preview = readFileSync("app/ui/dom/image-preview-data.ts", "utf8");
const mobileCss = readFileSync("app/ui/dom/mobile-ocr-emergency.css", "utf8");
const template = readFileSync("web/index.template.html", "utf8");

const executableImageWork = /createImageBitmap\s*\(|createElement\s*\(\s*['"]canvas['"]|\.toDataURL\s*\(|getImageData\s*\(|new\s+FileReader\s*\(/;

test("AromaSense pins an immutable LuckyBean Worker-only OCR safety release", () => {
  assert.match(packageJson, /github:zjcrop\/luckybean#[0-9a-f]{40}/);
  assert.doesNotMatch(commonEntry, /recognition-web-ocr\.js/);
  assert.doesNotMatch(commonEntry, /recognition-quality-controller\.js/);
  assert.match(commonEntry, /recognition-paddle-ocr\.js/);
  assert.match(buildScript, /1\.24B-recognition-pipeline\.2/);
  assert.match(buildScript, /candidateCoreCode/);
  assert.match(buildScript, /manualConfirmationRequired/);
  assert.match(buildScript, /historicalCoreCompatibility/);
});

test("recognition path never decodes or re-encodes full images on the UI thread", () => {
  assert.match(commonEntry, /__LUCKYBEAN_ANDROID__/);
  assert.match(commonEntry, /nativeSource:\s*android/);
  assert.match(commonEntry, /native-direct/);
  assert.match(commonEntry, /worker-direct/);
  assert.doesNotMatch(commonEntry, executableImageWork);
  assert.match(preview, /return Promise\.resolve\(["']{2}\)/);
  assert.doesNotMatch(preview, executableImageWork);
});

test("mobile capture, batch recognition and manual input remain on one row", () => {
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobileCss, /\.batch-setup__capture-actions \.batch-setup__add/);
  assert.match(mobileCss, /grid-column:\s*auto/);
  assert.match(template, /mobile-ocr-emergency\.css/);
});
