import type { OCRBox, OCRPoint } from "./ocr-layout-model";
import {
  requireLuckyBeanRecognitionCore,
  type LuckyBeanCoreBlock,
  type LuckyBeanRecognitionRegion,
  type LuckyBeanRegionRecognitionResult
} from "./luckybean-upstream-adapter";
import type {
  SegmentationReviewLine,
  SegmentationReviewModel,
  SegmentationReviewRegion
} from "./sample-segmentation-review";
import type { RecognizedPage, RecognizedSample } from "./sample-recognition-service";

export const ROI_RECOGNITION_PROTOCOL = "recognition-roi/1.0" as const;

export interface ROIRefinementProvenance {
  protocol: typeof ROI_RECOGNITION_PROTOCOL;
  status: "not-requested" | "success" | "failed";
  region: LuckyBeanRecognitionRegion;
  engine?: string;
  blockCount?: number;
  previousLineCount?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  cropWidth?: number;
  cropHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  error?: string;
}

export interface ROIRefinementResult {
  model: SegmentationReviewModel;
  provenance: ROIRefinementProvenance;
}

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

function normalizedLocalPolygon(
  polygon: readonly OCRPoint[],
  outputWidth: number,
  outputHeight: number
): OCRPoint[] {
  if (polygon.length < 2) return [];
  const normalized = polygon.every((point) => point.x >= 0 && point.x <= 1.0001 && point.y >= 0 && point.y <= 1.0001);
  if (normalized) return polygon.map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }));
  if (!(outputWidth > 0) || !(outputHeight > 0)) return [];
  return polygon.map((point) => ({
    x: clamp01(point.x / outputWidth),
    y: clamp01(point.y / outputHeight)
  }));
}

export function mapRegionPolygonToPage(
  polygon: readonly OCRPoint[],
  region: Pick<OCRBox, "left" | "top" | "right" | "bottom">,
  outputWidth: number,
  outputHeight: number
): OCRPoint[] {
  const local = normalizedLocalPolygon(polygon, outputWidth, outputHeight);
  const width = Math.max(0, region.right - region.left);
  const height = Math.max(0, region.bottom - region.top);
  return local.map((point) => ({
    x: clamp01(region.left + point.x * width),
    y: clamp01(region.top + point.y * height)
  }));
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

function linesFromRegionResult(
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
  const regions = model.regions.map((item, index) => index === regionIndex
    ? { ...item, lineIds }
    : item);
  return {
    ...model,
    lines: sortLines([...retained, ...refinedLines]),
    regions
  };
}

export function regionRecognitionAvailable(): boolean {
  const core = requireLuckyBeanRecognitionCore();
  if (typeof core.recognizeImageRegion !== "function") return false;
  const capabilities = core.getRecognitionCapabilities?.();
  if (!capabilities) return true;
  return capabilities.nativeRegion === true || capabilities.webPaddleRegion === true;
}

export async function refineSegmentationRegionEvidence(input: {
  file: File;
  model: SegmentationReviewModel;
  regionIndex: number;
}): Promise<ROIRefinementResult> {
  const region = input.model.regions[input.regionIndex];
  if (!region) throw new Error("待局部重识别的分区不存在");
  const core = requireLuckyBeanRecognitionCore();
  if (typeof core.recognizeImageRegion !== "function") {
    throw new Error("当前 Recognition Foundation 尚未提供 ROI 二次识别接口");
  }
  const prepared = await core.preparePackageImage(input.file);
  const normalizedRegion = regionContract(region.box);
  const result = await core.recognizeImageRegion({
    id: `roi-source-${Date.now().toString(36)}`,
    role: "front",
    roleLabel: "样品分区二次识别",
    blob: prepared.blob,
    nativeSource: Boolean(prepared.nativeSource),
    fileName: input.file.name
  }, normalizedRegion, { locale: "zh-CN", maxEdge: 2200 });
  if (result.regionProtocol && result.regionProtocol !== ROI_RECOGNITION_PROTOCOL) {
    throw new Error(`ROI 识别协议不兼容：${result.regionProtocol}`);
  }
  const refinedLines = linesFromRegionResult(result, region);
  if (!refinedLines.length) throw new Error("局部重新识别没有得到可用文字，已保留原识别证据");
  return {
    model: replaceRegionEvidence(input.model, input.regionIndex, refinedLines),
    provenance: {
      protocol: ROI_RECOGNITION_PROTOCOL,
      status: "success",
      region: normalizedRegion,
      engine: String(result.engine ?? "unknown"),
      blockCount: refinedLines.length,
      previousLineCount: region.lineIds.length,
      sourceWidth: Number(result.sourceWidth ?? 0) || undefined,
      sourceHeight: Number(result.sourceHeight ?? 0) || undefined,
      cropWidth: Number(result.cropWidth ?? 0) || undefined,
      cropHeight: Number(result.cropHeight ?? 0) || undefined,
      outputWidth: Number(result.outputWidth ?? 0) || undefined,
      outputHeight: Number(result.outputHeight ?? 0) || undefined
    }
  };
}

export function failedROIRefinement(
  region: SegmentationReviewRegion,
  error: unknown
): ROIRefinementProvenance {
  return {
    protocol: ROI_RECOGNITION_PROTOCOL,
    status: "failed",
    region: regionContract(region.box),
    previousLineCount: region.lineIds.length,
    error: error instanceof Error ? error.message : String(error)
  };
}

function withRecognitionMetadata(
  sample: RecognizedSample,
  region: SegmentationReviewRegion,
  refinement: ROIRefinementProvenance | undefined
): RecognizedSample {
  const recognition = sample.metadata.recognition && typeof sample.metadata.recognition === "object"
    ? sample.metadata.recognition as Record<string, unknown>
    : {};
  const provenance: ROIRefinementProvenance = refinement ?? {
    protocol: ROI_RECOGNITION_PROTOCOL,
    status: "not-requested",
    region: regionContract(region.box),
    previousLineCount: region.lineIds.length
  };
  return {
    ...sample,
    metadata: {
      ...sample.metadata,
      recognition: {
        ...recognition,
        schemaVersion: "aromasense-recognition/3.4",
        roiRefinement: provenance
      }
    }
  };
}

export function attachROIRefinementProvenance(
  page: RecognizedPage,
  model: SegmentationReviewModel,
  refinements: ReadonlyMap<string, ROIRefinementProvenance>
): RecognizedPage {
  return {
    ...page,
    samples: page.samples.map((sample, index) => {
      const region = model.regions[index];
      if (!region) return sample;
      return withRecognitionMetadata(sample, region, refinements.get(region.id));
    })
  };
}
