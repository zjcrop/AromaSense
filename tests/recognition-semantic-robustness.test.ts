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

test("user-reported OCR is normalized before field recognition while preserving raw evidence", async () => {
  const core = await dynamicImport("luckybean-static-app/src/recognition-core.js");
  const book = JSON.parse(readFileSync("node_modules/luckybean-static-app/public/fallback-codebook.json", "utf8"));
  const document = core.createRecognitionDocument({
    images: [{ id: "reported-sample", role: "front" }],
    blocks: [],
    engine: "semantic-regression",
    fullText: USER_REPORTED_OCR
  });
  const analysis = core.analyzeRecognitionDocument(document, book);
  const recognition = analysis.parsed?.parseMetadata?.recognition ?? {};
  const preSemantic = analysis.parsed?.parseMetadata?.preSemanticNormalization ?? {};

  assert.equal(analysis.pipelineVersion, "1.24P-recognition-pipeline.7");
  assert.equal(recognition.rawSemanticText, USER_REPORTED_OCR, "raw OCR text must remain untouched by translation/normalization");
  assert.equal(preSemantic.authority, "shadow-only");
  assert.equal(preSemantic.mayOverwriteRawEvidence, false);
  assert.match(String(preSemantic.normalizedText ?? ""), /国家: 哥伦比亚/u);
  assert.match(String(preSemantic.normalizedText ?? ""), /烘焙度: 中烘/u);
  assert.match(String(preSemantic.normalizedText ?? ""), /庄园: 展望庄园/u);
  assert.match(String(preSemantic.normalizedText ?? ""), /处理法: 水洗/u);
  assert.match(String(preSemantic.normalizedText ?? ""), /风味: 榛果、陈皮、红糖/u);
  assert.match(String(preSemantic.normalizedText ?? ""), /产区: 薇拉省/u);
  assert.match(String(preSemantic.normalizedText ?? ""), /(?:^|\n)酸度1(?:\n|$)/u);
  assert.ok(Array.isArray(preSemantic.audit) && preSemantic.audit.length >= 5);
  assert.ok(preSemantic.audit.some((item: Record<string, any>) =>
    item.rawText === "薇拉省" && Array.isArray(item.candidates) && item.candidates.some((candidate: Record<string, any>) =>
      String(candidate.rule ?? "").includes("transliteration") && (candidate.aliases ?? []).includes("Huila")
    )
  ));

  assert.match(analysis.semanticText, /国家: 哥伦比亚/u);
  assert.match(analysis.semanticText, /烘焙度: 中烘/u);
  assert.match(analysis.semanticText, /庄园: 展望庄园/u);
  assert.match(analysis.semanticText, /处理法: 水洗/u);
  assert.match(analysis.semanticText, /风味: 榛果、陈皮、红糖/u);
  assert.match(analysis.semanticText, /产区: 薇拉省/u);

  assert.equal(analysis.parsed.countryCode, "CO-CO");
  assert.equal(analysis.parsed.processCode, "PR-WA");
  assert.equal(analysis.parsed.roastCode, "RL-L3");
  assert.equal(analysis.parsed.entityCustomName, "展望庄园");
  assert.equal(analysis.parsed.regionCustomName, "薇拉省");
  assert.equal(analysis.reviewCount, 0, "typed custom values must not turn a strong OCR sample into pending review");

  const fieldValues = Object.fromEntries(
    (analysis.fields ?? []).map((field: Record<string, unknown>) => [String(field.field), String(field.standardValue ?? field.rawValue ?? "")])
  );
  assert.equal(fieldValues.countryCode, "哥伦比亚");
  assert.equal(fieldValues.entityCode, "展望庄园");
  assert.equal(fieldValues.regionCode, "薇拉省");
  assert.equal(fieldValues.processCode, "水洗");
  assert.equal(fieldValues.roastCode, "中烘");

  const reviewFields = (analysis.fields ?? []).filter((field: Record<string, unknown>) => field.status === "review");
  assert.deepEqual(reviewFields, []);
});

test("manual multi-region layout marker does not itself force a sample review", () => {
  const source = readFileSync("app/core/sample-segmentation-review.ts", "utf8");
  assert.match(source, /layoutType:\s*samples\.length\s*>\s*1\s*\?\s*"mixed"\s*:\s*"single"/u);
  assert.match(source, /requiresSegmentationReview:\s*false/u);
  assert.match(source, /requiresReview:\s*Number\(analysis\.reviewCount\s*\?\?\s*0\)\s*>\s*0\s*\|\|\s*!Object\.keys\(fields\)\.length/u);
});
