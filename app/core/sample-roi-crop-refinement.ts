import type { OCRBox, OCRPoint } from "./ocr-layout-model";
import {
  requireLuckyBeanRecognitionCore,
  type LuckyBeanCoreBlock,
  type LuckyBeanRecognitionRegion,
  type LuckyBeanRegionRecognitionResult
} from "./luckybean-upstream-adapter";
import {
  mapRegionPolygonToPage,
  REVIEWED_REGION_MAX_EDGE,
  ROI_RECOGNITION_PROTOCOL,
  type ROIRefinementProvenance,
  type ROIRefinementResult
} from "./sample-roi-refinement";
import type {
  SegmentationReviewLine,
  SegmentationReviewModel,
  SegmentationReviewRegion
} from "./sample-segmentation-review";

const FULL_FRAME_REGION: LuckyBeanRecognitionRegion = { left: 0, top: 0, right: 1, bottom: 1 };

function cleanText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function regionContract(region: OCRBox): LuckyBeanRecognitionRegion {
  return {
    left: clamp01(region.left),
    top: clamp01(region.top),
    right: clamp01(region.right),
    bottom: clamp01(region.bottom)
  };
}

function tuplePoint(value: unknown): OCRPoint | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const x = Number(source.x);
    const y = Number(source.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
  }
  return undefined;
}

function boundingBoxPolygon(value: unknown): OCRPoint[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const box = value as Record<string, unknown>;
  const left = Number(box.left ?? box.x);
  const top = Number(box.top ?? box.y);
  const rightValue = Number(box.right);
  const bottomValue = Number(box.bottom);
  const width = Number(box.width);
  const height = Number(box.height);
  const right = Number.isFinite(rightValue) ? rightValue : left + width;
  const bottom = Number.isFinite(bottomValue) ? bottomValue : top + height;
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return [];
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ];
}

function blockPolygon(block: LuckyBeanCoreBlock): OCRPoint[] {
  const direct = [...(block.polygon ?? block.corners ?? [])]
    .map(tuplePoint)
    .filter((point): point is OCRPoint => Boolean(point));
  return direct.length >= 2 ? direct : boundingBoxPolygon(block.boundingBox);
}

function boxFromNormalizedPolygon(polygon: readonly OCRPoint[]): OCRBox | undefined {
  if (polygon.length < 2) return undefined;
  const xs = polygon.map((point) => point.x).filter(Number.isFinite);
  const ys = polygon.map((point) => point.y).filter(Number.isFinite);
  if (!xs.length || !ys.length) return undefined;
  const left = clamp01(Math.min(...xs));
  const right = clamp01(Math.max(...xs));
  const top = clamp01(Math.min(...ys));
  const bottom = clamp01(Math.max(...ys));
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

function confidence(value: unknown, fallback = 0.75): number {
  const number = Number(value);
  return Number.isFinite(number) ? clamp01(number) : fallback;
}

function linesFromCropResult(
  result: LuckyBeanRegionRecognitionResult,
  region: SegmentationReviewRegion
): SegmentationReviewLine[] {
  const outputWidth = Number(result.outputWidth ?? 0);
  const outputHeight = Number(result.outputHeight ?? 0);
  const prefix = `roi-${region.id.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  const lines = [...(result.blocks ?? [])].flatMap((block, index) => {
    const text = cleanText(block.text ?? block.rawValue ?? block.value);
    if (!text) return [];
    const globalPolygon = mapRegionPolygonToPage(blockPolygon(block), region.box, outputWidth, outputHeight);
    const box = boxFromNormalizedPolygon(globalPolygon);
    if (!box) return [];
    return [{
      id: `${prefix}-${index + 1}`,
      blockId: `${prefix}-block-${index + 1}`,
      text,
      confidence: confidence(block.confidence ?? block.score),
      box
    }];
  });
  if (lines.length) return lines;
  const fallbackText = String(result.fullText ?? "")
    .split(/\n+/u)
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  if (!fallbackText) return [];
  return [{
    id: `${prefix}-fallback-1`,
    blockId: `${prefix}-fallback-block-1`,
    text: fallbackText,
    confidence: 0.55,
    box: { ...region.box }
  }];
}

function sortLines(lines: readonly SegmentationReviewLine[]): SegmentationReviewLine[] {
  return [...lines].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
}

function replaceRegionEvidence(
  model: SegmentationReviewModel,
  regionIndex: number,
  refinedLines: readonly SegmentationReviewLine[]
): SegmentationReviewModel {
  const region = model.regions[regionIndex];
  if (!region) throw new Error("待局部重识别的分区不存在");
  const oldIds = new Set(region.lineIds);
  const usedElsewhere = new Set(
    model.regions
      .filter((_, index) => index !== regionIndex)
      .flatMap((item) => [...item.lineIds])
  );
  const retained = model.lines.filter((line) => !oldIds.has(line.id) || usedElsewhere.has(line.id));
  const lineIds = refinedLines.map((line) => line.id);
  return {
    ...model,
    lines: sortLines([...retained, ...refinedLines]),
    regions: model.regions.map((item, index) => index === regionIndex ? { ...item, lineIds } : item)
  };
}

export async function refineSegmentationRegionEvidenceFromCrop(input: {
  fileName: string;
  cropBlob: Blob;
  model: SegmentationReviewModel;
  regionIndex: number;
}): Promise<ROIRefinementResult> {
  const region = input.model.regions[input.regionIndex];
  if (!region) throw new Error("待局部重识别的分区不存在");
  const core = requireLuckyBeanRecognitionCore();
  if (typeof core.recognizeImageRegion !== "function") throw new Error("当前 Recognition Foundation 尚未提供 ROI 二次识别接口");

  const result = await core.recognizeImageRegion({
    id: `roi-batch-crop-${Date.now().toString(36)}-${input.regionIndex + 1}`,
    role: "front",
    roleLabel: "批量预裁样品分区识别",
    blob: input.cropBlob,
    nativeSource: false,
    fileName: input.fileName
  }, FULL_FRAME_REGION, { locale: "zh-CN", maxEdge: REVIEWED_REGION_MAX_EDGE });
  if (result.regionProtocol && result.regionProtocol !== ROI_RECOGNITION_PROTOCOL) {
    throw new Error(`ROI 识别协议不兼容：${result.regionProtocol}`);
  }
  const refinedLines = linesFromCropResult(result, region);
  if (!refinedLines.length) throw new Error("局部重新识别没有得到可用文字，已保留原识别证据");
  const originalRegion = regionContract(region.box);
  const provenance: ROIRefinementProvenance = {
    protocol: ROI_RECOGNITION_PROTOCOL,
    status: "success",
    region: originalRegion,
    engine: `${String(result.engine ?? "unknown")}+batch-crop-decode-once`,
    blockCount: refinedLines.length,
    previousLineCount: region.lineIds.length,
    sourceWidth: Number(result.sourceWidth ?? 0) || undefined,
    sourceHeight: Number(result.sourceHeight ?? 0) || undefined,
    cropWidth: Number(result.cropWidth ?? 0) || undefined,
    cropHeight: Number(result.cropHeight ?? 0) || undefined,
    outputWidth: Number(result.outputWidth ?? 0) || undefined,
    outputHeight: Number(result.outputHeight ?? 0) || undefined
  };
  return { model: replaceRegionEvidence(input.model, input.regionIndex, refinedLines), provenance };
}
