import assert from "node:assert/strict";
import test from "node:test";
import { detectFieldAnchor, splitLeadingFieldPair } from "../app/core/recognition-field-lexicon";

test("Japanese coffee label aliases resolve to canonical fields", () => {
  assert.equal(detectFieldAnchor("原産国")?.field, "country");
  assert.equal(detectFieldAnchor("品種")?.field, "variety");
  assert.equal(detectFieldAnchor("精製方法")?.field, "process");
  assert.equal(detectFieldAnchor("焙煎日")?.field, "roastDate");
  assert.equal(detectFieldAnchor("テイスティングノート")?.field, "flavor");
});

test("Korean coffee label aliases resolve to canonical fields", () => {
  assert.equal(detectFieldAnchor("원산국")?.field, "country");
  assert.equal(detectFieldAnchor("품종")?.field, "variety");
  assert.equal(detectFieldAnchor("가공 방식")?.field, "process");
  assert.equal(detectFieldAnchor("로스팅 날짜")?.field, "roastDate");
  assert.equal(detectFieldAnchor("테이스팅 노트")?.field, "flavor");
});

test("Japanese and Korean leading label-value pairs are split", () => {
  assert.deepEqual(splitLeadingFieldPair("品種 Gesha")?.field, "variety");
  assert.deepEqual(splitLeadingFieldPair("精製方法 Washed")?.field, "process");
  assert.deepEqual(splitLeadingFieldPair("품종 Gesha")?.field, "variety");
  assert.deepEqual(splitLeadingFieldPair("가공 방식 Washed")?.field, "process");
});
