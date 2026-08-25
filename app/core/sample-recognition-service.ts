import { buildOCRLayoutDocument, type OCRLineInput } from "./ocr-layout-model";
import {
  loadBundledLuckyBeanRecognitionBook,
  luckyBeanCoreVersion,
  requireLuckyBeanRecognitionCore,
  type LuckyBeanAnalysisField,
  type LuckyBeanRecognitionAnalysis
} from "./luckybean-upstream-adapter";
import { segmentSamples, type SampleLayoutType, type SampleLayoutSegment } from "./sample-layout-segmenter";

export interface SampleRecognitionProgress {
  index: number;
  total: number;
  fileName: string;
  status: "processing" | "completed" | "failed";
  message?: string;
}

export interface RecognizedSample {
  label: string;
  rawText: string;
  engine: string;
  confidence?: number;
  requiresReview: boolean;
  metadata: Record<string, unknown>;
}

export interface RecognizedPage {
  fileName: string;
  engine: string;
  layoutType: SampleLayoutType;
  segmentationConfidence: number;
  requiresSegmentationReview: boolean;
  samples: readonly RecognizedSample[];
}

interface NativeOCRLine {
  id?: string;
  blockId?: string;
  text?: string;
  confidence?: number;
  polygon?: readonly (readonly [number, number] | { x: number; y: number })[];
  box?: Record<string, number>;
}

interface NativeRecognitionResult {
  text?: string;
  fullText?: string;
  engine?: string;
  confidence?: number;
  blocks?: readonly NativeOCRLine[];
  lines?: readonly NativeOCRLine[];
  sourceWidth?: number;
  sourceHeight?: number;
  error?: string;
}

interface NativeRecognitionBridge {
  recognizeSampleImage?(payloadJson: string): NativeRecognitionResult | string | Promise<NativeRecognitionResult | string>;
}

interface TextDetection {
  rawValue?: string;
  text?: string;
  confidence?: number;
  boundingBox?: DOMRectReadOnly | { x: number; y: number; width: number; height: number };
  cornerPoints?: readonly { x: number; y: number }[];
}

interface TextDetectorLike {
  detect(image: ImageBitmap): Promise<readonly TextDetection[]>;
}

interface TesseractWorkerLike {
  recognize(image: Blob): Promise<{ data?: { text?: string; confidence?: number } }>;
  setParameters?(parameters: Record<string, string>): Promise<void>;
}

interface TesseractLike {
  createWorker(
    languages: readonly string[] | string,
    oem?: number,
    options?: { logger?(message: { status?: string; progress?: number }): void }
  ): Promise<TesseractWorkerLike>;
}

const TESSERACT_VERSION = "6.0.1";
const TESSERACT_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
let tesseractLoader: Promise<TesseractLike> | undefined;
let workerPromise: Promise<TesseractWorkerLike> | undefined;

function runtimeWindow(): Window & typeof globalThis & {
  AromaSenseRecognitionBridge?: NativeRecognitionBridge;
  TextDetector?: new () => TextDetectorLike;
  Tesseract?: TesseractLike;
} {
  return window as Window & typeof globalThis & {
    AromaSenseRecognitionBridge?: NativeRecognitionBridge;
    TextDetector?: new () => TextDetectorLike;
    Tesseract?: TesseractLike;
  };
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片编码失败"));
    reader.readAsDataURL(blob);
  });
}

function parseNativeResult(value: NativeRecognitionResult | string): NativeRecognitionResult {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as NativeRecognitionResult;
  } catch {
    return { fullText: value, engine: "android-native-ocr" };
  }
}

async function recognizeNative(file: File, id: string): Promise<NativeRecognitionResult | undefined> {
  const bridge = runtimeWindow().AromaSenseRecognitionBridge;
  if (typeof bridge?.recognizeSampleImage !== "function") return undefined;
  const payload = JSON.stringify({
    id,
    fileName: file.name,
    mimeType: file.type || "image/jpeg",
    dataUrl: await blobToDataUrl(file),
    locale: "zh-CN"
  });
  const result = parseNativeResult(await bridge.recognizeSampleImage(payload));
  if (result.error) throw new Error(result.error);
  return result;
}

