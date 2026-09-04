import assert from "node:assert/strict";
import test from "node:test";
import { buildOCRLayoutDocument, type OCRLineInput } from "../app/core/ocr-layout-model";
import { segmentSamples } from "../app/core/sample-layout-segmenter";

function line(text: string, left: number, top: number, right: number, bottom: number): OCRLineInput {
  return {
    text,
    confidence: 0.98,
    polygon: [[left, top], [right, top], [right, bottom], [left, bottom]]
  };
}

test("segments a dense one-row-per-sample list in reading order", () => {
  const document = buildOCRLayoutDocument({
    imageId: "row-list",
    sourceWidth: 1000,
    sourceHeight: 1000,
    lines: [
      line("Ethiopia Guji | Washed | Gesha", 80, 100, 900, 150),
      line("Kenya Nyeri | Washed | SL28", 80, 210, 900, 260),
      line("Colombia Huila | Natural | Caturra", 80, 320, 900, 370)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "row-list");
  assert.equal(result.segments.length, 3);
  assert.match(result.segments[0]?.text ?? "", /Ethiopia/);
  assert.match(result.segments[2]?.text ?? "", /Colombia/);
});

test("segments a roast-grouped coffee menu with repeated flavor-description cards", () => {
  const document = buildOCRLayoutDocument({
    imageId: "coffee-menu",
    sourceWidth: 820,
    sourceHeight: 1180,
    lines: [
      line("淺中培", 28, 18, 160, 62),
      line("衣索比亞-班莎 厭氧日曬 G1", 28, 115, 590, 158),
      line("風味描述｜鳳梨乾、葡萄酒、玫瑰、草莓、水果軟糖", 28, 166, 775, 205),
      line("夏娃藝伎森林 日曬 G1", 28, 255, 520, 298),
      line("風味描述｜鳳梨乾、葡萄酒、玫瑰、草莓、水果軟糖", 28, 306, 775, 345),
      line("肯亞-和姬 水洗", 28, 395, 360, 438),
      line("風味描述｜葡萄柚與蔓越莓果、橙皮白花氣息、蜂蜜", 28, 446, 775, 485),
      line("新幾內亞-天堂鳥 水洗", 28, 535, 480, 578),
      line("風味描述｜花香、茶香、果香、楓糖甜美、法式潤喉", 28, 586, 775, 625),
      line("中培", 28, 690, 135, 734),
      line("瓜地馬拉-花神 水洗", 28, 790, 430, 833),
      line("風味描述｜巧克力、核果、雪松香氣、酸質圓潤", 28, 841, 775, 880),
      line("瓜地馬拉-VIVI特南果 水洗", 28, 930, 560, 973),
      line("風味描述｜牛奶巧克力、核果、奶油、柑橘", 28, 981, 760, 1020),
      line("肯亞AA 水洗", 28, 1070, 300, 1113),
      line("風味描述｜莓果、太妃糖、黑葡萄、紅糖、甜度高", 28, 1121, 775, 1160)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "vertical-block-list");
  assert.equal(result.segments.length, 7);
  assert.equal(result.requiresReview, false);
  assert.match(result.segments[0]?.text ?? "", /淺中培/);
  assert.match(result.segments[0]?.text ?? "", /衣索比亞-班莎/);
  assert.match(result.segments[3]?.text ?? "", /新幾內亞-天堂鳥/);
  assert.match(result.segments[4]?.text ?? "", /中培/);
  assert.match(result.segments[6]?.text ?? "", /肯亞AA/);
  for (const segment of result.segments) assert.match(segment.text, /風味描述/);
});

test("does not split a two-section single bag merely because flavor is repeated", () => {
  const document = buildOCRLayoutDocument({
    imageId: "single-repeated-flavor",
    sourceWidth: 1000,
    sourceHeight: 1000,
    lines: [
      line("ETHIOPIA GUJI HAMBELA", 80, 100, 800, 145),
      line("風味描述｜茉莉、柑橘、白桃", 80, 180, 760, 225),
      line("CUPPING PROFILE", 80, 330, 520, 375),
      line("風味描述｜冷卻後莓果與蜂蜜", 80, 410, 760, 455)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "single");
  assert.equal(result.segments.length, 1);
});

test("segments vertically separated multi-line coffee blocks", () => {
  const document = buildOCRLayoutDocument({
    imageId: "vertical-blocks",
    sourceWidth: 1000,
    sourceHeight: 1200,
    lines: [
      line("产地 Ethiopia Guji", 80, 80, 500, 120),
      line("品种 Gesha", 80, 135, 360, 175),
      line("处理法 Washed", 80, 190, 420, 230),
      line("产地 Kenya Nyeri", 80, 430, 500, 470),
      line("品种 SL28", 80, 485, 340, 525),
      line("处理法 Washed", 80, 540, 420, 580)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "vertical-block-list");
  assert.equal(result.segments.length, 2);
  assert.match(result.segments[0]?.text ?? "", /Ethiopia/);
  assert.match(result.segments[1]?.text ?? "", /Kenya/);
});

test("recognizes a table header and emits body rows only", () => {
  const document = buildOCRLayoutDocument({
    imageId: "table",
    sourceWidth: 1000,
    sourceHeight: 800,
    lines: [
      line("产地", 40, 60, 180, 100),
      line("处理法", 300, 60, 450, 100),
      line("品种", 620, 60, 760, 100),
      line("Ethiopia Guji", 40, 160, 250, 200),
      line("Washed", 300, 160, 440, 200),
      line("Gesha", 620, 160, 750, 200),
      line("Kenya Nyeri", 40, 260, 250, 300),
      line("Washed", 300, 260, 440, 300),
      line("SL28", 620, 260, 730, 300)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "table");
  assert.equal(result.segments.length, 2);
  assert.doesNotMatch(result.segments[0]?.text ?? "", /^产地/m);
});

test("does not split a dense single coffee-bag label into one sample per text row", () => {
  const document = buildOCRLayoutDocument({
    imageId: "single-dense-label",
    sourceWidth: 1000,
    sourceHeight: 1200,
    lines: [
      line("ETHIOPIA GUJI HAMBELA", 80, 100, 850, 150),
      line("BENTI NENKA WASHING STATION", 80, 180, 900, 230),
      line("HEIRLOOM NATURAL PROCESS", 80, 260, 830, 310),
      line("JASMINE BLUEBERRY PEACH", 80, 340, 820, 390)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "single");
  assert.equal(result.segments.length, 1);
  assert.match(result.segments[0]?.text ?? "", /BENTI NENKA/);
  assert.match(result.segments[0]?.text ?? "", /BLUEBERRY/);
});

test("does not split a two-column label/value coffee card into separate samples", () => {
  const document = buildOCRLayoutDocument({
    imageId: "single-two-column-label",
    sourceWidth: 1000,
    sourceHeight: 1000,
    lines: [
      line("COUNTRY", 80, 100, 260, 145), line("Ethiopia", 500, 100, 760, 145),
      line("REGION", 80, 180, 260, 225), line("Guji", 500, 180, 690, 225),
      line("VARIETY", 80, 260, 280, 305), line("Gesha", 500, 260, 700, 305),
      line("PROCESS", 80, 340, 280, 385), line("Natural", 500, 340, 720, 385)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "single");
  assert.equal(result.segments.length, 1);
  assert.match(result.segments[0]?.text ?? "", /COUNTRY/);
  assert.match(result.segments[0]?.text ?? "", /Natural/);
});
