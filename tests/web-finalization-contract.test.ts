import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const startup = readFileSync("app/ui/dom/startup-renderer.ts", "utf8");
const template = readFileSync("web/index.template.html", "utf8");
const home = readFileSync("app/ui/dom/batch-setup-renderer.ts", "utf8");
const app = readFileSync("app/runtime/dom-app.ts", "utf8");
const cupping = readFileSync("app/ui/dom/cupping-screen-renderer.ts", "utf8");
const identity = readFileSync("app/ui/dom/sample-identity-dialog.ts", "utf8");
const cuppingCss = readFileSync("app/ui/dom/aromasense-cupping.css", "utf8");
const rail = readFileSync("app/ui/dom/sample-rail-renderer.ts", "utf8");

test("Web startup is brand plus five 20-percent readiness gates and auto-enters at completion", () => {
  assert.match(startup, /const STATUS_KEYS:[\s\S]*\["database", "dictionary", "recognition", "account", "sync"\]/);
  assert.match(startup, /Math\.round\(\(settled \/ STATUS_KEYS\.length\) \* 100\)/);
  assert.match(startup, /STATUS_KEYS\.every\(\(key\) => this\.states\.get\(key\) !== "loading"\)/);
  assert.match(startup, /window\.setTimeout\(\(\) => \{ void this\.options\.onEnter\(\); \}, 180\)/);
  assert.doesNotMatch(template, /id="version"/);
  assert.match(template, /<title>AromaSense · 香迹<\/title>/);
});

test("Web home keeps brand/actions and mutually exclusive unfinished/completed history groups", () => {
  assert.match(home, /textContent = "账户"/);
  assert.match(home, /textContent = "导入"/);
  assert.match(home, /textContent = "记录"/);
  assert.match(home, /"unfinished", "未完成记录"/);
  assert.match(home, /"completed", "已完成记录"/);
  assert.match(home, /this\.openHistoryGroup = opening \? key : undefined/);
  assert.match(app, /onOpenRecent: \(sessionId, readOnly\) => readOnly \? this\.showReplay\(sessionId\) : this\.openSession\(sessionId\)/);
});

test("Blind and semi-blind Web flow exposes editable true identity without revealing it in the cupping view", () => {
  assert.match(cupping, /openSampleIdentityDialog/);
  assert.match(cupping, /this\.controller\.saveSampleIdentity\(sampleId, label, metadataPatch/);
  assert.match(cupping, /当前样品真实资料可随时填写，杯测过程中仍保持隐藏/);
  assert.match(identity, /盲测\/半盲测进行中仍保持身份隐藏/);
  for (const field of ["country", "region", "farm", "variety", "process", "roast", "roastDate", "altitude", "flavorNotes"]) {
    assert.match(identity, new RegExp(`\\[\\"${field}\\"`));
  }
});

test("Web progress remains gray/light-blue/green and exposes six sample-stage indicators plus eight workflow steps", () => {
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
