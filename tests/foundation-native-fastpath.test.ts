import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("node_modules/luckybean-static-app/src/image-quality.js", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };

test("AromaSense is pinned to the isolated LuckyBean native OCR fast-path backport", () => {
  assert.equal(
    pkg.dependencies?.["luckybean-static-app"],
    "github:zjcrop/luckybean#77d131961ccf06ca6cdb46e92a701f42bb34a6cc"
  );
  assert.match(source, /function nativeRecognitionAvailable\(\)/);
  assert.match(source, /if \(nativeRecognitionAvailable\(\)\) return nativeSource\(file\)/);
  assert.match(source, /跳过 WebView 解码、像素扫描与 JPEG 重编码/);
});
