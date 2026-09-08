import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const executableTesseractFallback = /TESSERACT_VERSION|TESSERACT_URL|ensureTesseract|createWorker\s*\(\s*\[?['"]chi_sim|cdn\.jsdelivr\.net\/npm\/tesseract/iu;

test("pinned Foundation OCR retries an opaque Blob Worker startup failure with the same PP-OCRv5 module worker", () => {
  const source = readFileSync("node_modules/luckybean-static-app/src/recognition-paddle-ocr.js", "utf8");
  assert.match(source, /Unknown worker error/);
  assert.match(source, /isOpaqueWorkerStartupFailure/);
  assert.match(source, /terminateModuleWorkers\(\)/);
  assert.match(source, /releaseWorkerBundle\(\)/);
  assert.match(source, /createWorkerEngine\(\{ direct:true \}\)/);
  assert.match(source, /workerBootstrapMode = 'direct-module-retry'/);
  assert.match(source, /from:'preloaded-blob-module', to:'direct-module'/);
  assert.match(source, /不会切换到 Tesseract 或其他未知 OCR/);
  assert.doesNotMatch(source, executableTesseractFallback);
});

test("pinned Foundation OCR falls back to same PP-OCRv5 low-memory WASM mode on allocation failure", () => {
  const source = readFileSync("node_modules/luckybean-static-app/src/recognition-paddle-ocr.js", "utf8");
  assert.match(source, /isWasmMemoryAllocationFailure/);
  assert.match(source, /startMemoryCompatibilityEngine/);
  assert.match(source, /direct-wasm-no-simd-low-memory/);
  assert.match(source, /rememberMemoryConstraint/);
  assert.match(source, /simd:compatibility \? false : true/);
  assert.match(source, /numThreads:1/);
  assert.match(source, /currentLimitSide\(\)/);
  assert.match(source, /currentMaxSide\(\)/);
  assert.doesNotMatch(source, executableTesseractFallback);
});
