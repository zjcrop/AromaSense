import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { STAGE_IDS } from "../shared/protocol/aromasense-v1";
import { buildSampleRailViewState } from "../app/ui/cupping-view-model";

const root = process.cwd();

const sample = {
  sampleId: "sample-visible-contract",
  sessionId: "session-visible-contract",
  displayNumber: 1,
  sortOrder: 1,
  label: "01",
  metadata: {},
  createdAt: "2026-09-05T18:00:00+08:00",
  updatedAt: "2026-09-05T18:00:00+08:00"
};

test("formal cupping rail exposes exactly the seven requested workflow stages with neutral identity tone", () => {
  assert.deepEqual([...STAGE_IDS], [
    "aroma",
    "high_temp",
    "mid_temp",
    "low_temp",
    "flavor",
    "overall",
    "scoring"
  ]);

  const rail = buildSampleRailViewState([sample], [], sample.sampleId);
  assert.equal(rail.length, 1);
  assert.deepEqual(rail[0].stages.map((stage) => stage.label), [
    "香气", "高温", "中温", "低温", "风味", "综评", "评分"
  ]);
  assert.ok(rail[0].stages.every((stage) => stage.tone === "neutral"));
  assert.ok(rail[0].stages.every((stage) => stage.status === "not_started"));
});

test("product shell visibly exposes three-state progress and current-step completion criteria", () => {
  const template = readFileSync(resolve(root, "web/index.template.html"), "utf8");
  const renderer = readFileSync(resolve(root, "app/ui/dom/cupping-screen-renderer.ts"), "utf8");

  assert.match(template, /data-aromasense-current-round-visual-closure/);
  assert.match(template, /gray = untouched, light blue = started, green = complete/);
  assert.match(template, /\.cupping-stage-step\.is-current::after/);
  assert.match(template, /content:\s*attr\(title\)/);
  assert.match(template, /--as-progress-not-started/);
  assert.match(template, /--as-progress-active/);
  assert.match(template, /--as-progress-completed/);

  assert.match(renderer, /灰色 未开始/);
  assert.match(renderer, /浅蓝 已开始/);
  assert.match(renderer, /绿色 已完成/);
  assert.match(renderer, /完成标准：\$\{stage\.completionHint\}/);
  assert.match(renderer, /stage\.stageId === activeStageId/);
});

test("aroma page supports strict shared SCA CATA and source-classified free cupping", () => {
  const dictionary = readFileSync(resolve(root, "app/core/sensory-dictionary-v1.ts"), "utf8");
  const completion = readFileSync(resolve(root, "app/core/completion-engine.ts"), "utf8");
  const renderer = readFileSync(resolve(root, "app/ui/dom/sensory-editor-renderer.ts"), "utf8");
  const browserAcceptance = readFileSync(resolve(root, "scripts/current-round-ui-acceptance.mjs"), "utf8");

  assert.match(dictionary, /sensory-dictionary\/1\.3/);
  assert.match(dictionary, /key: "dry_fragrance_tags"/);
  assert.match(dictionary, /key: "wet_aroma_tags"/);
  assert.match(completion, /modernSharedCapture/);
  assert.match(renderer, /干香 · Fragrance/);
  assert.match(renderer, /湿香 · Aroma/);
  assert.match(renderer, /Fragrance \/ Aroma 香气类别/);
  assert.match(renderer, /SCA正式流程共用一套 CATA 香气类别/);
  assert.match(renderer, /appMode === "free" \? "classified" : "shared"/);
  assert.match(browserAcceptance, /setRangeByLabel\(cdp, "干香强度"/);
  assert.match(browserAcceptance, /data-aroma-phase=\"shared\"/);
  assert.match(browserAcceptance, /setRangeByLabel\(cdp, "湿香强度"/);
});

test("latest workflow nodes use numbered circles, arrow navigation and requested triple-flash timing", () => {
  const latest = readFileSync(resolve(root, "app/ui/dom/cupping-latest-ui-finalize.ts"), "utf8");
  const renderer = readFileSync(resolve(root, "app/ui/dom/cupping-screen-renderer.ts"), "utf8");
  const rail = readFileSync(resolve(root, "app/ui/dom/sample-rail-renderer.ts"), "utf8");
  const entry = readFileSync(resolve(root, "app/runtime/web-entry.ts"), "utf8");

  assert.match(entry, /cupping-flow-enhancements/);
  assert.match(entry, /cupping-latest-ui-finalize/);
  assert.ok(entry.indexOf("cupping-flow-enhancements") < entry.indexOf("cupping-latest-ui-finalize"));
  assert.match(latest, /cupping-stage-step__index/);
  assert.match(latest, /badge\.textContent = String\(index \+ 1\)/);
  assert.match(latest, /\.cupping-stage-step\.is-current \.cupping-stage-step__index/);
  assert.match(latest, /previous\.textContent = "←"/);
  assert.match(latest, /next\.textContent = "→"/);
  assert.match(latest, /gap:10px!important/);
  assert.match(latest, /translateY\(-0\.5px\)!important/);
  assert.match(latest, /aromasense-stage-completion-triple-flash 2100ms linear both!important/);
  assert.match(latest, /Three 0\.5 s flashes separated by two 0\.3 s quiet intervals/);
  assert.match(latest, /11\.905%[\s\S]*#effff3/);
  assert.match(latest, /50%[\s\S]*#effff3/);
  assert.match(latest, /88\.095%[\s\S]*#effff3/);
  assert.match(latest, /100%[\s\S]*var\(--as-progress-completed\)/);
  assert.match(renderer, /progressStatusSnapshot/);
  assert.match(renderer, /is-completion-flash/);
  assert.doesNotMatch(rail, /token\.dataset\.stageId/, "rail progress must not shadow workflow button selectors");
});

test("sensory conclusion visibly preserves missing values instead of fabricating zero", () => {
  const finalAssessment = readFileSync(resolve(root, "app/ui/dom/final-assessment-renderer.ts"), "utf8");
  const conclusion = readFileSync(resolve(root, "app/ui/dom/sensory-profile-conclusion-renderer.ts"), "utf8");
  const radar = readFileSync(resolve(root, "app/ui/dom/radar-renderer.ts"), "utf8");

  assert.match(finalAssessment, /hasValue \? String\(current\) : "—"/);
  assert.match(finalAssessment, /final-assessment__scale\$\{hasValue \? "" : " is-unset"\}/);
  assert.match(conclusion, /未记录维度显示为—，不按0处理/);
  assert.match(conclusion, /未记录点留空，不以0补线/);
  assert.match(radar, /axis\.recorded !== false/);
});

test("legacy near-complete input cannot create a fourth visual progress state", () => {
  const template = readFileSync(resolve(root, "web/index.template.html"), "utf8");
  assert.match(
    template,
    /data-state=\"near_complete\"[\s\S]*?var\(--as-progress-active\)/,
    "near_complete must collapse to the started/light-blue visual state"
  );
});
