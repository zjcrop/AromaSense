import type { OCRBox } from "./ocr-layout-model";
import {
  loadBundledLuckyBeanRecognitionBook,
  luckyBeanCoreVersion,
  requireLuckyBeanRecognitionCore,
  type LuckyBeanAnalysisField,
  type LuckyBeanRecognitionAnalysis
} from "./luckybean-upstream-adapter";
import type { RecognizedPage, RecognizedSample } from "./sample-recognition-service";

export interface SegmentationReviewLine {
  id: string;
  blockId: string;
  text: string;
  confidence: number;
  box: OCRBox;
}

export interface SegmentationReviewRegion {
  id: string;
  label: string;
  box: OCRBox;
  lineIds: readonly string[];
}

export interface SegmentationReviewModel {
  fileName: string;
  engine: string;
  lines: readonly SegmentationReviewLine[];
  regions: readonly SegmentationReviewRegion[];
}

interface RecognitionEvidenceLine {
  id?: unknown;
  blockId?: unknown;
  text?: unknown;
  confidence?: unknown;
  box?: unknown;
}

interface RecognitionMetadata {
  segmentId?: unknown;
  segmentBox?: unknown;
  evidenceLines?: unknown;
  sourceIdentity?: unknown;
  rawText?: unknown;
}

const UPSTREAM_FIELD_MAP: Readonly<Record<string, string>> = Object.freeze({
  countryCode: "country",
  regionCode: "region",
  entityCode: "farm",
  varietyCode: "variety",
  processCode: "process",
  roastCode: "roast",
  roastDate: "roastDate",
  harvestYear: "harvest",
  roastColor: "roastColor",
  roasterName: "roaster",
  altitude: "altitude",
  initialWeight: "weight",
  flavorCodes: "flavorNotes"
});

