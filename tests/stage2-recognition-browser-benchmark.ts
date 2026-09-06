import localSchema from "../app/storage/0001_local_schema.sql";
import sessionMetadataMigration from "../app/storage/0002_session_metadata.sql";
import workflowMigration from "../app/storage/0003_workflow_event_comparison.sql";
import submissionMigration from "../app/storage/0004_submission_revisions.sql";
import sessionTimingMigration from "../app/storage/0005_session_timing.sql";
import yingxiangEventMigration from "../app/storage/0006_yingxiang_event_context.sql";
import yingxiangCollectionMigration from "../app/storage/0007_yingxiang_collection.sql";
import { buildOCRLayoutDocument, type OCRLineInput } from "../app/core/ocr-layout-model";
import { segmentSamples } from "../app/core/sample-layout-segmenter";
import { refineAmbiguousSingleSampleLayout } from "../app/core/sample-multi-entry-refinement";
import {
  loadBundledLuckyBeanRecognitionBook,
  requireLuckyBeanRecognitionCore,
  type LuckyBeanCoreBlock,
  type LuckyBeanRecognitionAnalysis,
  type LuckyBeanRecognitionCore
} from "../app/core/luckybean-upstream-adapter";
import { BrowserSQLiteDriver } from "../app/storage/browser-sqlite-driver";
import { LocalMigrationRunner } from "../app/storage/local-migration-runner";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { CuppingSetupService } from "../app/core/cupping-setup-service";
import { openBatchReviewDialog, type BatchReviewField } from "../app/ui/dom/batch-review-dialog";

interface DiagnosticEvent {
  scope: string;
  phase: string;
  durationMs: number;
  engaged?: boolean;
  mode?: string;
  [key: string]: unknown;
}

interface Fixture {
  file: File;
  width: number;
  height: number;
}

interface Stage2CaseResult {
  imagePreparationMs: number;
  ocrMs: number;
  ocrRuntimeInitMs: number;
  ocrPredictMs: number;
  layoutDocumentMs: number;
  primarySegmentationMs: number;
  recordGroupingRefinementMs: number;
  recognitionDocumentMs: number;
  semanticMs: number;
  canonicalMs: number;
  aiMs: number;
  aiEngaged: boolean;
  analysisEnvelopeMs: number;
  totalRecognitionMs: number;
  samples: number;
  layoutType: string;
  requiresSegmentationReview: boolean;
  engine: string;
  segmentProfiles: string[];
  diagnostics: DiagnosticEvent[];
}

interface Stage2BenchmarkResult {
  fixtureKind: "deterministic-camera-like-jpeg";
  runtime: {
    providerVersion: string;
    workerOnly: boolean | null;
    browserSafe: boolean | null;
    primaryIsolation: string;
    autoPreload: boolean | null;
  };
  singleCold: Stage2CaseResult;
  multiEntryWarm: Stage2CaseResult;
  persistenceMs: number;
  persistedSamples: number;
  uiRenderMs: number;
  uiFieldCount: number;
  semanticCanonicalSplitAvailable: true;
  note: string;
}

declare global {
  interface Window {
    LuckyBeanRecognitionCore?: LuckyBeanRecognitionCore;
    LuckyBeanPaddleOCR?: Record<string, unknown>;
    __LUCKYBEAN_RECOGNITION_DIAGNOSTICS__?: { record(event: DiagnosticEvent): void };
    Stage2AromaSenseBenchmark?: { run(): Promise<Stage2BenchmarkResult> };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(events: readonly DiagnosticEvent[], scope: string, phases: readonly string[]): number {
  const selected = new Set(phases);
  return round(events
    .filter((event) => event.scope === scope && selected.has(event.phase))
    .reduce((total, event) => total + Number(event.durationMs || 0), 0));
}

async function canvasFixture(
  name: string,
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void
): Promise<Fixture> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.fillStyle = "#f1ebe0";
  context.fillRect(0, 0, width, height);
  draw(context);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("Stage 2 fixture JPEG creation failed")),
    "image/jpeg",
    0.9
  ));
  return { file: new File([blob], name, { type: "image/jpeg" }), width, height };
}

