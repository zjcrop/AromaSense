import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Final deployment gate: static contracts here are paired with the real 30-sample Chrome rail acceptance.
test("cupping rail hides its scrollbar and renders a separate floating current-item layer below active text", () => {
  const source = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
  assert.match(source, /scrollbar-width:none!important/);
  assert.match(source, /cupping-rail-active-float/);
  assert.match(source, /host\.append\(marker\)/);
  assert.match(source, /list\.addEventListener\("scroll"/);
  assert.match(source, /sample-rail__item\.is-active::before\{content:none!important;display:none!important\}/);
  assert.match(source, /sample-rail__item\.is-active \.sample-rail__sample-name/);
  assert.match(source, /z-index:6!important/);
});

test("runtime bean recognition closes OCR busy state before review and persists a resumable draft", () => {
  const source = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
  assert.match(source, /saveRuntimeRecognitionDraft\(page, 0, \[\], preview\);[\s\S]*?setBusyProgress\(false, 100, ""\);[\s\S]*?openRecognitionReview/);
  assert.match(source, /aromasense\.runtime-recognition-draft\.v1/);
  assert.match(source, /localStorage\?\.setItem/);
  assert.match(source, /识别结果已暂存/);
  assert.match(source, /继续确认已识别豆子/);
  assert.match(source, /clearRuntimeRecognitionDraft\(\)/);
  assert.doesNotMatch(source, /setBusyProgress\(true, 80, `识别完成/);
});