const PARSED_SCALAR_FIELDS = [
  "productionDate",
  "packDate",
  "bestBefore",
  "expiryDate",
  "lot",
  "grade"
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clamp01(value: unknown, fallback = 0): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizedBox(value: unknown): OCRBox | undefined {
  const source = record(value);
  if (!source) return undefined;
  const left = clamp01(source.left);
  const top = clamp01(source.top);
  const right = clamp01(source.right, left);
  const bottom = clamp01(source.bottom, top);
  if (right <= left || bottom <= top) return undefined;
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0.0001, right - left),
    height: Math.max(0.0001, bottom - top),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function unionBoxes(boxes: readonly OCRBox[]): OCRBox {
  if (!boxes.length) throw new Error("分区没有可用文字框");
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0.0001, right - left),
    height: Math.max(0.0001, bottom - top),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function evidenceLines(sample: RecognizedSample): SegmentationReviewLine[] {
  const recognition = record(sample.metadata.recognition) as RecognitionMetadata | undefined;
  const raw = Array.isArray(recognition?.evidenceLines) ? recognition.evidenceLines as RecognitionEvidenceLine[] : [];
  return raw.flatMap((entry, index) => {
    const text = cleanText(entry.text);
    const box = normalizedBox(entry.box);
    if (!text || !box) return [];
    return [{
      id: cleanText(entry.id) || `evidence-${index + 1}`,
      blockId: cleanText(entry.blockId) || cleanText(entry.id) || `evidence-block-${index + 1}`,
      text,
      confidence: clamp01(entry.confidence, 0.75),
      box
    }];
  });
}

function regionFromSample(sample: RecognizedSample, index: number, lines: readonly SegmentationReviewLine[]): SegmentationReviewRegion | undefined {
  const recognition = record(sample.metadata.recognition) as RecognitionMetadata | undefined;
  const sourceLines = evidenceLines(sample);
  if (!sourceLines.length) return undefined;
  const ids = sourceLines.map((line) => line.id).filter((id) => lines.some((line) => line.id === id));
  if (!ids.length) return undefined;
  const explicitBox = normalizedBox(recognition?.segmentBox);
  const selected = lines.filter((line) => ids.includes(line.id));
  return {
    id: cleanText(recognition?.segmentId) || `manual-region-${index + 1}`,
    label: cleanText(sample.label),
    box: explicitBox ?? unionBoxes(selected.map((line) => line.box)),
    lineIds: ids
  };
}

export function buildSegmentationReviewModel(page: RecognizedPage): SegmentationReviewModel | undefined {
  const lineMap = new Map<string, SegmentationReviewLine>();
  for (const sample of page.samples) {
    for (const line of evidenceLines(sample)) {
      const existing = lineMap.get(line.id);
      if (!existing || line.confidence > existing.confidence) lineMap.set(line.id, line);
    }
  }
  const lines = [...lineMap.values()].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  if (!lines.length) return undefined;
  const regions = page.samples.flatMap((sample, index) => {
    const region = regionFromSample(sample, index, lines);
    return region ? [region] : [];
  });
  if (!regions.length) return undefined;
  return { fileName: page.fileName, engine: page.engine, lines, regions };
}

export function linesInsideBox(lines: readonly SegmentationReviewLine[], box: OCRBox): string[] {
  return lines
    .filter((line) => line.box.centerX >= box.left && line.box.centerX <= box.right && line.box.centerY >= box.top && line.box.centerY <= box.bottom)
    .map((line) => line.id);
}

export function normalizeRegionBox(input: Pick<OCRBox, "left" | "top" | "right" | "bottom">): OCRBox {
  const left = clamp01(input.left);
  const top = clamp01(input.top);
  const right = clamp01(input.right, 1);
  const bottom = clamp01(input.bottom, 1);
  if (right - left < 0.01 || bottom - top < 0.01) throw new Error("分区范围过小，请扩大边界");
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

export function mergeSegmentationRegions(
  model: SegmentationReviewModel,
  firstIndex: number,
  secondIndex: number
): SegmentationReviewRegion[] {
  if (firstIndex === secondIndex) return [...model.regions];
  const first = model.regions[firstIndex];
  const second = model.regions[secondIndex];
  if (!first || !second) throw new Error("要合并的分区不存在");
  const lineIds = [...new Set([...first.lineIds, ...second.lineIds])];
  const selected = model.lines.filter((line) => lineIds.includes(line.id));
  const merged: SegmentationReviewRegion = {
    id: `${first.id}+${second.id}`,
    label: cleanText(first.label) || cleanText(second.label),
    box: unionBoxes(selected.map((line) => line.box)),
    lineIds
  };
  const low = Math.min(firstIndex, secondIndex);
  const high = Math.max(firstIndex, secondIndex);
  return model.regions.flatMap((region, index) => index === low ? [merged] : index === high ? [] : [region]);
}

export function splitSegmentationRegion(
  model: SegmentationReviewModel,
  regionIndex: number,
  splitY: number
): SegmentationReviewRegion[] {
  const region = model.regions[regionIndex];
  if (!region) throw new Error("要拆分的分区不存在");
  const selected = model.lines.filter((line) => region.lineIds.includes(line.id));
  const upperLines = selected.filter((line) => line.box.centerY < splitY);
  const lowerLines = selected.filter((line) => line.box.centerY >= splitY);
  if (!upperLines.length || !lowerLines.length) throw new Error("拆分线两侧都必须包含识别文字");
  const upper: SegmentationReviewRegion = {
    id: `${region.id}-a`,
    label: "",
    box: unionBoxes(upperLines.map((line) => line.box)),
    lineIds: upperLines.map((line) => line.id)
  };
  const lower: SegmentationReviewRegion = {
    id: `${region.id}-b`,
    label: "",
    box: unionBoxes(lowerLines.map((line) => line.box)),
    lineIds: lowerLines.map((line) => line.id)
  };
  return model.regions.flatMap((item, index) => index === regionIndex ? [upper, lower] : [item]);
}

function targetField(field: unknown): string {
  const source = String(field ?? "");
  return UPSTREAM_FIELD_MAP[source] ?? source;
}

function analysisFields(analysis: LuckyBeanRecognitionAnalysis): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const item of analysis.fields ?? []) {
    const key = targetField(item.field);
    const value = cleanText(item.standardValue ?? item.rawValue);
    if (key && value) fields[key] = value;
  }
  const parsed = analysis.parsed ?? {};
  for (const key of PARSED_SCALAR_FIELDS) {
    const value = parsed[key];
    if (value !== undefined && value !== null && cleanText(value)) fields[key] = cleanText(value);
  }
  return fields;
}

function analysisReview(analysis: LuckyBeanRecognitionAnalysis): Array<Record<string, unknown>> {
  return (analysis.fields ?? []).filter((item) => item.status === "review").map((item: LuckyBeanAnalysisField) => ({
    field: targetField(item.field),
    value: cleanText(item.standardValue ?? item.rawValue),
    confidence: Number(item.confidence ?? 0),
    candidates: (item.resolution?.candidates ?? []).map((candidate) => ({
      value: cleanText(candidate.value),
      normalizedValue: cleanText(candidate.value),
      score: Number(candidate.confidence ?? candidate.score ?? 0)
    }))
  }));
}

function analysisConfidence(analysis: LuckyBeanRecognitionAnalysis, fallback = 0.75): number {
  const values = (analysis.fields ?? []).map((item) => Number(item.confidence)).filter(Number.isFinite);
  return values.length ? Math.max(...values) : fallback;
}

