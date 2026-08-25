import assert from "node:assert/strict";
import test from "node:test";
import { buildOCRLayoutDocument, type OCRLineInput } from "../app/core/ocr-layout-model";
import { decideSampleFields } from "../app/core/sample-field-decision-engine";
import type { SampleLayoutSegment } from "../app/core/sample-layout-segmenter";

function line(text: string, left: number, top: number, right: number, bottom: number, confidence = 0.98): OCRLineInput {
  return { text, confidence, polygon: [[left, top], [right, top], [right, bottom], [left, bottom]] };
}

function segment(lines: OCRLineInput[]): SampleLayoutSegment {
  const document = buildOCRLayoutDocument({ imageId: "field-test", sourceWidth: 1000, sourceHeight: 1000, lines });
  return {
    id: "sample-1",
    index: 0,
    confidence: 0.96,
    box: {
      left: 0, top: 0, right: 1, bottom: 1,
      width: 1, height: 1, centerX: 0.5, centerY: 0.5
    },
    lines: document.lines,
    text: document.fullText
  };
}

test("accepts an explicit inline roast date and normalizes it", () => {
  const result = decideSampleFields(segment([
    line("烘焙日期：2026.08.18", 80, 100, 500, 150)
  ]));
  assert.equal(result.accepted.roastDate, "2026-08-18");
  assert.equal(result.decisions.find((item) => item.field === "roastDate")?.state, "accepted");
});

test("associates a label with a nearby value on the next line", () => {
  const result = decideSampleFields(segment([
    line("烘焙日期", 80, 100, 260, 140),
    line("2026-08-18", 80, 148, 290, 188)
  ]));
  const decision = result.decisions.find((item) => item.field === "roastDate");
  assert.ok(decision);
  assert.equal(decision?.value, "2026-08-18");
  assert.notEqual(decision?.state, "rejected");
});

test("altitude range is not written as a date field", () => {
  const result = decideSampleFields(segment([
    line("海拔：1900-2100 MASL", 80, 100, 540, 150)
  ]));
  assert.equal(result.accepted.altitude, "1900–2100 m");
  assert.equal(result.accepted.roastDate, undefined);
});

test("net weight cannot leak into a country field", () => {
  const result = decideSampleFields(segment([
    line("国家", 80, 100, 200, 140),
    line("净含量 200g", 80, 148, 300, 188)
  ]));
  assert.equal(result.accepted.country, undefined);
  const country = result.decisions.find((item) => item.field === "country");
  assert.ok(!country || country.state !== "accepted");
});

test("competing explicit values are routed to review instead of silent overwrite", () => {
  const result = decideSampleFields(segment([
    line("处理法：水洗", 80, 100, 360, 145, 0.95),
    line("PROCESS: NATURAL", 80, 170, 420, 215, 0.94)
  ]));
  const decision = result.decisions.find((item) => item.field === "process");
  assert.equal(decision?.state, "review");
  assert.equal(result.accepted.process, undefined);
});