async function recognizeTextDetector(file: File): Promise<NativeRecognitionResult | undefined> {
  const Detector = runtimeWindow().TextDetector;
  if (typeof Detector !== "function" || typeof createImageBitmap !== "function") return undefined;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const detections = await new Detector().detect(bitmap);
    const lines: NativeOCRLine[] = detections.flatMap((item, index) => {
      const text = cleanText(item.rawValue ?? item.text);
      if (!text) return [];
      const box = item.boundingBox;
      const polygon = item.cornerPoints?.length
        ? item.cornerPoints
        : box
          ? [
              { x: box.x, y: box.y },
              { x: box.x + box.width, y: box.y },
              { x: box.x + box.width, y: box.y + box.height },
              { x: box.x, y: box.y + box.height }
            ]
          : undefined;
      return [{ id: `browser-line-${index + 1}`, text, confidence: item.confidence, polygon }];
    });
    if (!lines.length) return undefined;
    const confidenceValues = lines.map((item) => Number(item.confidence)).filter(Number.isFinite);
    return {
      fullText: lines.map((item) => item.text).join("\n"),
      lines,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      engine: "browser-text-detector",
      confidence: confidenceValues.length
        ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
        : undefined
    };
  } finally {
    bitmap.close();
  }
}

function ensureTesseract(): Promise<TesseractLike> {
  const current = runtimeWindow().Tesseract;
  if (current?.createWorker) return Promise.resolve(current);
  if (tesseractLoader) return tesseractLoader;
  tesseractLoader = new Promise<TesseractLike>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_URL;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.onload = () => {
      const loaded = runtimeWindow().Tesseract;
      if (loaded?.createWorker) resolve(loaded);
      else reject(new Error("网页 OCR 主程序未正确加载"));
    };
    script.onerror = () => reject(new Error("网页 OCR 主程序下载失败，请检查网络"));
    document.head.append(script);
  }).catch((error) => {
    tesseractLoader = undefined;
    throw error;
  });
  return tesseractLoader;
}

async function ensureTesseractWorker(
  onEngineProgress?: (message: string, progress: number) => void
): Promise<TesseractWorkerLike> {
  if (!workerPromise) {
    workerPromise = ensureTesseract().then((tesseract) => tesseract.createWorker(["chi_sim", "eng"], 1, {
      logger(message) {
        onEngineProgress?.(String(message.status ?? "正在识别"), Number(message.progress ?? 0));
      }
    }));
  }
  return workerPromise;
}