async function singleFixture(): Promise<Fixture> {
  return canvasFixture("stage2-single-sample.jpg", 1200, 820, (ctx) => {
    ctx.fillStyle = "#151515";
    ctx.font = "700 60px Arial, sans-serif";
    [
      "ETHIOPIA GUJI",
      "JARC 74158",
      "WASHED PROCESS",
      "1950M",
      "JASMINE PEACH CITRUS",
      "ROAST 2026-08-28"
    ].forEach((value, index) => ctx.fillText(value, 95, 135 + index * 112));
  });
}

async function multiEntryFixture(): Promise<Fixture> {
  return canvasFixture("stage2-multi-entry-table.jpg", 1500, 650, (ctx) => {
    const columns = [45, 180, 470, 690, 900, 1140];
    const rows = [
      ["CODE", "COFFEE NAME", "PROCESS", "ORIGIN", "VARIETY", "FLAVOR"],
      ["A1", "GUJI GESHA", "WASHED", "ETHIOPIA", "74158", "JASMINE"],
      ["B2", "HUILA BOURBON", "HONEY", "COLOMBIA", "PINK BOURBON", "PEACH"]
    ];
    ctx.fillStyle = "#161616";
    rows.forEach((row, rowIndex) => {
      ctx.font = rowIndex === 0 ? "700 34px Arial, sans-serif" : "600 36px Arial, sans-serif";
      const y = [120, 300, 480][rowIndex]!;
      row.forEach((value, index) => ctx.fillText(value, columns[index]!, y));
    });
  });
}

function blockLine(block: LuckyBeanCoreBlock, index: number): OCRLineInput | undefined {
  const text = String(block.text ?? block.rawValue ?? block.value ?? "").trim();
  if (!text) return undefined;
  return {
    id: String(block.id ?? `stage2-line-${index + 1}`),
    blockId: String(block.blockId ?? `stage2-block-${index + 1}`),
    text,
    confidence: Number(block.confidence ?? block.score ?? 0.75),
    ...(Array.isArray(block.polygon) ? { polygon: block.polygon } : {}),
    ...(block.boundingBox ? { box: block.boundingBox } : {})
  };
}

function metadataFromAnalysis(analysis: LuckyBeanRecognitionAnalysis): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const field of analysis.fields ?? []) {
    const key = String(field.field ?? "").trim();
    const value = String(field.standardValue ?? field.rawValue ?? "").trim();
    if (key && value && metadata[key] === undefined) metadata[key] = value;
  }
  return metadata;
}

