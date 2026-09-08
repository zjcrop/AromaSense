import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dynamicImport = (0, eval)("(specifier) => import(specifier)") as (specifier: string) => Promise<Record<string, any>>;
const USER_REPORTED_OCR = [
  "哥倫比亞",
  "中焙",
  "展望莊園",
  "水洗",
  "榛果I陳皮|紅糖",
  "酸度1",
  "薇拉省"
].join("\n");

test("user-reported high-quality OCR is structurally recovered instead of staying an anonymous sample", async () => {
  const core = await dynamicImport("luckybean-static-app/src/recognition-core.js");
  const book = JSON.parse(readFileSync("node_modules/luckybean-static-app/public/fallback-codebook.json", "utf8"));
  const document = core.createRecognitionDocument({
    images: [{ id: "reported-sample", role: "front" }],
    blocks: [],
    engine: "semantic-regression",
    fullText: USER_REPORTED_OCR
  });
  const analysis = core.analyzeRecognitionDocument(document, book);

  assert.match(analysis.semanticText, /国家: 哥倫比亞 \/ 哥伦比亚/u);
  assert.match(analysis.semanticText, /烘焙度: 中烘/u);
  assert.match(analysis.semanticText, /庄园: 展望庄园/u);
  assert.match(analysis.semanticText, /处理法: 水洗/u);
  assert.match(analysis.semanticText, /风味: 榛果、陈皮、红糖/u);
  assert.match(analysis.semanticText, /产区: 薇拉省/u);
  assert.match(analysis.semanticText, /(?:^|\n)酸度1(?:\n|$)/u);

  assert.equal(analysis.parsed.countryCode, "CO-CO");
  assert.equal(analysis.parsed.processCode, "PR-WA");
  assert.equal(analysis.parsed.roastCode, "RL-L3");
  assert.equal(analysis.parsed.entityCustomName, "展望庄园");
  assert.equal(analysis.parsed.regionCustomName, "薇拉省");

  const fieldValues = Object.fromEntries(
    (analysis.fields ?? []).map((field: Record<string, unknown>) => [String(field.field), String(field.standardValue ?? field.rawValue ?? "")])
  );
  assert.equal(fieldValues.countryCode, "哥伦比亚");
  assert.equal(fieldValues.entityCode, "展望庄园");
  assert.equal(fieldValues.regionCode, "薇拉省");
  assert.equal(fieldValues.processCode, "水洗");
  assert.equal(fieldValues.roastCode, "中烘");
});
