import assert from "node:assert/strict";
import test from "node:test";
import {
  CUPPING_MODES,
  cuppingModePolicy,
  defaultSessionMetadata,
  normalizeCuppingMode
} from "../app/core/session-metadata";

test("new cupping sessions default to formal and expose the six canonical modes", () => {
  assert.deepEqual(CUPPING_MODES, ["formal", "free", "competition", "blind", "semi_blind", "timed"]);
  assert.equal(defaultSessionMetadata("2026-09-06T12:00:00+08:00").cuppingMode, "formal");
});

test("legacy open normalizes to timed instead of changing historical behavior", () => {
  assert.equal(normalizeCuppingMode("open"), "timed");
});

test("formal and free remain editable non-competition sessions with distinct protocols", () => {
  assert.deepEqual(cuppingModePolicy("formal"), {
    timerEnabled: false,
    runtimeRosterMutable: true,
    runtimeIdentityEditable: true,
    competition: false,
    completionLocks: false,
    protocol: "sca_cva"
  });
  assert.deepEqual(cuppingModePolicy("free"), {
    timerEnabled: false,
    runtimeRosterMutable: true,
    runtimeIdentityEditable: true,
    competition: false,
    completionLocks: false,
    protocol: "aromasense_custom"
  });
});

test("competition variants share timer and whole-session lock policy", () => {
  for (const mode of ["competition", "timed", "blind", "semi_blind"] as const) {
    assert.deepEqual(cuppingModePolicy(mode), {
      timerEnabled: true,
      runtimeRosterMutable: false,
      runtimeIdentityEditable: false,
      competition: true,
      completionLocks: true,
      protocol: "sca_cva"
    });
  }
});
