import type { OCRBox } from "./ocr-layout-model";
import {
  attachROIRefinementProvenance,
  refineSegmentationRegionEvidence
} from "./sample-roi-refinement";
import {
  normalizeRegionBox,
  resegmentRecognizedPage,
  type SegmentationReviewModel
} from "./sample-segmentation-review";
import type { RecognizedPage, RecognizedSample } from "./sample-recognition-service";

export interface ManualROIBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ManualROIRecognitionResult {
  page: RecognizedPage;
  sample: RecognizedSample;
  box: OCRBox;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function placeholderLabel(value: string): boolean {
  return !value.trim() || /^待确认样品\s+\d+$/u.test(value.trim());
}

/**
 * Runs one user-selected rectangle through the existing Foundation ROI protocol.
 * The preview is never an OCR source: normalized coordinates are applied to the
 * untouched original File by recognizeImageRegion.
 */
export async function recognizeManualROIFromOriginal(input: {
  file: File;
  page: RecognizedPage;
  box: ManualROIBox;
  label?: string;
}): Promise<ManualROIRecognitionResult> {
  const box = normalizeRegionBox(input.box);
  const id = `manual-roi-${Date.now().toString(36)}`;
  const model: SegmentationReviewModel = {
    fileName: input.page.fileName,
    engine: input.page.engine,
    lines: [],
    regions: [{ id, label: input.label?.trim() ?? "", box, lineIds: [] }]
  };
  const refined = await refineSegmentationRegionEvidence({
    file: input.file,
    model,
    regionIndex: 0
  });
  const parsed = resegmentRecognizedPage(input.page, refined.model);
  const page = attachROIRefinementProvenance(
    parsed,
    refined.model,
    new Map([[id, refined.provenance]])
  );
  const sample = page.samples[0];
  if (!sample) throw new Error("局部识别没有形成可用样品信息");
  return { page, sample, box };
}

/**
 * Supplemental ROI evidence never silently overwrites a conflicting full-image
 * field. Empty fields are filled, matching fields are accepted, and conflicts are
 * surfaced as review candidates while both evidence sources remain auditable.
 */
export function mergeSupplementalRecognizedSample(
  base: RecognizedSample,
  supplemental: RecognizedSample,
  box: Pick<OCRBox, "left" | "top" | "right" | "bottom">
): RecognizedSample {
  const metadata: Record<string, unknown> = { ...base.metadata };
  const supplementalFields: Record<string, string> = {};
  const appliedFields: string[] = [];
  const conflicts: Array<{ field: string; current: string; supplemental: string }> = [];

  for (const [key, raw] of Object.entries(supplemental.metadata)) {
    if (key === "recognition") continue;
    const incoming = text(raw);
    if (!incoming) continue;
    supplementalFields[key] = incoming;
    const current = text(metadata[key]);
    if (!current) {
      metadata[key] = incoming;
      appliedFields.push(key);
    } else if (current !== incoming) {
      conflicts.push({ field: key, current, supplemental: incoming });
    }
  }

  const baseRecognition = record(metadata.recognition) ?? {};
  const previousReview = Array.isArray(baseRecognition.review) ? [...baseRecognition.review] : [];
  const conflictReview = conflicts.map((item) => ({
    field: item.field,
    value: item.current,
    confidence: 0.5,
    candidates: [
      { value: item.current, normalizedValue: item.current, score: 0.51 },
      { value: item.supplemental, normalizedValue: item.supplemental, score: 0.5 }
    ],
    source: "manual_roi_conflict"
  }));
  const existingROI = Array.isArray(baseRecognition.supplementalROI)
    ? [...baseRecognition.supplementalROI]
    : [];
  metadata.recognition = {
    ...baseRecognition,
    review: [...previousReview, ...conflictReview],
    supplementalROI: [...existingROI, {
      source: "manual_roi",
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      engine: supplemental.engine,
      rawText: supplemental.rawText,
      fields: supplementalFields,
      appliedFields,
      conflicts,
      capturedAt: new Date().toISOString()
    }]
  };

  const baseLabel = base.label.trim();
  const supplementalLabel = supplemental.label.trim();
  return {
    ...base,
    label: placeholderLabel(baseLabel) && !placeholderLabel(supplementalLabel) ? supplementalLabel : base.label,
    rawText: base.rawText,
    confidence: Math.max(Number(base.confidence ?? 0), Number(supplemental.confidence ?? 0)) || undefined,
    requiresReview: base.requiresReview || supplemental.requiresReview || conflicts.length > 0,
    metadata
  };
}
