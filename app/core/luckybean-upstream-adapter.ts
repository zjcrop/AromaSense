const RECOGNITION_CACHE_KEY = "aromasense.luckybean-recognition-book.v1";

export interface LuckyBeanRecognitionBook {
  version?: unknown;
  countries?: unknown[];
  regions?: unknown[];
  entities?: unknown[];
  varieties?: unknown[];
  processes?: unknown[];
  flavors?: unknown[];
  labelLexicon?: unknown;
  [key: string]: unknown;
}

export interface LuckyBeanCoreBlock {
  id?: string;
  imageId?: string;
  imageRole?: string;
  order?: number;
  text?: string;
  rawValue?: string;
  value?: string;
  confidence?: number;
  score?: number;
  polygon?: readonly ({ x: number; y: number } | readonly [number, number])[];
  corners?: readonly ({ x: number; y: number } | readonly [number, number])[];
  boundingBox?: Record<string, number>;
}

export interface LuckyBeanRecognitionDocument {
  schemaVersion?: string;
  parserVersion?: string;
  engine?: string;
  images?: readonly unknown[];
  blocks?: readonly unknown[];
  relations?: readonly unknown[];
  rawFullText?: string;
  fullText?: string;
  [key: string]: unknown;
}

export interface LuckyBeanAnalysisCandidate {
  value?: string;
  confidence?: number;
  explicit?: boolean;
  imageCount?: number;
  score?: number;
  imageIds?: readonly string[];
}

export interface LuckyBeanAnalysisField {
  field?: string;
  label?: string;
  rawValue?: string;
  standardValue?: string;
  confidence?: number;
  resolved?: boolean;
  translated?: boolean;
  status?: "review" | "translated" | "resolved" | string;
  sources?: readonly unknown[];
  resolution?: {
    conflict?: boolean;
    reason?: string;
    candidates?: readonly LuckyBeanAnalysisCandidate[];
    [key: string]: unknown;
  };
}

export interface LuckyBeanRecognitionAnalysis {
  pipelineVersion?: string;
  document?: LuckyBeanRecognitionDocument;
  semanticText?: string;
  parsed?: Record<string, unknown>;
  fields?: readonly LuckyBeanAnalysisField[];
  resolvedCount?: number;
  reviewCount?: number;
}

export interface LuckyBeanRecognitionCore {
  RECOGNITION_DOCUMENT_SCHEMA?: string;
  RECOGNITION_PIPELINE_VERSION?: string;
  createRecognitionDocument(input: {
    images?: readonly { id?: string; role?: string; roleLabel?: string }[];
    blocks?: readonly LuckyBeanCoreBlock[];
    engine?: string;
    fullText?: string;
    createdAt?: string;
  }): LuckyBeanRecognitionDocument;
  analyzeRecognitionDocument(
    document: LuckyBeanRecognitionDocument,
    book: LuckyBeanRecognitionBook
  ): LuckyBeanRecognitionAnalysis;
}

function runtimeCore(): LuckyBeanRecognitionCore | undefined {
  return (globalThis as typeof globalThis & { LuckyBeanRecognitionCore?: LuckyBeanRecognitionCore }).LuckyBeanRecognitionCore;
}

export function requireLuckyBeanRecognitionCore(): LuckyBeanRecognitionCore {
  const core = runtimeCore();
  if (typeof core?.createRecognitionDocument !== "function" || typeof core?.analyzeRecognitionDocument !== "function") {
    throw new Error("LuckyBean 正式识别核心未加载；AromaSense 不再使用兼容版识别器");
  }
  return core;
}

function validBook(value: unknown): value is LuckyBeanRecognitionBook {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const book = value as LuckyBeanRecognitionBook;
  return ["countries", "regions", "entities", "varieties", "processes", "flavors"]
    .every((key) => Array.isArray(book[key]) && (book[key] as unknown[]).length > 0);
}

export function loadBundledLuckyBeanRecognitionBook(): LuckyBeanRecognitionBook {
  let raw = "";
  try {
    raw = globalThis.localStorage?.getItem(RECOGNITION_CACHE_KEY) ?? "";
  } catch {
    raw = "";
  }
  if (!raw) throw new Error("LuckyBean 完整识别编码表未随当前构建加载");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("LuckyBean 识别编码表缓存损坏，请重新加载应用");
  }
  if (!validBook(parsed)) throw new Error("LuckyBean 识别编码表不完整，请重新构建或重新加载应用");
  return parsed;
}

export function luckyBeanCoreVersion(): string {
  const core = runtimeCore();
  return String(core?.RECOGNITION_PIPELINE_VERSION ?? "unavailable");
}
