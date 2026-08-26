import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = readFileSync("package.json", "utf8");
const commonEntry = readFileSync("app/vendor/luckybean-recognition-entry.js", "utf8");
const preview = readFileSync("app/ui/dom/image-preview-data.ts", "utf8");
const mobileCss = readFileSync("app/ui/dom/mobile-ocr-emergency.css", "utf8");
const template = readFileSync("web/index.template.html", "utf8");

test("AromaSense pins LuckyBean emergency Worker-only OCR release", () => {
  assert.match(packageJson, /4d5df7e1d66c9e23195da4cd54338b8f3d333428/);
  assert.doesNotMatch(commonEntry, /recognition-web-ocr\.js/);
  assert.match(commonEntry, /recognition-paddle-ocr\.js/);
});

test("Android OCR bypasses WebView preprocessing and Base64 image transport", () => {
  assert.match(commonEntry, /__LUCKYBEAN_ANDROID__/);
  assert.match(commonEntry, /nativeSource:\s*true/);
  assert.match(commonEntry, /status:\s*['"]native-direct['"]/);
  assert.match(preview, /isAndroidNativeRuntime\(\)/);
  assert.match(preview, /return Promise\.resolve\(["']{2}\)/);
});

test("mobile capture, batch recognition and manual input remain on one row", () => {
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobileCss, /\.batch-setup__capture-actions \.batch-setup__add/);
  assert.match(mobileCss, /grid-column:\s*auto/);
  assert.match(template, /mobile-ocr-emergency\.css/);
});
