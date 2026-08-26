import assert from "node:assert/strict";
import test from "node:test";
import { normalizeImportBundle } from "../app/core/import-bundle";
import { manualTextRows, splitManualCoffeeRow } from "../app/core/manual-text-import";

test("manual tokenizer preserves dates altitude ranges and variety combinations", () => {
  const row = "样品A；Ethiopia；SL28/SL34；2026-08-26；1850-2100m；Washed";
  assert.deepEqual(splitManualCoffeeRow(row), ["样品A", "Ethiopia", "SL28/SL34", "2026-08-26", "1850-2100m", "Washed"]);
});

test("manual text uses one non-empty row per coffee", () => {
  assert.deepEqual(manualTextRows("A；Ethiopia\n\nB；Kenya\n C；Panama "), ["A；Ethiopia", "B；Kenya", "C；Panama"]);
});

test("legacy single-session share becomes one import bundle session", () => {
  const bundle = normalizeImportBundle({
    title: "采购杯测",
    metadata: { date: "2026-08-26", time: "12:30", organizer: "Lab" },
    samples: [{ label: "A", metadata: { country: "Ethiopia" } }]
  }, { kind: "link", name: "share" });
  assert.equal(bundle?.sessions.length, 1);
  assert.equal(bundle?.sessions[0].title, "采购杯测");
  assert.equal(bundle?.sessions[0].samples[0].metadata.country, "Ethiopia");
});

test("multi-session share preserves grouping", () => {
  const bundle = normalizeImportBundle({
    schema: "aromasense-import/1",
    sessions: [
      { sourceGroup: "上午", metadata: {}, samples: [{ label: "A", metadata: {} }] },
      { sourceGroup: "下午", metadata: {}, samples: [{ label: "B", metadata: {} }] }
    ]
  }, { kind: "json" });
  assert.deepEqual(bundle?.sessions.map((item) => item.sourceGroup), ["上午", "下午"]);
});
