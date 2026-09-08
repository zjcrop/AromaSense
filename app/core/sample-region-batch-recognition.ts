import {
  attachROIRefinementProvenance,
  refineSegmentationRegionEvidence,
  type ROIRefinementProvenance
} from "./sample-roi-refinement";
import {
  resegmentRecognizedPage,
  type SegmentationReviewModel
} from "./sample-segmentation-review";
import type { RecognizedPage } from "./sample-recognition-service";

export interface RegionBatchProgress {
  phase: "preparing" | "recognizing" | "parsing" | "completed";
  current: number;
  total: number;
  fraction: number;
  message: string;
  elapsedMs: number;
  estimatedRemainingMs?: number;
}

export interface RegionBatchRecognitionResult {
  page: RecognizedPage;
  model: SegmentationReviewModel;
  refinements: ReadonlyMap<string, ROIRefinementProvenance>;
  elapsedMs: number;
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function emit(
  callback: ((progress: RegionBatchProgress) => void) | undefined,
  startedAt: number,
  phase: RegionBatchProgress["phase"],
  current: number,
  total: number,
  fraction: number,
  message: string,
  estimatedRemainingMs?: number
): void {
  callback?.({
    phase,
    current,
    total,
    fraction: Math.max(0, Math.min(1, fraction)),
    message,
    elapsedMs: Math.max(0, now() - startedAt),
    ...(estimatedRemainingMs !== undefined ? { estimatedRemainingMs: Math.max(0, estimatedRemainingMs) } : {})
  });
}

/**
 * Re-reads every accepted region from the original File/Blob. Old OCR text is
 * never used as a fallback for an accepted region: if a crop cannot be read, the
 * batch stops and the review dialog stays open so stale evidence cannot become a
 * final sample record.
 */
export async function recognizeReviewedRegionsFromOriginal(input: {
  file: File;
  page: RecognizedPage;
  model: SegmentationReviewModel;
  onProgress?: (progress: RegionBatchProgress) => void;
}): Promise<RegionBatchRecognitionResult> {
  if (!input.model.regions.length) throw new Error("至少保留一个样品分区");

  const startedAt = now();
  const total = input.model.regions.length;
  let working = input.model;
  const refinements = new Map<string, ROIRefinementProvenance>();
  const durations: number[] = [];

  emit(input.onProgress, startedAt, "preparing", 0, total, 0.02, `准备从原图重新识别 ${total} 个分区`);

  for (let index = 0; index < total; index += 1) {
    const region = working.regions[index];
    if (!region) throw new Error(`分区 ${index + 1} 不存在`);
    const itemStartedAt = now();
    const completedBefore = index / total;
    const estimatedPerRegion = durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : undefined;
    const estimatedRemaining = estimatedPerRegion === undefined ? undefined : estimatedPerRegion * (total - index);
    emit(
      input.onProgress,
      startedAt,
      "recognizing",
      index + 1,
      total,
      0.04 + completedBefore * 0.88,
      `正在从原图识别分区 ${index + 1} / ${total}`,
      estimatedRemaining
    );

    const result = await refineSegmentationRegionEvidence({
      file: input.file,
      model: working,
      regionIndex: index
    });
    // This assignment is the evidence invalidation boundary. The returned model
    // contains fresh ROI lines for the current region and removes its old lines.
    working = result.model;
    refinements.set(region.id, result.provenance);
    durations.push(Math.max(1, now() - itemStartedAt));

    const averageDuration = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    emit(
      input.onProgress,
      startedAt,
      "recognizing",
      index + 1,
      total,
      0.04 + ((index + 1) / total) * 0.88,
      `原图分区 ${index + 1} / ${total} 识别完成`,
      averageDuration * (total - index - 1)
    );
  }

  emit(input.onProgress, startedAt, "parsing", total, total, 0.94, "正在重建样品字段并校验新证据", 0);
  const parsed = resegmentRecognizedPage(input.page, working);
  const page = attachROIRefinementProvenance(parsed, working, refinements);
  const elapsedMs = Math.max(0, now() - startedAt);
  emit(input.onProgress, startedAt, "completed", total, total, 1, `已完成 ${total} 个原图分区识别`, 0);
  return { page, model: working, refinements, elapsedMs };
}
