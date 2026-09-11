import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

test("record sync exposes a lightweight cloud index and selected record download through the same reconciliation path", () => {
  const sync = source("app/core/record-sync-service.ts");
  assert.match(sync, /listCloudRecords\(\)/u);
  assert.match(sync, /\/api\/v1\/records\/index/u);
  assert.match(sync, /downloadRecords\(recordIds/u);
  assert.match(sync, /const applied = await this\.applyRemote\(remote\)/u);
  assert.match(sync, /snapshot\.session\.sessionId !== recordId/u);
  assert.doesNotMatch(sync, /createSessionId/u);
});

test("worker returns metadata-only cloud index and owner-scoped full records", () => {
  const routes = source("cloud/worker/src/sync-record-routes.ts");
  assert.match(routes, /url\.pathname === "\/api\/v1\/records\/index"/u);
  assert.match(routes, /WHERE owner_user_id = \?1 AND deleted_at IS NULL/u);
  assert.match(routes, /date: asText\(metadata\?\.date\)/u);
  assert.match(routes, /organizer: asText\(metadata\?\.organizer\)/u);
  assert.match(routes, /eventName: asText\(metadata\?\.eventName\)/u);
  assert.match(routes, /if \(request\.method === "GET"\) return getRecord/u);
});

test("cloud record page follows existing AromaSense form sizes and supports the three requested download modes", () => {
  const ui = source("app/ui/dom/cloud-records-renderer.ts");
  assert.match(ui, /"最近记录"/u);
  assert.match(ui, /"按时间"/u);
  assert.match(ui, /"选择下载"/u);
  assert.match(ui, /\[3, 5, 10, 20\]/u);
  assert.match(ui, /font-size:21px/u);
  assert.match(ui, /font-size:13px/u);
  assert.match(ui, /font-size:10px/u);
  assert.match(ui, /min-height:42px/u);
  assert.match(ui, /min-height:46px/u);
  assert.match(ui, /background:#151515/u);
  assert.match(ui, /background:#242424/u);
  assert.match(ui, /border-radius:9px/u);
  assert.match(ui, /border-radius:10px/u);
  assert.match(ui, /entry\.organizer/u);
  assert.match(ui, /entry\.eventName/u);
  assert.match(ui, /"进行中"/u);
});

test("cloud record browser is installed beside the existing records toolbar and uses shared navigation scrim", () => {
  const entry = source("app/runtime/web-entry.ts");
  const ui = source("app/ui/dom/cloud-records-renderer.ts");
  assert.match(entry, /installCloudRecordDownloadFeature/u);
  assert.match(entry, /onDownloaded: async \(\) => \{ await app\?\.showRecords\(\); \}/u);
  assert.match(ui, /\.session-records__toolbar/u);
  assert.match(ui, /className = "session-records__tool"/u);
  assert.match(ui, /OVERLAY_KINDS\.MODAL/u);
  assert.match(ui, /scrim: true/u);
  assert.match(ui, /background:transparent!important/u);
});
