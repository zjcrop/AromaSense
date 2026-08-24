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
  metadata: Record<string, unknown>;
}

interface NativeRecognitionResult {
  text?: string;
  fullText?: string;
  engine?: string;
  confidence?: number;
  fields?: Record<string, unknown>;
}

interface NativeRecognitionBridge {
  recognizeSampleImage?(payload: {
    id: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
    locale: string;
  }): NativeRecognitionResult | string | Promise<NativeRecognitionResult | string>;
}

interface TextDetection {
  rawValue?: string;
  text?: string;
  confidence?: number;
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

async function recognizeNative(file: File, id: string): Promise<NativeRecognitionResult | undefined> {
  const bridge = runtimeWindow().AromaSenseRecognitionBridge;
  if (typeof bridge?.recognizeSampleImage !== "function") return undefined;
  const value = await bridge.recognizeSampleImage({
    id,
    fileName: file.name,
    mimeType: file.type || "image/jpeg",
    dataUrl: await blobToDataUrl(file),
    locale: "zh-CN"
  });
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as NativeRecognitionResult;
    } catch {
      return { fullText: value, engine: "android-native-ocr" };
    }
  }
  return value;
}

async function recognizeTextDetector(file: File): Promise<NativeRecognitionResult | undefined> {
  const Detector = runtimeWindow().TextDetector;
  if (typeof Detector !== "function" || typeof createImageBitmap !== "function") return undefined;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const detections = await new Detector().detect(bitmap);
    const texts = detections.map((item) => cleanText(item.rawValue ?? item.text)).filter(Boolean);
    if (!texts.length) return undefined;
    const confidenceValues = detections
      .map((item) => Number(item.confidence))
      .filter((value) => Number.isFinite(value));
    return {
      fullText: texts.join("\n"),
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

async function recognizeTesseract(
  file: File,
  onEngineProgress?: (message: string, progress: number) => void
): Promise<NativeRecognitionResult> {
  if (!workerPromise) {
    workerPromise = ensureTesseract().then((tesseract) => tesseract.createWorker(["chi_sim", "eng"], 1, {
      logger(message) {
        onEngineProgress?.(String(message.status ?? "正在识别"), Number(message.progress ?? 0));
      }
    }));
  }
  const worker = await workerPromise;
  await worker.setParameters?.({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1", user_defined_dpi: "300" });
  const result = await worker.recognize(file);
  return {
    fullText: cleanText(result.data?.text),
    engine: `tesseract.js-${TESSERACT_VERSION}-chi_sim+eng`,
    confidence: Number.isFinite(Number(result.data?.confidence)) ? Number(result.data?.confidence) / 100 : undefined
  };
}

const FIELD_ALIASES: readonly [string, readonly string[]][] = [
  ["country", ["国家", "产地", "country", "origin"]],
  ["region", ["产区", "地区", "region", "area"]],
  ["farm", ["庄园", "农场", "处理站", "farm", "estate", "station"]],
  ["variety", ["豆种", "品种", "variety", "cultivar"]],
  ["process", ["处理法", "处理方式", "process", "processing"]],
  ["roastDate", ["烘焙日期", "烘焙日", "roast date", "roasted on", "roasted"]],
  ["altitude", ["海拔", "altitude", "elevation"]],
  ["flavorNotes", ["风味", "风味描述", "flavor", "flavour", "tasting notes", "notes"]]
];

function parseFields(text: string): Record<string, string> {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const fields: Record<string, string> = {};
  for (const line of lines) {
    for (const [field, aliases] of FIELD_ALIASES) {
      if (fields[field]) continue;
      for (const alias of aliases) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = line.match(new RegExp(`(?:^|\\s)${escaped}\\s*[:：/\\-]?\\s*(.+)$`, "i"));
        if (match?.[1]?.trim()) {
          fields[field] = match[1].trim();
          break;
        }
      }
    }
  }
  return fields;
}

function likelyLabel(text: string, fields: Record<string, string>, fallback: string): string {
  const composed = [fields.farm, fields.region, fields.variety].filter(Boolean).slice(0, 2).join(" · ");
  if (composed) return composed.slice(0, 80);
  const excluded = /^(coffee|specialty coffee|咖啡|精品咖啡|product|产品|净含量|net weight|roast date|烘焙日期)\b/i;
  const line = text.split(/\n+/)
    .map((item) => item.trim())
    .find((item) => item.length >= 2 && item.length <= 80 && /[A-Za-z\u3400-\u9FFF]/.test(item) && !excluded.test(item));
  return line ?? fallback.replace(/\.[^.]+$/, "").slice(0, 80) || "未命名样品";
}

export class SampleRecognitionService {
  async recognize(file: File, index = 0): Promise<RecognizedSample> {
    const id = `sample-image-${Date.now().toString(36)}-${index}`;
    let result = await recognizeNative(file, id);
    if (!result) result = await recognizeTextDetector(file);
    if (!result || !cleanText(result.fullText ?? result.text)) {
      result = await recognizeTesseract(file);
    }
    const rawText = cleanText(result.fullText ?? result.text);
    if (!rawText) throw new Error("没有识别到可用文字，请补拍或手工填写样品名称");
    const fields = { ...parseFields(rawText), ...(result.fields ?? {}) };
    return {
      label: likelyLabel(rawText, fields as Record<string, string>, file.name),
      rawText,
      engine: result.engine ?? "OCR",
      confidence: result.confidence,
      metadata: {
        recognition: {
          source: "photo",
          fileName: file.name,
          mimeType: file.type,
          engine: result.engine ?? "OCR",
          confidence: result.confidence,
          rawText,
          fields
        },
        ...fields
      }
    };
  }

  async recognizeBatch(
    files: readonly File[],
    onProgress?: (progress: SampleRecognitionProgress) => void
  ): Promise<readonly (RecognizedSample | Error)[]> {
    const results: (RecognizedSample | Error)[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      onProgress?.({ index: index + 1, total: files.length, fileName: file.name, status: "processing" });
      try {
        const recognized = await this.recognize(file, index);
        results.push(recognized);
        onProgress?.({ index: index + 1, total: files.length, fileName: file.name, status: "completed" });
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
