import assert from "node:assert/strict";
import test from "node:test";
import { scoreProfileForMetadata, scoreProfileForMode } from "../app/core/cupping-score-profile";

test("each canonical cupping mode resolves to its own score profile", () => {
  assert.equal(scoreProfileForMode("formal").id, "formal");
  assert.equal(scoreProfileForMode("free").id, "free");
  assert.equal(scoreProfileForMode("competition").id, "competition");
  assert.equal(scoreProfileForMode("timed").id, "timed");
  assert.equal(scoreProfileForMode("blind").id, "blind");
  assert.equal(scoreProfileForMode("semi_blind").id, "semi_blind");
  assert.equal(scoreProfileForMode("formal").metadataPolicy, "visible");
  assert.equal(scoreProfileForMode("free").metadataPolicy, "visible");
  assert.equal(scoreProfileForMode("competition").metadataPolicy, "visible");
  assert.equal(scoreProfileForMode("timed").metadataPolicy, "visible");
  assert.equal(scoreProfileForMode("blind").metadataPolicy, "hidden");
  assert.equal(scoreProfileForMode("semi_blind").metadataPolicy, "semi_hidden");
});

test("all canonical modes use the same current SCA calculator for any displayed SCA score", () => {
  const modes = ["formal", "free", "competition", "timed", "blind", "semi_blind"] as const;
  const versions = modes.map((mode) => scoreProfileForMode(mode).calculatorVersion);
  assert.equal(new Set(versions).size, 1);
});

test("legacy open metadata routes to timed while blind metadata stays canonical", () => {
  assert.equal(scoreProfileForMode("open").id, "timed");
  assert.equal(scoreProfileForMetadata({ cuppingMode: "open" }).id, "timed");
  assert.equal(scoreProfileForMetadata({ blindMode: "full_blind" }).id, "blind");
  assert.equal(scoreProfileForMetadata({ blindMode: "semi_blind" }).id, "semi_blind");
});
