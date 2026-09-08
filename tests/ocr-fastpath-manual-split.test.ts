import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync("app/vendor/recognition-paddle-ocr-fast.js", "utf8");
const entry = readFileSync("app/vendor/luckybean-recognition-entry.js", "utf8");
const lifecycle = readFileSync("app/runtime/recognition-session-lifecycle.ts", "utf8");
const split = readFileSync("app/ui/dom/manual-split-photo-mode.ts", "utf8");
const webEntry = readFileSync("app/runtime/web-entry.ts", "utf8");

test("AromaSense restores PP-OCRv5 SIMD fast path at the full 2200px detector budget", () => {
  assert.match(provider, /const LIMIT_SIDE = LOW_MEMORY \? 736 : 960/);
  assert.match(provider, /const MAX_SIDE = 2200/);
  assert.match(provider, /worker-simd-fastpath/);
  assert.match(provider, /worker-no-simd-on-real-failure/);
  assert.match(provider, /predict-runtime-recovery-success/);
  assert.doesNotMatch(provider, /textDetMaxSideLimit\s*:\s*LOW_MEMORY\s*\?\s*1280/);
  assert.match(entry, /const WEB_OCR_MAX_EDGE = 2200/);
});

test("OCR runtime is acquired for the add flow and released when batch setup exits", () => {
  assert.match(lifecycle, /batch-setup__capture-actions/);
  assert.match(lifecycle, /beginOcrSession/);
  assert.match(lifecycle, /!document\.querySelector\("\.batch-setup"\)/);
  assert.match(lifecycle, /endOcrSession/);
  assert.match(entry, /let ocrSessionOwned = false/);
  assert.match(entry, /if \(ocrSessionOwned\) return provider\?\.warmForRecognition/);
  assert.match(provider, /disposePolicy:'capture-session'/);
  assert.match(webEntry, /recognition-session-lifecycle/);
});

test("manual split photo mode crops before OCR and reuses the existing multi-image recognition input", () => {
  assert.match(split, /手工切分拍照/);
  assert.match(split, /createSegmentationImagePreview/);
  assert.match(split, /createReviewedRegionCropBatch/);
  assert.match(split, /regions\.push/);
  assert.match(split, /input\.multiple && !input\.hasAttribute\("capture"\)/);
  assert.match(split, /new DataTransfer\(\)/);
  assert.match(split, /gallery\.dispatchEvent\(new Event\("change"/);
  assert.match(split, /capture.*environment/s);
  assert.match(webEntry, /manual-split-photo-mode/);
});
