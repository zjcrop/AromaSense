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

test("pinned Foundation OCR handles WebAssembly memory allocation failure with worker-first low-memory recovery", () => {
  const source = readFileSync("node_modules/luckybean-static-app/src/recognition-paddle-ocr.js", "utf8");
  assert.match(source, /isWasmMemoryAllocationFailure/);
  assert.match(source, /RangeError:\.\*WebAssembly\\\.Memory/);
  assert.match(source, /startMemoryCompatibilityEngine/);
  assert.match(source, /createLowMemoryWorkerEngine/);
  assert.match(source, /forceWorker:true/);
  assert.match(source, /direct-module-no-simd-memory-retry/);
  assert.match(source, /worker-direct-module-no-simd-low-memory/);
  assert.match(source, /MEMORY_WORKER_RECLAIM_DELAY_MS/);
  assert.match(source, /MEMORY_MAIN_THREAD_RECLAIM_DELAY_MS/);
  assert.match(source, /direct-wasm-no-simd-low-memory-last-resort/);
  assert.match(source, /rememberMemoryConstraint/);
  assert.match(source, /simd:compatibility \? false : true/);
  assert.match(source, /numThreads:1/);
  assert.match(source, /currentLimitSide\(\) \{ return memoryConstrained \? 512 : 960; \}/);
  assert.match(source, /currentMaxSide\(\) \{ return memoryConstrained \? 960 : 2200; \}/);
  assert.match(source, /不会切换到 Tesseract 或其他未知 OCR/);
  assert.doesNotMatch(source, executableTesseractFallback);
});
