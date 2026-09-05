import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

test("homepage exposes exactly the requested four sample-list actions with one shared visual class", () => {
  const home = source("app/ui/dom/batch-setup-renderer.ts");
  assert.match(home, /photo\?\.remove\(\)/);
  assert.match(home, /batch\.dataset\.homeAction = "batch-recognition"/);
  assert.match(home, /manual\.dataset\.homeAction = "manual-entry"/);
  assert.match(home, /clear\.textContent = "清空列表"/);
  assert.match(home, /importButton\.textContent = "导入数据"/);
  assert.match(home, /const homeActions = \[batch, manual, clear, importButton\]/);
  assert.match(home, /for \(const action of homeActions\) action\.className = "batch-setup__capture batch-setup__home-capture-action"/);
  assert.match(home, /captureActions\.replaceChildren\(\.\.\.homeActions\)/);
});

test("records sit below the dominant start action and expand unfinished/completed entries in place", () => {
  const home = source("app/ui/dom/batch-setup-renderer.ts");
  assert.doesNotMatch(home, /buildRecentSessions\(/);
  assert.match(home, /recordToggle\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(home, /recordToggle\.addEventListener\("click"[\s\S]*this\.toggleRecordsMenu\(\)/);
  assert.match(home, /addScope\("unfinished", "未完成记录"\)/);
  assert.match(home, /addScope\("completed", "已完成记录"\)/);
  assert.match(home, /footer\.append\(start\)/);
  assert.match(home, /footer\.append\(this\.recordsButton, this\.recordsMenu\)/);
  assert.match(home, /font-size:23px!important/);
  assert.match(home, /min-height:68px!important/);
});

test("record submenu routes each entry to the corresponding records view scope", () => {
  const home = source("app/ui/dom/batch-setup-renderer.ts");
  assert.match(home, /await this\.options\.onOpenRecords\?\.\(\)/);
  assert.match(home, /data-record-scope-tab="\$\{scope\}"/);
  assert.match(home, /tab\.getAttribute\("aria-pressed"\) !== "true"/);
  assert.match(home, /tab\.click\(\)/);
});

test("records view has explicit unfinished and completed scopes", () => {
  const records = source("app/ui/dom/session-records-renderer.ts");
  assert.match(records, /type StatusScope = "unfinished" \| "completed"/);
  assert.match(records, /addScope\("unfinished", "未完成记录"/);
  assert.match(records, /addScope\("completed", "已完成记录"/);
  assert.match(records, /record\.status === "draft" \|\| record\.status === "active"/);
  assert.match(records, /data\.recordScope = this\.statusScope|dataset\.recordScope = this\.statusScope/);
});
