import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const host = readFileSync("app/ui/dom/yingxiang-host-renderer.ts", "utf8");
const consoleSource = readFileSync("app/ui/dom/yingxiang-console-renderer.ts", "utf8");
const docs = readFileSync("docs/YINGXIANG_HOST_FLOW.md", "utf8");

test("Yingxiang organizer uses one sortable sample list and no second real-coffee editor", () => {
  assert.match(host, /YingxiangSampleListSorter/);
  assert.match(host, /sampleCodes: normalizedLines\(view\.sampleCodes\.value\)/);
  assert.doesNotMatch(host, /YingxiangCoffeeListEditor|真实咖啡对应|清空真实咖啡|coffees:\s*this\.coffeeEditor/);
  assert.equal(existsSync("app/ui/dom/yingxiang-coffee-list-editor.ts"), false);
});

test("organizer dashboard does not present legacy coffee metadata as an editable comparison list", () => {
  assert.doesNotMatch(consoleSource, /YingxiangCoffeeDetail|coffeeSummary|尚未对应真实咖啡|点击编辑真实咖啡信息/);
  assert.match(consoleSource, /样品顺序/);
  assert.match(consoleSource, /编辑 \/ 排序/);
});

test("host-flow contract distinguishes legacy coffee compatibility from active workflow", () => {
  assert.match(docs, /one authoritative event sample list/i);
  assert.match(docs, /does not create, upload, compare or edit it/i);
});
