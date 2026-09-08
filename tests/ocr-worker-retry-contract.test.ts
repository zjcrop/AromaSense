import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("pinned Foundation OCR retries an opaque Blob Worker startup failure with the same PP-OCRv5 module worker", () => {
  const source = readFileSync("node_modules/luckybean-static-app/src/recognition-paddle-ocr.js", "utf8");
  assert.match(source, /Unknown worker error/);
  assert.match(source, /isOpaqueWorkerStartupFailure/);
  assert.match(source, /createWorkerEngine\(\{ direct:true \}\)/);
  assert.match(source, /Blob Worker 启动失败，正在用同一 PP-OCRv5 同源 Worker 重试/);
  assert.match(source, /不会切换到 Tesseract 或其他未知 OCR/);
  assert.doesNotMatch(source, /tesseract\.js/i);
});