async function recognizeCase(fixture: Fixture): Promise<{
  result: Stage2CaseResult;
  samples: Array<{ label: string; metadata: Record<string, unknown> }>;
}> {
  const core = requireLuckyBeanRecognitionCore();
  const book = loadBundledLuckyBeanRecognitionBook();
  const diagnostics: DiagnosticEvent[] = [];
  window.__LUCKYBEAN_RECOGNITION_DIAGNOSTICS__ = {
    record(event) {
      diagnostics.push({ ...event, durationMs: round(Number(event.durationMs || 0)) });
    }
  };

  const totalStarted = performance.now();
  let started = performance.now();
  const prepared = await core.preparePackageImage(fixture.file);
  const imagePreparationMs = performance.now() - started;

  started = performance.now();
  const ocr = await core.recognizeCoffeeBag([{
    id: `stage2-${fixture.file.name}`,
    role: "front",
    roleLabel: "Stage 2 fixture",
    blob: prepared.blob,
    nativeSource: Boolean(prepared.nativeSource),
    fileName: fixture.file.name
  }], { locale: "zh-CN" });
  const ocrMs = performance.now() - started;
  const engine = String(ocr.engine ?? "unknown");

  const lines = (ocr.blocks ?? []).map(blockLine).filter((value): value is OCRLineInput => Boolean(value));
  started = performance.now();
  const layoutDocument = buildOCRLayoutDocument({
    imageId: `stage2-${fixture.file.name}`,
    lines,
    sourceWidth: fixture.width,
    sourceHeight: fixture.height,
    fallbackText: String(ocr.fullText ?? "")
  });
  const layoutDocumentMs = performance.now() - started;

  started = performance.now();
  const primary = segmentSamples(layoutDocument);
  const primarySegmentationMs = performance.now() - started;

  started = performance.now();
  const layout = refineAmbiguousSingleSampleLayout(layoutDocument, primary);
  const recordGroupingRefinementMs = performance.now() - started;

  let recognitionDocumentMs = 0;
  let analysisEnvelopeMs = 0;
  const samples: Array<{ label: string; metadata: Record<string, unknown> }> = [];
  for (let index = 0; index < layout.segments.length; index += 1) {
    const segment = layout.segments[index]!;
    started = performance.now();
    const recognitionDocument = core.createRecognitionDocument({
      images: [{ id: layoutDocument.imageId, role: "front", roleLabel: "Stage 2 fixture" }],
      blocks: segment.lines.map((line, lineIndex) => ({
        id: line.id,
        imageId: layoutDocument.imageId,
        imageRole: "front",
        order: lineIndex,
        text: line.text,
        confidence: line.confidence,
        polygon: line.polygon
      })),
      engine,
      fullText: segment.text
    });
    recognitionDocumentMs += performance.now() - started;

    started = performance.now();
    const analysis = core.analyzeRecognitionDocument(recognitionDocument, book);
    analysisEnvelopeMs += performance.now() - started;
    samples.push({
      label: String(segment.hints?.sourceTitle ?? `Stage 2 sample ${index + 1}`),
      metadata: metadataFromAnalysis(analysis)
    });
  }

  const semanticMs = sum(diagnostics, "semantic", [
    "semantic-normalization", "semantic-repair", "semantic-parse", "semantic-finalization"
  ]);
  const canonicalMs = sum(diagnostics, "semantic", [
    "canonical-variety-safety", "canonical-entity-safety", "canonical-field-arbitration"
  ]);
  const aiMs = sum(diagnostics, "semantic", ["ai-advisory"]);
  const aiEngaged = diagnostics.some((event) => event.scope === "semantic" && event.phase === "ai-advisory" && event.engaged === true);

  const result: Stage2CaseResult = {
    imagePreparationMs: round(imagePreparationMs),
    ocrMs: round(ocrMs),
    ocrRuntimeInitMs: sum(diagnostics, "ocr", ["runtime-init"]),
    ocrPredictMs: sum(diagnostics, "ocr", ["ocr-predict"]),
    layoutDocumentMs: round(layoutDocumentMs),
    primarySegmentationMs: round(primarySegmentationMs),
    recordGroupingRefinementMs: round(recordGroupingRefinementMs),
    recognitionDocumentMs: round(recognitionDocumentMs),
    semanticMs,
    canonicalMs,
    aiMs,
    aiEngaged,
    analysisEnvelopeMs: round(analysisEnvelopeMs),
    totalRecognitionMs: round(performance.now() - totalStarted),
    samples: layout.segments.length,
    layoutType: layout.layoutType,
    requiresSegmentationReview: layout.requiresReview,
    engine,
    segmentProfiles: layout.segments.map((segment) => String(segment.hints?.profile ?? "")),
    diagnostics: [...diagnostics]
  };
  delete window.__LUCKYBEAN_RECOGNITION_DIAGNOSTICS__;
  return { result, samples };
}