async function recognizeTesseract(file: File): Promise<NativeRecognitionResult> {
  const worker = await ensureTesseractWorker();
  await worker.setParameters?.({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1", user_defined_dpi: "300" });
  const result = await worker.recognize(file);
  return {
    fullText: cleanText(result.data?.text),
    engine: `tesseract.js-${TESSERACT_VERSION}-chi_sim+eng`,
    confidence: Number.isFinite(Number(result.data?.confidence)) ? Number(result.data?.confidence) / 100 : undefined
  };
}

function ocrLines(result: NativeRecognitionResult): OCRLineInput[] {
  return [...(result.lines ?? result.blocks ?? [])].map((line, index) => ({
    id: line.id ?? `ocr-line-${index + 1}`,
    blockId: line.blockId,
    text: line.text,
    confidence: line.confidence,
    polygon: line.polygon,
    box: line.box
  }));
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
  return (analysis.fields ?? []).filter((item) => item.status === "review").map((item) => ({
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

function analysisConfidence(analysis: LuckyBeanRecognitionAnalysis, fallback: number): number {
  const values = (analysis.fields ?? [])
    .map((item) => Number(item.confidence))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : fallback;
}

function likelyLabel(fields: Record<string, string>, sampleIndex: number): string {
  const parts = [fields.farm, fields.station, fields.region, fields.origin, fields.variety, fields.country]
    .filter((value): value is string => Boolean(value));
  if (parts.length) return [...new Set(parts)].slice(0, 2).join(" · ").slice(0, 80);
  return `待确认样品 ${String(sampleIndex + 1).padStart(2, "0")}`;
}

function luckyBeanBlocks(segment: SampleLayoutSegment, imageId: string) {
  return segment.lines.map((line, index) => ({
    id: line.id,
    imageId,
    imageRole: "front",
    order: index,
    text: line.text,
    confidence: line.confidence,
    polygon: line.polygon.length
      ? line.polygon
      : [
          { x: line.box.left, y: line.box.top },
          { x: line.box.right, y: line.box.top },
          { x: line.box.right, y: line.box.bottom },
          { x: line.box.left, y: line.box.bottom }
        ]
  }));
}

function analyzeWithLuckyBean(
  segment: SampleLayoutSegment,
  imageId: string,
  engine: string
): LuckyBeanRecognitionAnalysis {
  const core = requireLuckyBeanRecognitionCore();
  const book = loadBundledLuckyBeanRecognitionBook();
  const document = core.createRecognitionDocument({
    images: [{ id: imageId, role: "front", roleLabel: "样品图片" }],
    blocks: luckyBeanBlocks(segment, imageId),
    engine,
    fullText: segment.text
  });
  return core.analyzeRecognitionDocument(document, book);
}

export class SampleRecognitionService {
  async warmup(): Promise<{ engine: string; ready: boolean; message: string }> {
    try {
      requireLuckyBeanRecognitionCore();
      loadBundledLuckyBeanRecognitionBook();
    } catch (error) {
      return { engine: "unavailable", ready: false, message: error instanceof Error ? error.message : String(error) };
    }
    const version = luckyBeanCoreVersion();
    if (typeof runtimeWindow().AromaSenseRecognitionBridge?.recognizeSampleImage === "function") {
      return {
        engine: "android-mlkit+luckybean-production",
        ready: true,
        message: `Android 本地图像识别 + LuckyBean 正式识别核心 ${version} 已就绪`
      };
    }
    if (typeof runtimeWindow().TextDetector === "function") {
      return {
        engine: "browser-text-detector+luckybean-production",
        ready: true,
        message: `浏览器图像识别 + LuckyBean 正式识别核心 ${version} 已就绪`
      };
    }
    try {
      await ensureTesseractWorker();
      return {
        engine: `tesseract.js-${TESSERACT_VERSION}+luckybean-production`,
        ready: true,
        message: `网页图像识别 + LuckyBean 正式识别核心 ${version} 已就绪`
      };
    } catch (error) {
      return { engine: "unavailable", ready: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async recognizePage(file: File, index = 0): Promise<RecognizedPage> {
    const id = `sample-image-${Date.now().toString(36)}-${index}`;
    let result = await recognizeNative(file, id);
    if (!result) result = await recognizeTextDetector(file);
    if (!result || !cleanText(result.fullText ?? result.text)) result = await recognizeTesseract(file);
    const rawText = cleanText(result.fullText ?? result.text);
    if (!rawText) throw new Error("没有识别到可用文字，请补拍或手工填写样品名称");

    const document = buildOCRLayoutDocument({
      imageId: id,
      lines: ocrLines(result),
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      fallbackText: rawText
    });
    const layout = segmentSamples(document);
    const engine = result.engine ?? "OCR";
    const samples = layout.segments.map((segment, sampleIndex) => {
      const analysis = analyzeWithLuckyBean(segment, id, engine);
      const fields = analysisFields(analysis);
      const review = analysisReview(analysis);
      const semanticConfidence = analysisConfidence(analysis, Number(result.confidence ?? 0.55));
      const confidence = Math.min(segment.confidence, semanticConfidence);
      const requiresReview = layout.requiresReview || Number(analysis.reviewCount ?? 0) > 0 || !Object.keys(fields).length;
      const upstreamDocument = analysis.document ?? {};
      return {
        label: likelyLabel(fields, sampleIndex),
        rawText: segment.text,
        engine: `${engine}+${String(analysis.pipelineVersion ?? luckyBeanCoreVersion())}`,
        confidence,
        requiresReview,
        metadata: {
          ...fields,
          recognition: {
            schemaVersion: "aromasense-recognition/3.0",
            source: "photo",
            fileName: file.name,
            mimeType: file.type,
            engine,
            pageLayout: layout.layoutType,
            segmentationConfidence: segment.confidence,
            segmentationRequiresReview: layout.requiresReview,
            segmentId: segment.id,
            segmentBox: segment.box,
            rawText: segment.text,
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
            evidenceLines: segment.lines.map((line) => ({
              id: line.id,
              blockId: line.blockId,
              text: line.text,
              confidence: line.confidence,
              box: line.normalizedBox
            }))
          }
        }
      } satisfies RecognizedSample;
    });
    if (!samples.length) throw new Error("未能从图片中形成有效样品区块，请重新拍摄或手工添加");
    return {
      fileName: file.name,
      engine,
      layoutType: layout.layoutType,
      segmentationConfidence: layout.confidence,
      requiresSegmentationReview: layout.requiresReview,
      samples
    };
  }

  async recognize(file: File, index = 0): Promise<RecognizedSample> {
    const page = await this.recognizePage(file, index);
    return page.samples[0];
  }

  async recognizeBatch(
    files: readonly File[],
    onProgress?: (progress: SampleRecognitionProgress) => void
  ): Promise<readonly (RecognizedPage | Error)[]> {
    const results: (RecognizedPage | Error)[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      onProgress?.({ index: index + 1, total: files.length, fileName: file.name, status: "processing" });
      try {
        const recognized = await this.recognizePage(file, index);
        results.push(recognized);
        onProgress?.({
          index: index + 1,
          total: files.length,
          fileName: file.name,
          status: "completed",
          message: recognized.samples.length > 1
            ? `识别到 ${recognized.samples.length} 个样品区块 · LuckyBean 正式识别核心完成`
            : "LuckyBean 正式识别核心完成"
        });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        results.push(normalized);
        onProgress?.({
          index: index + 1,
          total: files.length,
          fileName: file.name,
          status: "failed",
          message: normalized.message
        });
      }
    }
    return results;
  }
}
