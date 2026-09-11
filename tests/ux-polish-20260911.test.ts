import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("left active rail keeps the fill but removes the gold outline", () => {
  const source = readFileSync("app/ui/dom/cupping-cup-selection-hotfix.ts", "utf8");
  assert.match(source, /\.sample-rail__item\.is-active::before,\.sample-rail__active-tab/);
  assert.match(source, /border:0!important/);
});

test("batch setup organizer is optional in the UI and defaults to self at submit", () => {
  const source = readFileSync("app/ui/dom/batch-setup-renderer.ts", "utf8");
  assert.match(source, /input\.required = false/);
  assert.match(source, /不填默认为自己/);
  assert.match(source, /input\.value = "自己"/);
  assert.match(source, /start\.addEventListener\("click", applyDefault/);
});

test("batch photo source chooser mirrors the compact manual split source dialog", () => {
  const source = readFileSync("app/ui/dom/import-source-dialog.ts", "utf8");
  const css = readFileSync("app/ui/dom/import-0.1c.css", "utf8");
  assert.match(source, /选择图片来源/);
  assert.match(source, /photoChoiceButton\("拍照"/);
  assert.match(source, /photoChoiceButton\("上传图片"/);
  assert.match(source, /overlay\.classList\.add\("is-photo-choice"\)/);
  assert.match(css, /\.import-source__panel\.is-photo-choice\{width:min\(420px,100%\)/);
  assert.match(css, /\.import-source__photo-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("non-uniform and defective cups use grey-to-white square selectors with aligned numbering", () => {
  const source = readFileSync("app/ui/dom/cupping-cup-selection-hotfix.ts", "utf8");
  assert.match(source, /buildCupSelector\(host, fields\[0\], "非一致性"[\s\S]*"top"\)/);
  assert.match(source, /buildCupSelector\(host, fields\[1\], "缺陷杯数"[\s\S]*"bottom"\)/);
  assert.match(source, /control\.textContent = ""/);
  assert.match(source, /control\.dataset\.cupIndex = String\(index\)/);
  assert.match(source, /background:#5b5b5b/);
  assert.match(source, /border-color:#ffffff;background:#f4f4f4/);
  assert.match(source, /function buildNumberRow\(capacity: number, position: NumberPosition\)/);
  assert.match(source, /number\.textContent = String\(index\)/);
  assert.match(source, /final-assessment__cup-number-row is-\$\{position\}/);
  assert.match(source, /add\.textContent = "\+"/);
  assert.match(source, /persistCapacity\(host, capacity \+ 1\)/);
  assert.match(source, /SCA_NON_UNIFORM_CUP_IDS_FIELD/);
  assert.match(source, /SCA_DEFECTIVE_CUP_IDS_FIELD/);
  assert.match(source, /SCA_CUP_CAPACITY_FIELD/);
  assert.doesNotMatch(source, /border-color:#d0ad62;background:#b9995a/);
  assert.doesNotMatch(source, /未选择即为 0/);
});

test("web runtime loads cup selector hotfix after all previous cupping patches", () => {
  const source = readFileSync("app/runtime/web-entry.ts", "utf8");
  const mobile = source.indexOf('import "../ui/dom/cupping-mobile-browser-hotfix";');
  const cups = source.indexOf('import "../ui/dom/cupping-cup-selection-hotfix";');
  assert.ok(mobile >= 0);
  assert.ok(cups > mobile);
});
