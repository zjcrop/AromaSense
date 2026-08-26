import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmptySampleDrafts,
  cuppingTargetChoiceFromMetadata,
  resolveCuppingTarget
} from "../app/core/cupping-target";

test("cupping target exposes exactly open, blind and semi-blind choices", () => {
  assert.deepEqual(resolveCuppingTarget("open"), { choice: "open", cuppingMode: "open", label: "公开杯测" });
  assert.deepEqual(resolveCuppingTarget("blind"), { choice: "blind", cuppingMode: "blind", label: "盲测" });
  assert.deepEqual(resolveCuppingTarget("semi_blind"), { choice: "semi_blind", cuppingMode: "semi_blind", label: "半盲测" });
});

test("target choice restores from canonical and legacy session metadata", () => {
  assert.equal(cuppingTargetChoiceFromMetadata({ cuppingMode: "open" }), "open");
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
