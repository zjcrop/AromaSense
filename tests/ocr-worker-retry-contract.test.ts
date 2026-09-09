import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const executableTesseractFallback = /TESSERACT_VERSION|TESSERACT_URL|ensureTesseract|createWorker\s*\(\s*\[?['"]chi_sim|cdn\.jsdelivr\.net\/npm\/tesseract/iu;

test("pinned Foundation OCR retries an opaque Blob Worker startup failure with the same PP-OCRv5 module worker", () => {
  const source = readFileSync("node_modules/luckybean-static-app/src/recognition-paddle-ocr-fast.js", "utf8");
  assert.match(source, /Unknown worker error/);
  assert.match(source, /looksLikeCompatibilityFailure/);
  assert.match(source, /terminateWorkers\(\)/);
  assert.match(source, /releaseWorkerBundle\(\)/);
  assert.match(source, /startWorkerWithMode\(true, generation, startedAt/);
  assert.match(source, /workerBootstrapMode = 'direct-module-fallback'/);
  assert.match(source, /worker-simd-fastpath->worker-no-simd-on-real-failure/);
  assert.match(source, /不会切换到 Tesseract 或其他未知 OCR/);
  assert.doesNotMatch(source, executableTesseractFallback);
});

test("pinned Foundation OCR retries real WASM allocation failure in the same no-SIMD Worker", () => {
  const source = readFileSync("node_modules/luckybean-static-app/src/recognition-paddle-ocr-fast.js", "utf8");
  assert.match(source, /looksLikeCompatibilityFailure/);
  assert.match(source, /WebAssembly\|WASM\|out of memory\|could not allocate memory/);
  assert.match(source, /forceWorker:true/);
  assert.match(source, /terminateWorkers\(\)/);
  assert.match(source, /forceCompatibility = true/);
  assert.match(source, /simd:!compatibility/);
  assert.match(source, /numThreads:1/);
  assert.match(source, /const LIMIT_SIDE = LOW_MEMORY \? 736 : 960/);
  assert.match(source, /const MAX_SIDE = 2200/);
  assert.match(source, /不会切换到 Tesseract 或其他未知 OCR/);
  assert.doesNotMatch(source, executableTesseractFallback);
});
