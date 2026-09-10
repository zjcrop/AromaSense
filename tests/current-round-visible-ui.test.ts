import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { STAGE_IDS } from "../shared/protocol/aromasense-v1";
import { buildSampleRailViewState } from "../app/ui/cupping-view-model";

// npm test executes compiled tests with the repository as cwd. Avoid import.meta
// so this contract remains compatible with the project's existing module target.
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

test("aroma page stores dry fragrance and wet aroma as separate classified observations", () => {
  const dictionary = readFileSync(resolve(root, "app/core/sensory-dictionary-v1.ts"), "utf8");
  const completion = readFileSync(resolve(root, "app/core/completion-engine.ts"), "utf8");
  const renderer = readFileSync(resolve(root, "app/ui/dom/sensory-editor-renderer.ts"), "utf8");

  assert.match(dictionary, /sensory-dictionary\/1\.3/);
  assert.match(dictionary, /key: "dry_fragrance_tags"/);
  assert.match(dictionary, /key: "wet_aroma_tags"/);
  assert.match(completion, /classifiedCapture/);
  assert.match(renderer, /干香 · Fragrance/);
  assert.match(renderer, /湿香 · Aroma/);
  assert.match(renderer, /fieldKey !== "flavor_tags"/);
  assert.match(renderer, /stackList\.dataset\.fieldKey = fieldKey/);
});

test("newly completed workflow points use the requested 0.3 second two-flash transition", () => {
  const css = readFileSync(resolve(root, "app/ui/dom/aromasense-cupping.css"), "utf8");
  const renderer = readFileSync(resolve(root, "app/ui/dom/cupping-screen-renderer.ts"), "utf8");
  const rail = readFileSync(resolve(root, "app/ui/dom/sample-rail-renderer.ts"), "utf8");

  assert.match(css, /aromasense-stage-completion-double-flash 300ms linear both/);
  assert.match(css, /16\.667%[\s\S]*#effff3/);
  assert.match(css, /50%[\s\S]*#effff3/);
  assert.match(css, /66\.667%[\s\S]*#9ed8aa/);
  assert.match(css, /100%[\s\S]*var\(--as-progress-completed\)/);
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
