import assert from "node:assert/strict";
import test from "node:test";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import type { SampleStageProgress } from "../app/storage/stage-progress-reader";
import { buildSampleRailViewState } from "../app/ui/cupping-view-model";

const now = "2026-08-27T14:10:00+08:00";
const sample = buildSampleBatch("rail-session", [{ label: "Sample A" }], now, () => "rail-sample-1")[0]!;

function stageProgress(status: SampleStageProgress["status"]): SampleStageProgress {
  return {
    sampleId: sample.sampleId,
    stageId: "high_temp",
    status,
    observationCount: status === "not_started" ? 0 : 1,
    updatedAt: now
  };
}

function highTempIndicator(progress: readonly SampleStageProgress[]): string | undefined {
  return buildSampleRailViewState([sample], progress, sample.sampleId)[0]?.stages
    .find((stage) => stage.stageId === "high_temp")?.indicatorState;
}

test("rail stage underline exposes only untouched, started and complete states", () => {
  assert.equal(highTempIndicator([]), "not_started");
  assert.equal(highTempIndicator([stageProgress("active")]), "active");
  assert.equal(highTempIndicator([stageProgress("completed")]), "completed");
});

test("final stage exposes flavor, overall and score as three workflow substeps", () => {
  const progress: SampleStageProgress = {
    sampleId: sample.sampleId,
    stageId: "final",
    status: "active",
    observationCount: 2,
    updatedAt: now,
    finalPhases: [
      { phase: "flavor", status: "completed", completionHint: "flavor" },
      { phase: "overall", status: "active", completionHint: "overall" },
      { phase: "score", status: "not_started", completionHint: "score" }
    ]
  };
  const finalStage = buildSampleRailViewState([sample], [progress], sample.sampleId)[0]?.stages
    .find((stage) => stage.stageId === "final");
  assert.deepEqual(finalStage?.finalPhases?.map((phase) => [phase.phase, phase.status]), [
    ["flavor", "completed"],
    ["overall", "active"],
    ["score", "not_started"]
  ]);
});
