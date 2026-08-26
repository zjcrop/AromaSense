import assert from "node:assert/strict";
import test from "node:test";
import { scoreProfileForMetadata, scoreProfileForMode } from "../app/core/cupping-score-profile";

test("each cupping mode resolves to its own score profile", () => {
  assert.equal(scoreProfileForMode("open").id, "open");
  assert.equal(scoreProfileForMode("blind").id, "blind");
  assert.equal(scoreProfileForMode("semi_blind").id, "semi_blind");
  assert.equal(scoreProfileForMode("open").metadataPolicy, "visible");
  assert.equal(scoreProfileForMode("blind").metadataPolicy, "hidden");
  assert.equal(scoreProfileForMode("semi_blind").metadataPolicy, "semi_hidden");
});

test("legacy blind metadata routes to the canonical blind score profile", () => {
  assert.equal(scoreProfileForMetadata({ blindMode: "full_blind" }).id, "blind");
  assert.equal(scoreProfileForMetadata({ blindMode: "semi_blind" }).id, "semi_blind");
});
