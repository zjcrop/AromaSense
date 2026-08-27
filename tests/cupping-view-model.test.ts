import assert from "node:assert/strict";
import test from "node:test";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import type { SampleStageProgress } from "../app/storage/stage-progress-reader";
import { buildSampleRailViewState } from "../app/ui/cupping-view-model";

const now = "2026-08-27T14:10:00+08:00";
const sample = buildSampleBatch("rail-session", [{ label: "Sample A" }], now, () => "rail-sample-1")[0]!;

function stageProgress(
  status: SampleStageProgress["status"],
  observationCount: number
): SampleStageProgress {
  return {
    sampleId: sample.sampleId,
    stageId: "high_temp",
    status,
    observationCount,
    updatedAt: now
  };
}

function highTempIndicator(progress: readonly SampleStageProgress[]): string | undefined {
  return buildSampleRailViewState([sample], progress, sample.sampleId)[0]?.stages
    .find((stage) => stage.stageId === "high_temp")?.indicatorState;
}

test("rail stage underline state follows actual stage progress and field coverage", () => {
  assert.equal(highTempIndicator([]), "not_started");
  assert.equal(highTempIndicator([stageProgress("active", 2)]), "active");
  assert.equal(highTempIndicator([stageProgress("active", 5)]), "near_complete");
  assert.equal(highTempIndicator([stageProgress("completed", 0)]), "completed");
});
