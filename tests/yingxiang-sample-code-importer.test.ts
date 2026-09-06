import assert from "node:assert/strict";
import test from "node:test";
import { yingxiangSampleCodesFromDrafts } from "../app/ui/dom/yingxiang-sample-code-importer";

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
