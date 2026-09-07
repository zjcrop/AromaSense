import type { OCRLayoutDocument } from "./ocr-layout-model";
import type { PageStructureResult, PageStructureSample } from "./page-structure-contract";

export interface StructuredRecognitionSample {
  label: string;
  rawText: string;
  engine: string;
  confidence: number;
  requiresReview: boolean;
  metadata: Record<string, unknown>;
}

function mean(values: readonly number[], fallback: number): number {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : fallback;
}

function evidenceLines(document: OCRLayoutDocument, refs: readonly string[]) {
  const wanted = new Set(refs);
  return document.lines.filter((line) => wanted.has(line.id)).map((line) => ({
    id: line.id,
    blockId: line.blockId,
    text: line.text,
    confidence: line.confidence,
    box: line.normalizedBox
  }));
}

function fieldsFromSample(sample: PageStructureSample): Record<string, string> {
  const selected = new Map<string, { value: string; confidence: number }>();
  const flavors: string[] = [];
  for (const field of sample.fields) {
    const key = field.field === "entity" ? "farm" : field.field;
    const value = field.value.trim();
    if (!value) continue;
    if (key === "flavorNotes") {
      if (!flavors.includes(value)) flavors.push(value);
      continue;
    }
    const current = selected.get(key);
    if (!current || field.confidence > current.confidence) selected.set(key, { value, confidence: field.confidence });
  }
  const result = Object.fromEntries([...selected].map(([key, item]) => [key, item.value]));
  if (flavors.length) result.flavorNotes = flavors.join(" / ");
  return result;
}

function labelFor(sample: PageStructureSample, fields: Record<string, string>, index: number): string {
  const label = sample.fields.find((field) => field.field === "label")?.value.trim();
  if (label) return label.slice(0, 80);
  const parts = [fields.farm, fields.station, fields.region, fields.variety, fields.country].filter(Boolean);
  return parts.length ? [...new Set(parts)].slice(0, 2).join(" · ").slice(0, 80) : `待确认样品 ${String(index + 1).padStart(2, "0")}`;
}

export function mapStructuredPageRecognition(input: {
  result: PageStructureResult;
  document: OCRLayoutDocument;
  fileName: string;
  mimeType: string;
  engine: string;
  imageQuality?: Record<string, unknown>;
  pageLayout: string;
  layoutConfidence: number;
  multiRecordProbability: number;
  ignoredEvidenceRefs: readonly string[];
}): StructuredRecognitionSample[] {
  const hasUnassignedEvidence = input.result.unassignedEvidence.length > 0;
  return input.result.samples.map((sample, index) => {
    const fields = fieldsFromSample(sample);
    const lines = evidenceLines(input.document, sample.evidenceRefs);
    const ocrConfidence = mean(lines.map((line) => Number(line.confidence)), 0.55);
    const semanticConfidence = mean(sample.fields.map((field) => field.confidence), sample.confidence);
    const confidence = Math.min(sample.confidence, semanticConfidence, ocrConfidence);
    const label = labelFor(sample, fields, index);
    const lowField = sample.fields.some((field) => field.confidence < 0.65);
    const requiresReview = hasUnassignedEvidence || sample.confidence < 0.75 || lowField || /^待确认样品/u.test(label);
    const rawText = lines.map((line) => line.text).join("\n");
    return {
      label,
      rawText,
      engine: `${input.engine}+zhipu-structure`,
      confidence,
      requiresReview,
      metadata: {
        ...fields,
        ...(sample.extras?.length ? { structureExtras: sample.extras } : {}),
        recognition: {
          schemaVersion: "aromasense-recognition/3.5",
          source: "photo",
          fileName: input.fileName,
          mimeType: input.mimeType,
          engine: input.engine,
          imageQuality: input.imageQuality,
          pageLayout: input.pageLayout,
          rawText,
          evidenceLines: lines,
          confidence: {
            ocr: ocrConfidence,
            grouping: sample.confidence,
            semantic: semanticConfidence
          },
          pageStructure: {
            strategy: "whole-page-ai",
            schemaVersion: input.result.schemaVersion,
            model: input.result.model,
            inputFingerprint: input.result.inputFingerprint,
            multiRecordProbability: input.multiRecordProbability,
            layoutHintConfidence: input.layoutConfidence,
            sampleRef: sample.sampleRef,
            sampleEvidenceRefs: sample.evidenceRefs,
            unassignedEvidenceRefs: input.result.unassignedEvidence,
            ignoredEvidenceRefs: input.ignoredEvidenceRefs,
            policy: input.result.policy
          }
        }
      }
    };
  });
}
