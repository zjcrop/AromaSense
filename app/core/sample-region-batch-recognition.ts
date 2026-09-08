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
import { requireLuckyBeanRecognitionCore } from "./luckybean-upstream-adapter";

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

const STEADY_REGION_DEFAULT_MS = 4_200;
const STEADY_REGION_MIN_MS = 1_500;
const STEADY_REGION_MAX_MS = 9_000;

function median(values: readonly number[]): number | undefined {
  const sorted = values.filter(Number.isFinite).filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function estimateRegionBatchRemainingMs(
  durations: readonly number[],
  remainingRegions: number
): number | undefined {
  if (remainingRegions <= 0) return 0;
  if (!durations.length) return undefined;
  // Region 1 includes OCR model/session cold-start on many browsers. Never multiply
  // that one-time cost by every remaining crop. Once region 2+ exists, use their
  // median as the steady-state per-region cost.
  const steadySamples = durations.slice(1);
  const observed = median(steadySamples);
  const firstRegionDerived = Math.max(STEADY_REGION_MIN_MS, Math.min(STEADY_REGION_MAX_MS, durations[0] * 0.18));
  const perRegion = observed === undefined
    ? Math.min(STEADY_REGION_DEFAULT_MS * 1.35, firstRegionDerived)
    : Math.max(STEADY_REGION_MIN_MS, Math.min(STEADY_REGION_MAX_MS, observed));
  return Math.round(perRegion * remainingRegions);
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

  emit(input.onProgress, startedAt, "preparing", 0, total, 0.02, `准备一次原图并识别 ${total} 个分区`);
  const preparedImage = await requireLuckyBeanRecognitionCore().preparePackageImage(input.file);

  for (let index = 0; index < total; index += 1) {
    const region = working.regions[index];
    if (!region) throw new Error(`分区 ${index + 1} 不存在`);
    const itemStartedAt = now();
    const completedBefore = index / total;
    const estimatedRemaining = estimateRegionBatchRemainingMs(durations, total - index);
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
      preparedImage,
      model: working,
      regionIndex: index
    });
    // This assignment is the evidence invalidation boundary. The returned model
    // contains fresh ROI lines for the current region and removes its old lines.
    working = result.model;
    refinements.set(region.id, result.provenance);
    durations.push(Math.max(1, now() - itemStartedAt));

    emit(
      input.onProgress,
      startedAt,
      "recognizing",
      index + 1,
      total,
      0.04 + ((index + 1) / total) * 0.88,
      `原图分区 ${index + 1} / ${total} 识别完成`,
      estimateRegionBatchRemainingMs(durations, total - index - 1)
    );
  }

  emit(input.onProgress, startedAt, "parsing", total, total, 0.94, "正在重建样品字段并校验新证据", 0);
  const parsed = resegmentRecognizedPage(input.page, working);
  const page = attachROIRefinementProvenance(parsed, working, refinements);
  const elapsedMs = Math.max(0, now() - startedAt);
  emit(input.onProgress, startedAt, "completed", total, total, 1, `已完成 ${total} 个原图分区识别`, 0);
  return { page, model: working, refinements, elapsedMs };
}
