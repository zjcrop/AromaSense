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

test("visible cup-comparison sliders are replaced by numbered grey-to-white cup squares", () => {
  const source = readFileSync("app/ui/dom/cupping-cup-selection-hotfix.ts", "utf8");
  assert.match(source, /querySelector<HTMLElement>\("\.cup-comparison"\)/);
  assert.match(source, /comparison\.classList\.add\("cup-comparison--square-picker"\)/);
  assert.match(source, /comparison\.replaceChildren\(nonUniformSelector, defectiveSelector\)/);
  assert.match(source, /label: "非一致性"[\s\S]*numberPosition: "top"/);
  assert.match(source, /label: "缺陷杯数"[\s\S]*numberPosition: "bottom"/);
  assert.match(source, /control\.dataset\.cupIndex = String\(index\)/);
  assert.match(source, /background:#5b5b5b/);
  assert.match(source, /border-color:#ffffff;[\s\S]*background:#f4f4f4/);
  assert.match(source, /number\.textContent = placeholder \? "0" : String\(index\)/);
  assert.match(source, /add\.textContent = "\+"/);
  assert.match(source, /persistCapacity\(host, capacity \+ 1\)/);
  assert.match(source, /SCA_NON_UNIFORM_CUP_IDS_FIELD/);
  assert.match(source, /SCA_DEFECTIVE_CUP_IDS_FIELD/);
  assert.match(source, /SCA_CUP_CAPACITY_FIELD/);
  assert.match(source, /LEGACY_SAMPLE_CUP_COUNT_FIELD/);
  assert.doesNotMatch(source, /border-color:#d0ad62;background:#b9995a/);
});

test("defective cup selection forces the same cup to remain non-uniform", () => {
  const source = readFileSync("app/ui/dom/cupping-cup-selection-hotfix.ts", "utf8");
  assert.match(source, /if \(!nextPressed && protectedIds\?\.has\(index\)\) return/);
  assert.match(source, /protectedIds: defective/);
  assert.match(source, /if \(pressed\) \{[\s\S]*nonUniform\.add\(index\)/);
  assert.match(source, /setSquareState\(nonUniformSelector, "非一致性", index, true, true\)/);
  assert.match(source, /idsField: SCA_DEFECTIVE_CUP_IDS_FIELD[\s\S]*idsField: SCA_NON_UNIFORM_CUP_IDS_FIELD/);
  assert.match(source, /if \(pressed\)[\s\S]*updates\.push/);
  assert.match(source, /else \{[\s\S]*setSquareState\(nonUniformSelector, "非一致性", index, nonUniform\.has\(index\), false\)/);
});

test("editable legacy records repair defective cups into the non-uniform set", () => {
  const source = readFileSync("app/ui/dom/cupping-cup-selection-hotfix.ts", "utf8");
  assert.match(source, /async function repairLegacySubset/);
  assert.match(source, /for \(const index of defective\) repaired\.add\(index\)/);
  assert.match(source, /saveField\(SCA_NON_UNIFORM_CUP_IDS_FIELD, ids/);
  assert.match(source, /saveField\(SCA_NON_UNIFORM_CUPS_FIELD, ids\.length/);
  assert.match(source, /locked[\s\S]*new Set\(\[\.\.\.originalNonUniform, \.\.\.defective\]\)[\s\S]*repairLegacySubset/);
});

test("visible slider producer is known and cup selector runs after it", () => {
  const upgrade = readFileSync("app/ui/dom/cupping-input-ux-upgrade.ts", "utf8");
  const runtime = readFileSync("app/runtime/web-entry.ts", "utf8");
  assert.match(upgrade, /cupSlider\(SCA_NON_UNIFORM_CUPS_FIELD, "非一致性杯数"/);
  assert.match(upgrade, /cupSlider\(SCA_DEFECTIVE_CUPS_FIELD, "缺陷杯数"/);
  const inputUx = runtime.indexOf('import "../ui/dom/cupping-input-ux-upgrade";');
  const cups = runtime.indexOf('import "../ui/dom/cupping-cup-selection-hotfix";');
  assert.ok(inputUx >= 0);
  assert.ok(cups > inputUx);
});
