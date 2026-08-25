import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCoffeeDateValue,
  parseLuckyBeanSemanticText,
  type CoffeeRecognitionBook
} from "../app/core/luckybean-recognition-compat";

const book: CoffeeRecognitionBook = {
  version: "test-v6",
  countries: [
    ["CO-EA", "埃塞俄比亚", "Ethiopia", "埃塞", "active"],
    ["CO-KE", "肯尼亚", "Kenya", "肯尼亚", "active"]
  ],
  regions: [
    ["RG-EA-GUJ", "CO-EA", "古吉", "Guji", "Guji", "active"],
    ["RG-EA-YIR", "CO-EA", "耶加雪菲", "Yirgacheffe", "Yirgacheffe", "active"]
  ],
  entities: [
    ["EN-EA-BEN", "CO-EA", "RG-EA-GUJ", "Benti Nenka", "Benti Nenka", "Benti Nenka", "active"]
  ],
  varieties: [
    ["VR-GES", "瑰夏", "Geisha / Gesha", "Gesha", "active"],
    ["VR-HEI", "原生种", "Heirloom", "Ethiopian Heirloom", "active"]
  ],
  processes: [
    ["PR-N", "日晒", "Natural", "Dry Process", "active"],
    ["PR-W", "水洗", "Washed", "Fully Washed", "active"]
  ],
  flavors: [
    ["FL-JAS", "floral", "white-flower", 2, "茉莉", "Jasmine", "茉莉花", "jasmine", "active"],
    ["FL-BLU", "fruit", "berry", 2, "蓝莓", "Blueberry", "蓝莓", "blueberry", "active"]
  ]
};

test("LuckyBean semantic port standardizes explicitly labelled coffee fields", () => {
  const result = parseLuckyBeanSemanticText([
    "COUNTRY: Ethiopia",
    "REGION: Guji",
    "FARM: Benti Nenka",
    "VARIETY: Gesha",
    "PROCESS: Natural",
    "ROAST DATE: 2026-08-20",
    "BEST BEFORE: 2026-10-20",
    "ALTITUDE: 1950-2100m",
    "NET WEIGHT: 200g",
    "FLAVOR NOTES: Jasmine, Blueberry"
  ].join("\n"), book);

  assert.equal(result.fields.country, "埃塞俄比亚");
  assert.equal(result.fields.region, "古吉");
  assert.equal(result.fields.farm, "Benti Nenka");
  assert.equal(result.fields.variety, "瑰夏");
  assert.equal(result.fields.process, "日晒");
  assert.equal(result.fields.roastDate, "2026-08-20");
  assert.equal(result.fields.bestBefore, "2026-10-20");
  assert.equal(result.fields.altitude, "1950–2100 m");
  assert.equal(result.fields.weight, "200 g");
  assert.equal(result.fields.flavorNotes, "茉莉、蓝莓");
  assert.ok(result.confidence.country >= 0.95);
  assert.ok(result.confidence.process >= 0.95);
});

test("production and best-before dates never leak into roast date", () => {
  const result = parseLuckyBeanSemanticText([
    "PRODUCTION DATE: 2026-08-01",
    "BEST BEFORE: 2026-11-01",
    "LOT: 20260820"
  ].join("\n"), book);

  assert.equal(result.fields.productionDate, "2026-08-01");
  assert.equal(result.fields.bestBefore, "2026-11-01");
  assert.equal(result.fields.roastDate, undefined);
  assert.equal(result.fields.lot, "20260820");
});

test("explicit labelled lines are not reused for unrelated global inference", () => {
  const result = parseLuckyBeanSemanticText([
    "REGION: Kenya",
    "VARIETY: Gesha"
  ].join("\n"), book);

  assert.equal(result.fields.region, "Kenya");
  assert.equal(result.fields.variety, "瑰夏");
  assert.equal(result.fields.country, undefined);
});

test("ambiguous DMY/MDY date is not silently auto-filled", () => {
  const parsed = parseCoffeeDateValue("08/09/26");
  assert.equal(parsed.value, "");
  assert.deepEqual(parsed.candidates.sort(), ["2026-08-09", "2026-09-08"].sort());
  assert.ok(parsed.confidence < 0.5);
});

test("unlabelled table aliases can still recover common coffee metadata", () => {
  const result = parseLuckyBeanSemanticText("Ethiopia Guji Gesha Natural", book);
  assert.equal(result.fields.country, "埃塞俄比亚");
  assert.equal(result.fields.region, "古吉");
  assert.equal(result.fields.variety, "瑰夏");
  assert.equal(result.fields.process, "日晒");
});