function likelyLabel(fields: Record<string, string>, manualLabel: string, index: number): string {
  if (cleanText(manualLabel)) return cleanText(manualLabel).slice(0, 80);
  const parts = [fields.farm, fields.station, fields.region, fields.origin, fields.variety, fields.country]
    .filter((value): value is string => Boolean(value));
  if (parts.length) return [...new Set(parts)].slice(0, 2).join(" · ").slice(0, 80);
  return `待确认样品 ${String(index + 1).padStart(2, "0")}`;
}

function sampleFromRegion(
  page: RecognizedPage,
  model: SegmentationReviewModel,
  region: SegmentationReviewRegion,
  index: number
): RecognizedSample {
  const lines = model.lines.filter((line) => region.lineIds.includes(line.id));
  if (!lines.length) throw new Error(`分区 ${index + 1} 没有包含识别文字`);
  const core = requireLuckyBeanRecognitionCore();
  const book = loadBundledLuckyBeanRecognitionBook();
  const imageId = `manual-segmentation-${page.fileName}-${index + 1}`;
  const rawText = lines.map((line) => line.text).join("\n");
  const document = core.createRecognitionDocument({
    images: [{ id: imageId, role: "front", roleLabel: "手工调整分区" }],
    blocks: lines.map((line, order) => ({
      id: line.id,
      blockId: line.blockId,
      imageId,
      imageRole: "front",
      order,
      text: line.text,
      confidence: line.confidence,
      polygon: [
        { x: line.box.left, y: line.box.top },
        { x: line.box.right, y: line.box.top },
        { x: line.box.right, y: line.box.bottom },
        { x: line.box.left, y: line.box.bottom }
      ]
    })),
    engine: page.engine,
    fullText: rawText
  });
  const analysis = core.analyzeRecognitionDocument(document, book);
  const fields = analysisFields(analysis);
  const review = analysisReview(analysis);
  const confidence = analysisConfidence(analysis);
  const label = likelyLabel(fields, region.label, index);
  const upstreamDocument = analysis.document ?? {};
  return {
    label,
    rawText,
    engine: `${page.engine}+${String(analysis.pipelineVersion ?? luckyBeanCoreVersion())}`,
    confidence,
    requiresReview: Number(analysis.reviewCount ?? 0) > 0 || !Object.keys(fields).length || /^待确认样品\s/u.test(label),
    metadata: {
      ...fields,
      recognition: {
        schemaVersion: "aromasense-recognition/3.3",
        source: "photo",
        fileName: page.fileName,
        engine: page.engine,
        pageLayout: page.layoutType,
        segmentationConfidence: 1,
        segmentationRequiresReview: false,
        manualSegmentation: true,
        segmentId: region.id,
        segmentBox: region.box,
        rawText,
        review,
        luckyBeanUpstream: {
          pipelineVersion: analysis.pipelineVersion,
          documentSchemaVersion: upstreamDocument.schemaVersion,
          parserVersion: upstreamDocument.parserVersion,
          blockCount: Array.isArray(upstreamDocument.blocks) ? upstreamDocument.blocks.length : 0,
          relationCount: Array.isArray(upstreamDocument.relations) ? upstreamDocument.relations.length : 0,
          resolvedCount: analysis.resolvedCount,
          reviewCount: analysis.reviewCount,
          semanticText: analysis.semanticText
        },
        evidenceLines: lines.map((line) => ({
          id: line.id,
          blockId: line.blockId,
          text: line.text,
          confidence: line.confidence,
          box: line.box
        }))
      }
    }
  };
}

export function resegmentRecognizedPage(
  page: RecognizedPage,
  model: SegmentationReviewModel
): RecognizedPage {
  if (!model.regions.length) throw new Error("至少保留一个样品分区");
  const used = new Set<string>();
  for (const [index, region] of model.regions.entries()) {
    if (!region.lineIds.length) throw new Error(`分区 ${index + 1} 没有文字`);
    for (const id of region.lineIds) {
      if (used.has(id)) throw new Error(`识别文字 ${id} 被分配到多个样品，请调整边界`);
      used.add(id);
    }
  }
  const normalizedRegions = model.regions.map((region) => ({ ...region, box: normalizeRegionBox(region.box) }));
  const normalizedModel = { ...model, regions: normalizedRegions };
  const samples = normalizedRegions.map((region, index) => sampleFromRegion(page, normalizedModel, region, index));
  return {
    ...page,
    layoutType: samples.length > 1 ? "mixed" : "single",
    segmentationConfidence: 1,
    requiresSegmentationReview: false,
    samples
  };
}
