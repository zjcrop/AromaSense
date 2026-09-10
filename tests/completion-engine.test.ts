import assert from "node:assert/strict";
import test from "node:test";
import { completionForStage } from "../app/core/completion-engine";
import type { SensoryObservation, StageId } from "../shared/protocol/aromasense-v1";

function observations(stageId: StageId, values: Record<string, unknown>, dictionaryVersion = "test"): SensoryObservation[] {
  return Object.entries(values).map(([fieldKey, value]) => ({ observationId: fieldKey, sessionId: "s", sampleId: "x", stageId, fieldKey, value, dictionaryVersion, updatedAt: "2026-09-04T00:00:00Z" }));
}

test("completion rules reject browsing-only and accept meaningful input", () => {
  assert.equal(completionForStage("aroma", []).complete, false);
  assert.equal(completionForStage("aroma", observations("aroma", { wet_aroma_intensity: 0 })).complete, false);
  assert.equal(completionForStage("aroma", observations("aroma", { wet_aroma_intensity: 0, flavor_tags: ["jasmine"] })).complete, true);
  assert.equal(completionForStage("high_temp", observations("high_temp", { acidity_intensity: 7, sweetness_intensity: 8 })).complete, false);
  assert.equal(completionForStage("high_temp", observations("high_temp", {
    flavor_tags: ["jasmine"], acidity_intensity: 7, sweetness_intensity: 8,
    bitterness_intensity: 2, mouthfeel_intensity: 7
  })).complete, true);
  assert.equal(completionForStage("scoring", observations("scoring", { score_confirmed: true })).complete, true);
});

test("classified aroma capture requires separate dry-fragrance and wet-aroma records", () => {
  const incomplete = completionForStage("aroma", observations("aroma", {
    dry_fragrance_intensity: 7,
    dry_fragrance_tags: ["jasmine"],
    wet_aroma_intensity: 8
  }));
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.missing, ["wet_aroma_tags"]);

  const complete = completionForStage("aroma", observations("aroma", {
    dry_fragrance_intensity: 7,
    dry_fragrance_tags: ["jasmine"],
    wet_aroma_intensity: 8,
    wet_aroma_tags: ["citrus"]
  }));
  assert.equal(complete.complete, true);
  assert.equal(complete.required, 4);
});

test("new 1.3 dual-target aroma capture cannot complete from only one selected library", () => {
  const dryOnly = completionForStage("aroma", observations("aroma", {
    dry_fragrance_intensity: 7,
    dry_fragrance_tags: ["jasmine"],
    wet_aroma_intensity: 8,
    flavor_tags: ["jasmine"]
  }, "sensory-dictionary/1.3"));
  assert.equal(dryOnly.complete, false);
  assert.deepEqual(dryOnly.missing, ["wet_aroma_tags"]);

  const complete = completionForStage("aroma", observations("aroma", {
    dry_fragrance_intensity: 7,
    dry_fragrance_tags: ["jasmine"],
    wet_aroma_intensity: 8,
    wet_aroma_tags: ["citrus"],
    flavor_tags: ["jasmine", "citrus"]
  }, "sensory-dictionary/1.3"));
  assert.equal(complete.complete, true);
});

test("legacy aroma observations remain complete without rewriting historical tags", () => {
  const legacy = completionForStage("aroma", observations("aroma", {
    wet_aroma_intensity: 6,
    flavor_tags: ["floral"]
  }));
  assert.equal(legacy.complete, true);
  assert.equal(legacy.required, 2);

  const legacyWithNewNote = completionForStage("aroma", [
    ...observations("aroma", { wet_aroma_intensity: 6, flavor_tags: ["floral"] }, "sensory-dictionary/1.2"),
    ...observations("aroma", { notes: "旧记录复盘备注" }, "sensory-dictionary/1.3")
  ]);
  assert.equal(legacyWithNewNote.complete, true);
  assert.equal(legacyWithNewNote.required, 2);

  const partiallyClassified = completionForStage("aroma", observations("aroma", {
    dry_fragrance_intensity: 7,
    dry_fragrance_tags: ["cocoa"],
    wet_aroma_intensity: 6,
    flavor_tags: ["floral"]
  }));
  assert.equal(partiallyClassified.complete, true);
  assert.equal(partiallyClassified.required, 4);
});

test("new dictionary intensity writes use shared formal Fragrance/Aroma CATA until classified tags appear", () => {
  const result = completionForStage("aroma", observations("aroma", {
    dry_fragrance_intensity: 7,
    wet_aroma_intensity: 6
  }, "sensory-dictionary/1.3"));
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, ["flavor_tags"]);
  assert.equal(result.required, 3);

  const complete = completionForStage("aroma", observations("aroma", {
    dry_fragrance_intensity: 7,
    wet_aroma_intensity: 6,
    flavor_tags: ["floral"]
  }, "sensory-dictionary/1.3"));
  assert.equal(complete.complete, true);
});

test("legacy final score confirmations remain readable without restoring the old runtime gate", () => {
  const result = completionForStage("final", observations("final", { final_score_confirmed: true }, "sensory-0.1C"));
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
});