async function measurePersistence(samples: readonly { label: string; metadata: Record<string, unknown> }[]): Promise<number> {
  const databaseName = `aromasense-stage2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const driver = await BrowserSQLiteDriver.open({ databaseName, wasmUrl: "./sql-wasm.wasm" });
  try {
    await new LocalMigrationRunner(driver).apply([
      { id: 1, name: "local_schema_v1", sql: localSchema },
      { id: 2, name: "session_metadata_0_1c", sql: sessionMetadataMigration },
      { id: 3, name: "workflow_event_comparison_0_2", sql: workflowMigration },
      { id: 4, name: "submission_revisions_0_2", sql: submissionMigration },
      { id: 5, name: "session_timing_0_2", sql: sessionTimingMigration },
      { id: 6, name: "yingxiang_event_context_0_1", sql: yingxiangEventMigration },
      { id: 7, name: "yingxiang_collection_0_1", sql: yingxiangCollectionMigration }
    ], new Date().toISOString());
    const now = new Date().toISOString();
    const started = performance.now();
    await new CuppingSetupService(new LocalCuppingRepository(driver)).create({
      sessionId: `stage2-session-${crypto.randomUUID()}`,
      title: "Stage 2 Recognition Diagnostics",
      metadata: { date: now.slice(0, 10), time: now.slice(11, 16), organizer: "Stage 2", cuppingMode: "open" },
      samples,
      now,
      sampleIdFactory: (index) => `stage2-sample-${index + 1}-${crypto.randomUUID()}`
    });
    await driver.flush();
    return round(performance.now() - started);
  } finally {
    driver.close();
    indexedDB.deleteDatabase(databaseName);
  }
}

async function measureUi(sample: { label: string; metadata: Record<string, unknown> }): Promise<{ ms: number; fields: number }> {
  const root = document.createElement("div");
  document.body.append(root);
  const entries = Object.entries(sample.metadata)
    .filter(([, value]) => typeof value === "string" && String(value).trim())
    .slice(0, 10);
  if (!entries.length) entries.push(["diagnostic", "Stage 2"]);
  const fields: BatchReviewField[] = entries.map(([key, value]) => ({
    key, label: key, group: "Stage 2", value: String(value), tier: "core"
  }));
  const started = performance.now();
  const handle = openBatchReviewDialog({
    root,
    rowId: "stage2-benchmark",
    index: 0,
    total: 1,
    confirmed: 0,
    label: sample.label,
    fields,
    onExit: () => {},
    onConfirm: () => true
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const ms = round(performance.now() - started);
  handle.close();
  root.remove();
  return { ms, fields: fields.length };
}

function runtimeSummary(): Stage2BenchmarkResult["runtime"] {
  const provider = window.LuckyBeanPaddleOCR ?? {};
  return {
    providerVersion: String(provider.version ?? "unknown"),
    workerOnly: typeof provider.workerOnly === "boolean" ? provider.workerOnly : null,
    browserSafe: typeof provider.browserSafe === "boolean" ? provider.browserSafe : null,
    primaryIsolation: String(provider.primaryIsolation ?? ""),
    autoPreload: typeof provider.autoPreload === "boolean" ? provider.autoPreload : null
  };
}

window.Stage2AromaSenseBenchmark = {
  async run(): Promise<Stage2BenchmarkResult> {
    const singleCold = await recognizeCase(await singleFixture());
    const multiEntryWarm = await recognizeCase(await multiEntryFixture());
    const persistenceMs = await measurePersistence(multiEntryWarm.samples);
    const ui = await measureUi(singleCold.samples[0] ?? { label: "Stage 2", metadata: {} });
    return {
      fixtureKind: "deterministic-camera-like-jpeg",
      runtime: runtimeSummary(),
      singleCold: singleCold.result,
      multiEntryWarm: multiEntryWarm.result,
      persistenceMs,
      persistedSamples: multiEntryWarm.samples.length,
      uiRenderMs: ui.ms,
      uiFieldCount: ui.fields,
      semanticCanonicalSplitAvailable: true,
      note: "LuckyBean Stage 2 optional diagnostic sink separates runtime init/predict, semantic parse/repair, canonical safety/arbitration and AI advisory without changing recognition output."
    };
  }
};
