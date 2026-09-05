import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

test("homepage exposes exactly the requested four sample-list actions", () => {
  const home = source("app/ui/dom/batch-setup-renderer.ts");
  assert.match(home, /photo\?\.remove\(\)/);
  assert.match(home, /batch\.dataset\.homeAction = "batch-recognition"/);
  assert.match(home, /manual\.dataset\.homeAction = "manual-entry"/);
  assert.match(home, /clear\.textContent = "清空列表"/);
  assert.match(home, /importButton\.textContent = "导入数据"/);
  assert.match(home, /replaceChildren\(\.\.\.\[batch, manual, clear, importButton\]/);
});

test("records leave the homepage and sit below the dominant start action", () => {
  const home = source("app/ui/dom/batch-setup-renderer.ts");
  assert.doesNotMatch(home, /buildRecentSessions\(/);
  assert.match(home, /footer\.append\(start\);\s*if \(this\.recordsButton\) footer\.append\(this\.recordsButton\)/);
  assert.match(home, /font-size:23px!important/);
  assert.match(home, /min-height:68px!important/);
});

test("records view has explicit unfinished and completed scopes", () => {
  const records = source("app/ui/dom/session-records-renderer.ts");
  assert.match(records, /type StatusScope = "unfinished" \| "completed"/);
  assert.match(records, /addScope\("unfinished", "未完成记录"/);
  assert.match(records, /addScope\("completed", "已完成记录"/);
  assert.match(records, /record\.status === "draft" \|\| record\.status === "active"/);
  assert.match(records, /data\.recordScope = this\.statusScope|dataset\.recordScope = this\.statusScope/);
});
