import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmptySampleDrafts,
  cuppingTargetChoiceFromMetadata,
  resolveCuppingTarget
} from "../app/core/cupping-target";

test("cupping target exposes formal, free and competition variants with final labels", () => {
  assert.deepEqual(resolveCuppingTarget("formal"), { choice: "formal", cuppingMode: "formal", label: "正式杯测" });
  assert.deepEqual(resolveCuppingTarget("free"), { choice: "free", cuppingMode: "free", label: "自由杯测" });
  assert.deepEqual(resolveCuppingTarget("competition"), { choice: "competition", cuppingMode: "competition", label: "杯测赛" });
  assert.deepEqual(resolveCuppingTarget("timed"), { choice: "timed", cuppingMode: "timed", label: "计时赛" });
  assert.deepEqual(resolveCuppingTarget("blind"), { choice: "blind", cuppingMode: "blind", label: "盲测赛" });
  assert.deepEqual(resolveCuppingTarget("semi_blind"), { choice: "semi_blind", cuppingMode: "semi_blind", label: "半盲测赛" });
});

test("legacy open target keeps historical timed behavior under the current timed label", () => {
  assert.deepEqual(resolveCuppingTarget("open"), { choice: "open", cuppingMode: "timed", label: "计时赛" });
  assert.equal(cuppingTargetChoiceFromMetadata({ cuppingMode: "open" }), "timed");
  assert.equal(cuppingTargetChoiceFromMetadata({ target: "公开杯测" }), "timed");
  assert.equal(cuppingTargetChoiceFromMetadata({ blindMode: "open" }), "timed");
});

test("target choice restores all canonical modes from session metadata", () => {
  assert.equal(cuppingTargetChoiceFromMetadata({ cuppingMode: "formal" }), "formal");
  assert.equal(cuppingTargetChoiceFromMetadata({ cuppingMode: "free" }), "free");
  assert.equal(cuppingTargetChoiceFromMetadata({ cuppingMode: "competition" }), "competition");
  assert.equal(cuppingTargetChoiceFromMetadata({ cuppingMode: "timed" }), "timed");
  assert.equal(cuppingTargetChoiceFromMetadata({ cuppingMode: "blind" }), "blind");
  assert.equal(cuppingTargetChoiceFromMetadata({ cuppingMode: "semi_blind" }), "semi_blind");
  assert.equal(cuppingTargetChoiceFromMetadata({ blindMode: "full_blind" }), "blind");
  assert.equal(cuppingTargetChoiceFromMetadata({ blindMode: "semi_blind" }), "semi_blind");
});

test("blind and semi-blind count expansion creates truly empty sample drafts", () => {
  const samples = buildEmptySampleDrafts(6);
  assert.equal(samples.length, 6);
  assert.equal(samples.every((sample) => sample.label === undefined), true);
  assert.equal(samples.every((sample) => Object.keys(sample.metadata).length === 0), true);
  assert.throws(() => buildEmptySampleDrafts(0), /CUPPING_SAMPLE_COUNT_OUT_OF_RANGE/);
  assert.throws(() => buildEmptySampleDrafts(51), /CUPPING_SAMPLE_COUNT_OUT_OF_RANGE/);
});
