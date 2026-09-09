import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "app/ui/dom/home-action-enhancements.ts"), "utf8");

test("home action enhancement observer cannot synchronously retrigger its own scan", () => {
  assert.doesNotMatch(source, /new MutationObserver\(scan\)/);
  assert.match(source, /new MutationObserver\(scheduleScan\)/);
  assert.match(source, /observer\.disconnect\(\)/);
  assert.match(source, /observer\.observe\(document\.documentElement, observerOptions\)/);
  assert.match(source, /window\.setTimeout\(/);
});

test("home action text normalization is idempotent", () => {
  assert.match(source, /function setTextIfChanged/);
  assert.match(source, /setTextIfChanged\(batch, "批量录入"\)/);
  assert.match(source, /setTextIfChanged\(clear, "清空列表"\)/);
  assert.match(source, /setTextIfChanged\(manual, "文字录入"\)/);
  assert.match(source, /setTextIfChanged\(split, "分割识别"\)/);
  assert.match(source, /setTextIfChanged\(data, "数据导入"\)/);
  assert.match(source, /setTextIfChanged\(close, "关闭"\)/);
});
