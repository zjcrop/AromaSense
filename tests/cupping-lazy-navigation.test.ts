import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CuppingScreenState } from "../app/ui/cupping-screen-controller";
import {
  resolveInitialCuppingTarget,
  type CuppingPageMemory
} from "../app/ui/dom/cupping-lazy-navigation";

function state(): CuppingScreenState {
  return {
    sessionId: "session-a",
    sessionStatus: "active",
    sessionMetadata: {} as never,
    samples: [
      { sampleId: "sample-1" },
      { sampleId: "sample-2" }
    ] as never,
    progress: [],
    lockedSampleIds: [],
    rail: [
      {
        sampleId: "sample-1",
        stages: [
          { stageId: "preparation" },
          { stageId: "aroma" },
          { stageId: "high_temp" }
        ]
      },
      {
        sampleId: "sample-2",
        stages: [
          { stageId: "preparation" },
          { stageId: "aroma" },
          { stageId: "high_temp" }
        ]
      }
    ] as never
  };
}

test("re-entry restores the last sample and its last opened stage", () => {
  const memory: CuppingPageMemory = {
    version: 1,
    lastSampleId: "sample-2",
    samples: {
      "sample-1": { stageId: "aroma" },
      "sample-2": { stageId: "high_temp" }
    }
  };
  assert.deepEqual(resolveInitialCuppingTarget(state(), memory), {
    sampleId: "sample-2",
    stageId: "high_temp"
  });
});

test("a session with no usable navigation memory opens sample one page one", () => {
  assert.deepEqual(resolveInitialCuppingTarget(state(), undefined), {
    sampleId: "sample-1",
    stageId: "preparation"
  });
  const stale: CuppingPageMemory = {
    version: 1,
    lastSampleId: "removed-sample",
    samples: { "removed-sample": { stageId: "high_temp" } }
  };
  assert.deepEqual(resolveInitialCuppingTarget(state(), stale), {
    sampleId: "sample-1",
    stageId: "preparation"
  });
});

test("pure sample or stage navigation does not re-read the whole session", () => {
  const source = readFileSync("app/ui/cupping-screen-controller.ts", "utf8");
  const start = source.indexOf("  async select(sampleId:");
  const end = source.indexOf("\n  async saveField(", start);
  assert.ok(start >= 0 && end > start, "select() source block must be present");
  const selectSource = source.slice(start, end);
  assert.match(selectSource, /this\.editor\.open/);
  assert.match(selectSource, /buildSampleRailViewState\(state\.samples, state\.progress/);
  assert.doesNotMatch(selectSource, /refreshState\(/);
  assert.doesNotMatch(selectSource, /listForSession\(/);
  assert.doesNotMatch(selectSource, /listObservationsForSession\(/);
  assert.doesNotMatch(selectSource, /getSession\(/);
});

test("cupping navigation is page-local and does not expose the global long-operation progress", () => {
  const source = readFileSync("app/ui/dom/cupping-lazy-navigation.ts", "utf8");
  const entry = readFileSync("app/runtime/web-entry.ts", "utf8");
  assert.match(source, /aromasense\.cupping\.last-page\.v1:/);
  assert.match(source, /Only the target slice is opened/);
  assert.match(source, /#app\[data-screen="cupping"\] ~ \.aromasense-long-progress/);
  assert.match(source, /display:none!important/);
  assert.match(source, /stateBefore\.active\?\.context\.sampleId !== sampleId/);
  assert.match(entry, /import "\.\.\/ui\/dom\/cupping-lazy-navigation"/);
});
