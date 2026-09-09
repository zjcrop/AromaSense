import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("setup home exposes only batch intake and clear list while batch intake owns six sources", () => {
  const text = source("app/ui/dom/home-action-enhancements.ts");
  assert.match(text, /batch\.textContent = "批量录入"/u);
  assert.match(text, /clear\.textContent = "清空列表"/u);
  assert.match(text, /const visible = button === batch \|\| button === clear/u);
  assert.match(text, /data-aromasense-intake-hidden/u);
  for (const label of ["图片", "分割识别", "文字录入", "表格", "链接", "二维码"]) {
    assert.ok(text.includes(label), `missing batch intake source: ${label}`);
  }
  assert.match(text, /const ordered = \[photo, split, text, sheet, link, qr\]/u);
  assert.match(text, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
  assert.match(text, /import-source__footer/u);
  assert.match(text, /import-source__title/u);
  assert.match(text, /\.remove\(\)/u);
});

test("recognized setup rows are accepted by default and only expose delete", () => {
  const text = source("app/ui/dom/setup-list-ux-enhancements.ts");
  assert.match(text, /confirmed: true/u);
  assert.match(text, /\[data-review\]/u);
  assert.match(text, /\.remove\(\)/u);
  assert.match(text, /\.batch-setup__row-actions \.batch-setup__remove/u);
  assert.match(text, /background:#d6ad63!important/u);
  assert.match(text, /border:0!important/u);
  assert.match(text, /font-weight:850!important/u);
  assert.match(text, /batch-setup__manual-mark/u);
});

test("text entry previews physical rows and recognition starts on completion", () => {
  const text = source("app/ui/dom/manual-text-import-dialog.ts");
  assert.match(text, /manualTextRows/u);
  assert.match(text, /"下一行"/u);
  assert.match(text, /"完成录入"/u);
  assert.match(text, /正在识别并导入/u);
  assert.match(text, /await options\.onParse\(text\)/u);
  assert.doesNotMatch(text, /解析并导入/u);
});

test("compact cup rail retracts footer actions and progress legend immediately", () => {
  const text = source("app/ui/dom/setup-list-ux-enhancements.ts");
  assert.match(text, /\.is-rail-compact \.cupping-rail-footer__actions/u);
  assert.match(text, /\.is-rail-compact \.cupping-progress-legend/u);
  assert.match(text, /display:none!important/u);
  assert.match(text, /列表编辑/u);
});

test("Yingxiang management supports filtered selection delete and clean cloning", () => {
  const text = source("app/ui/dom/yingxiang-management-enhancements.ts");
  assert.match(text, /全选筛选结果/u);
  assert.match(text, /删除所选/u);
  assert.match(text, /一键复刻/u);
  assert.match(text, /statusFilter/u);
  assert.match(text, /await client\.createEvent/u);
  assert.match(text, /publish: false/u);
  assert.doesNotMatch(text, /dashboard\(/u);
  assert.doesNotMatch(text, /submissions:/u);
  assert.match(text, /\.yx-coffee-card__title\{font-size:14px!important/u);
});

test("completed Yingxiang activities can be permanently deleted while active ones still require cancellation", () => {
  const text = source("cloud/worker/src/yingxiang-management-api.ts");
  assert.match(text, /\['draft','cancelled','completed'\]\.includes\(status\)/u);
  assert.doesNotMatch(text, /\['draft','cancelled'\]\.includes\(status\)/u);
});
