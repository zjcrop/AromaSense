import assert from "node:assert/strict";
import test from "node:test";
import { yingxiangSampleCodesFromDrafts, yingxiangSampleCodesFromPastedText } from "../app/ui/dom/yingxiang-sample-code-importer";

test("Yingxiang sample importer prefers explicit sample codes and preserves order", () => {
  const codes = yingxiangSampleCodesFromDrafts([
    { label: "Coffee A", metadata: { sampleCode: "A01" } },
    { label: "205", metadata: {} },
    { label: "Coffee C", metadata: { 编号: "C-3" } },
    { label: "待确认样品 04", metadata: {} }
  ]);
  assert.deepEqual(codes, ["A01", "205", "C-3"]);
});

test("Yingxiang sample importer does not silently deduplicate codes", () => {
  const codes = yingxiangSampleCodesFromDrafts([
    { label: "101", metadata: {} },
    { label: "101", metadata: {} }
  ]);
  assert.deepEqual(codes, ["101", "101"]);
});

test("Yingxiang pasted sample codes preserve the literal one-line-per-code workflow", () => {
  assert.deepEqual(yingxiangSampleCodesFromPastedText("A01\nA02\nA03"), ["A01", "A02", "A03"]);
  assert.deepEqual(yingxiangSampleCodesFromPastedText("101\n205\n307"), ["101", "205", "307"]);
  assert.deepEqual(yingxiangSampleCodesFromPastedText("Sample 01\nSample 02"), ["Sample 01", "Sample 02"]);
});

test("Yingxiang pasted sample codes normalize full-width text but preserve duplicates for validation", () => {
  assert.deepEqual(yingxiangSampleCodesFromPastedText("Ａ０１\nＡ０１"), ["A01", "A01"]);
});
