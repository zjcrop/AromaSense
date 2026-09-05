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

test("legacy near-complete input cannot create a fourth visual progress state", () => {
  const template = readFileSync(resolve(root, "web/index.template.html"), "utf8");
  assert.match(
    template,
    /data-state=\"near_complete\"[\s\S]*?var\(--as-progress-active\)/,
    "near_complete must collapse to the started/light-blue visual state"
  );
});
