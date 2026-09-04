import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const startup = readFileSync("app/ui/dom/startup-renderer.ts", "utf8");
const template = readFileSync("web/index.template.html", "utf8");
const home = readFileSync("app/ui/dom/batch-setup-renderer.ts", "utf8");
const app = readFileSync("app/runtime/dom-app.ts", "utf8");
const cupping = readFileSync("app/ui/dom/cupping-screen-renderer.ts", "utf8");
const stableCupping = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
const cuppingCss = readFileSync("app/ui/dom/aromasense-cupping.css", "utf8");
const rail = readFileSync("app/ui/dom/sample-rail-renderer.ts", "utf8");

test("Web startup is brand plus five equal readiness gates and auto-enters after completion", () => {
  assert.match(startup, /const STATUS_KEYS:[\s\S]*\["database", "dictionary", "recognition", "account", "sync"\]/);
  assert.match(startup, /Math\.round\(\(settled \/ STATUS_KEYS\.length\) \* 100\)/);
  assert.match(startup, /STATUS_KEYS\.every\(\(key\) => this\.states\.get\(key\) !== "loading"\)/);
  assert.match(startup, /window\.setTimeout\(\(\) => \{ void this\.options\.onEnter\(\); \}, 180\)/);
  assert.doesNotMatch(template, /id="version"/);
  assert.match(template, /<title>AromaSense · 香迹<\/title>/);
});

test("Web home keeps brand actions and mutually exclusive unfinished/completed history groups", () => {
  assert.match(home, /textContent = "账户"/);
  assert.match(home, /textContent = "导入"/);
  assert.match(home, /textContent = "记录"/);
  assert.match(home, /"unfinished", "未完成记录"/);
  assert.match(home, /"completed", "已完成记录"/);
  assert.match(home, /this\.openHistoryGroup = opening \? key : undefined/);
  assert.match(app, /onOpenRecent: \(sessionId, readOnly\) => readOnly \? this\.showReplay\(sessionId\) : this\.openSession\(sessionId\)/);
});

test("Production Web blind editor can edit true bean identity at any stage without revealing it", () => {
  assert.match(stableCupping, /\.cupping-main__blind-status/);
  assert.match(stableCupping, /openBlindIdentityEditor/);
  assert.match(stableCupping, /this\.controller\.saveSampleIdentity\(sample\.sampleId, nameInput\.value, patch/);
  assert.match(stableCupping, /盲测进行中仍按盲测规则隐藏/);
  assert.match(stableCupping, /可在任意杯测步骤再次打开修改/);
  assert.match(stableCupping, /selector\.value = state\.active\?\.context\.sampleId/);
  assert.match(stableCupping, /state\.sessionStatus !== "completed" && state\.sessionStatus !== "archived"/);
  for (const field of ["country", "region", "farm", "variety", "process", "roast", "roastDate", "altitude", "flavorNotes"]) {
    assert.match(stableCupping, new RegExp(`\\[\\"${field}\\"`));
  }
});

test("Blind roast-date manual input remains free text for multilingual base-date compatibility", () => {
  assert.match(stableCupping, /七月十五日/);
  assert.match(stableCupping, /15 Jul 2026/);
  assert.doesNotMatch(stableCupping, /input\.type = key === "roastDate" \? "date" : "text"/);
  assert.match(stableCupping, /input\.type = "text"/);
});

test("Web progress remains gray light-blue green with six sample stages and eight workflow steps", () => {
  assert.match(cuppingCss, /--as-progress-not-started: #5e6267/);
  assert.match(cuppingCss, /--as-progress-active: #83b9e6/);
  assert.match(cuppingCss, /--as-progress-completed: #5ba66d/);
  assert.match(cuppingCss, /grid-template-columns: repeat\(8, minmax\(0, 1fr\)\)/);
  assert.match(rail, /for \(const stage of item\.stages\)/);
  assert.match(rail, /sample-rail__identity-line/);
  assert.match(rail, /buildStageProgress\(item\)/);
});

test("Web side rail preserves exit-as-unfinished and finish-only-when-all-stages-complete semantics", () => {
  assert.match(cupping, /暂时退出当前杯测，已录入内容保留为未完成记录/);
  assert.match(cupping, /this\.controller\.canFinishSession\(\)/);
  assert.match(cupping, /所有样品的全部杯测流程完成后才可结束整场杯测/);
  assert.match(cupping, /const autoCollapse = \(\): void => this\.collapseRailForEditing\(\)/);
});
