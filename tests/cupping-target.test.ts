import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBlindPlaceholderSampleDrafts,
  cuppingTargetChoiceFromMetadata,
  resolveCuppingTarget
} from "../app/core/cupping-target";

test("cupping target maps blind, semi-blind and custom to session visibility", () => {
  assert.deepEqual(resolveCuppingTarget("blind"), { choice: "blind", target: "盲测", blindMode: "full_blind" });
  assert.deepEqual(resolveCuppingTarget("semi_blind"), { choice: "semi_blind", target: "半盲", blindMode: "semi_blind" });
  assert.deepEqual(resolveCuppingTarget("custom", "  产区横向对比  "), { choice: "custom", target: "产区横向对比", blindMode: "open" });
  assert.deepEqual(resolveCuppingTarget("custom", ""), { choice: "custom", target: undefined, blindMode: "open" });
});

test("target choice restores from session metadata", () => {
  assert.equal(cuppingTargetChoiceFromMetadata({ blindMode: "full_blind" }), "blind");
  assert.equal(cuppingTargetChoiceFromMetadata({ blindMode: "semi_blind" }), "semi_blind");
  assert.equal(cuppingTargetChoiceFromMetadata({ blindMode: "open", target: "研究杯测" }), "custom");
  assert.equal(cuppingTargetChoiceFromMetadata({ target: "历史记录" }), "custom");
});

test("blind target can create a requested number of anonymous process placeholders", () => {
  const samples = buildBlindPlaceholderSampleDrafts(6);
  assert.equal(samples.length, 6);
  assert.equal(samples[0]?.label, "待揭盲样品 01");
  assert.equal(samples[5]?.label, "待揭盲样品 06");
  assert.equal(samples.every((sample) => sample.metadata.blindPlaceholder === true), true);
  assert.throws(() => buildBlindPlaceholderSampleDrafts(0), /BLIND_SAMPLE_COUNT_OUT_OF_RANGE/);
  assert.throws(() => buildBlindPlaceholderSampleDrafts(51), /BLIND_SAMPLE_COUNT_OUT_OF_RANGE/);
});
