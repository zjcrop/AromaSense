import assert from "node:assert/strict";
import test from "node:test";
import {
  CUPPING_MODES,
  cuppingModePolicy,
  defaultSessionMetadata,
  normalizeCuppingMode
} from "../app/core/session-metadata";

test("new cupping sessions default to free and expose exactly four canonical modes", () => {
  assert.deepEqual(CUPPING_MODES, ["free", "timed", "blind", "semi_blind"]);
  assert.equal(defaultSessionMetadata("2026-09-06T12:00:00+08:00").cuppingMode, "free");
});

test("legacy open normalizes to timed instead of changing historical behavior", () => {
  assert.equal(normalizeCuppingMode("open"), "timed");
});

test("free disables timing and unlocks roster while timed locks public identity and roster", () => {
  assert.deepEqual(cuppingModePolicy("free"), {
    timerEnabled: false,
    runtimeRosterMutable: true,
    runtimeIdentityEditable: true
  });
  assert.deepEqual(cuppingModePolicy("timed"), {
    timerEnabled: true,
    runtimeRosterMutable: false,
    runtimeIdentityEditable: false
  });
});

test("blind variants keep timing and late identity entry but not roster mutation", () => {
  assert.deepEqual(cuppingModePolicy("blind"), {
    timerEnabled: true,
    runtimeRosterMutable: false,
    runtimeIdentityEditable: true
  });
  assert.deepEqual(cuppingModePolicy("semi_blind"), {
    timerEnabled: true,
    runtimeRosterMutable: false,
    runtimeIdentityEditable: true
  });
});
