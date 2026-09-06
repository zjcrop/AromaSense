import localSchema from "../app/storage/0001_local_schema.sql";
import sessionMetadataMigration from "../app/storage/0002_session_metadata.sql";
import workflowMigration from "../app/storage/0003_workflow_event_comparison.sql";
import submissionMigration from "../app/storage/0004_submission_revisions.sql";
import sessionTimingMigration from "../app/storage/0005_session_timing.sql";
import yingxiangEventMigration from "../app/storage/0006_yingxiang_event_context.sql";
import yingxiangCollectionMigration from "../app/storage/0007_yingxiang_collection.sql";
import { SampleRecognitionService } from "../app/core/sample-recognition-service";
import type { LuckyBeanRecognitionCore } from "../app/core/luckybean-upstream-adapter";
import { BrowserSQLiteDriver } from "../app/storage/browser-sqlite-driver";
import { LocalMigrationRunner } from "../app/storage/local-migration-runner";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { CuppingSetupService } from "../app/core/cupping-setup-service";
import { openBatchReviewDialog, type BatchReviewField } from "../app/ui/dom/batch-review-dialog";

interface PhaseTimes {
  imagePreparationMs: number;
  ocrMs: number;
  canonicalMs: number;
}

interface CaseResult extends PhaseTimes {
  totalRecognitionMs: number;
  layoutGroupMs: number;
  samples: number;
  layoutType: string;
  requiresSegmentationReview: boolean;
  engine: string;
}

interface Stage0BenchmarkResult {
  fixtureKind: "deterministic-camera-like-jpeg";
  single: CaseResult;
  multiEntry: CaseResult;
  persistenceMs: number;
  persistedSamples: number;
  uiRenderMs: number;
  uiFieldCount: number;
}

declare global {
  interface Window {
    LuckyBeanRecognitionCore?: LuckyBeanRecognitionCore;
    Stage0AromaSenseBenchmark?: { run(): Promise<Stage0BenchmarkResult> };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRuntime(): Promise<LuckyBeanRecognitionCore> {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const core = window.LuckyBeanRecognitionCore;
    if (
      core
      && typeof core.preparePackageImage === "function"
      && typeof core.recognizeCoffeeBag === "function"
      && typeof core.createRecognitionDocument === "function"
      && typeof core.analyzeRecognitionDocument === "function"
    ) return core;
    await sleep(80);
  }
  throw new Error("LuckyBean Recognition core did not become ready for Stage 0 benchmark");
}

async function canvasFile(
  name: string,
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.fillStyle = "#f1ebe0";
  context.fillRect(0, 0, width, height);
  draw(context);
  context.globalAlpha = 0.07;
  context.fillStyle = "#493f36";
  for (let y = 13; y < height; y += 41) {
    for (let x = 17 + (y % 7); x < width; x += 59) context.fillRect(x, y, 1, 1);
  }
  context.globalAlpha = 1;
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("JPEG benchmark fixture creation failed")),
    "image/jpeg",
    0.9
  ));
  return new File([blob], name, { type: "image/jpeg" });
}

async function singleFixture(): Promise<File> {
  return canvasFile("stage0-single-sample.jpg", 1200, 820, (ctx) => {
    ctx.fillStyle = "#151515";
    ctx.font = "700 60px Arial, sans-serif";
    [
      "ETHIOPIA GUJI",
      "JARC 74158",
      "WASHED PROCESS",
      "1950M",
      "JASMINE PEACH CITRUS",
      "ROAST 2026-08-28"
    ].forEach((line, index) => ctx.fillText(line, 95, 135 + index * 112));
  });
}

async function multiEntryFixture(): Promise<File> {
  return canvasFile("stage0-multi-entry-table.jpg", 1500, 650, (ctx) => {
    const columns = [45, 180, 470, 690, 900, 1140];
    const header = ["CODE", "COFFEE NAME", "PROCESS", "ORIGIN", "VARIETY", "FLAVOR"];
    const row1 = ["A1", "GUJI GESHA", "WASHED", "ETHIOPIA", "74158", "JASMINE"];
    const row2 = ["B2", "HUILA BOURBON", "HONEY", "COLOMBIA", "PINK BOURBON", "PEACH"];
    ctx.fillStyle = "#161616";
    ctx.font = "700 34px Arial, sans-serif";
    header.forEach((value, index) => ctx.fillText(value, columns[index], 120));
    ctx.font = "600 36px Arial, sans-serif";
    row1.forEach((value, index) => ctx.fillText(value, columns[index], 300));
    row2.forEach((value, index) => ctx.fillText(value, columns[index], 480));
    ctx.strokeStyle = "rgba(30,30,30,.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(35, 160); ctx.lineTo(1460, 160);
    ctx.moveTo(35, 345); ctx.lineTo(1460, 345);
    ctx.stroke();
  });
}

async function recognizeCase(file: File): Promise<{ result: Awaited<ReturnType<SampleRecognitionService["recognizePage"]>>; times: CaseResult }> {
  const original = await waitForRuntime();
  const phases: PhaseTimes = { imagePreparationMs: 0, ocrMs: 0, canonicalMs: 0 };
  const proxy = new Proxy(original, {
    get(target, property, receiver) {
      if (property === "preparePackageImage") {
        return async (...args: Parameters<LuckyBeanRecognitionCore["preparePackageImage"]>) => {
          const started = performance.now();
          try { return await target.preparePackageImage(...args); }
          finally { phases.imagePreparationMs += performance.now() - started; }
        };
      }
      if (property === "recognizeCoffeeBag") {
        return async (...args: Parameters<LuckyBeanRecognitionCore["recognizeCoffeeBag"]>) => {
          const started = performance.now();
          try { return await target.recognizeCoffeeBag(...args); }
          finally { phases.ocrMs += performance.now() - started; }
        };
      }
      if (property === "createRecognitionDocument") {
        return (...args: Parameters<LuckyBeanRecognitionCore["createRecognitionDocument"]>) => {
          const started = performance.now();
          try { return target.createRecognitionDocument(...args); }
          finally { phases.canonicalMs += performance.now() - started; }
        };
      }
      if (property === "analyzeRecognitionDocument") {
        return (...args: Parameters<LuckyBeanRecognitionCore["analyzeRecognitionDocument"]>) => {
          const started = performance.now();
          try { return target.analyzeRecognitionDocument(...args); }
          finally { phases.canonicalMs += performance.now() - started; }
        };
      }
      return Reflect.get(target as object, property, receiver);
    }
  }) as LuckyBeanRecognitionCore;

  window.LuckyBeanRecognitionCore = proxy;
  const started = performance.now();
  try {
    const result = await new SampleRecognitionService().recognizePage(file, 0);
    const totalRecognitionMs = performance.now() - started;
    const layoutGroupMs = Math.max(0, totalRecognitionMs - phases.imagePreparationMs - phases.ocrMs - phases.canonicalMs);
    return {
      result,
      times: {
        imagePreparationMs: round(phases.imagePreparationMs),
        ocrMs: round(phases.ocrMs),
        canonicalMs: round(phases.canonicalMs),
        totalRecognitionMs: round(totalRecognitionMs),
        layoutGroupMs: round(layoutGroupMs),
        samples: result.samples.length,
        layoutType: result.layoutType,
        requiresSegmentationReview: result.requiresSegmentationReview,
        engine: result.engine
      }
    };
  } finally {
    window.LuckyBeanRecognitionCore = original;
  }
}

async function measurePersistence(samples: readonly { label: string; metadata: Record<string, unknown> }[]): Promise<number> {
  const databaseName = `aromasense-stage0-benchmark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    const service = new CuppingSetupService(new LocalCuppingRepository(driver));
    const now = new Date().toISOString();
    const started = performance.now();
    await service.create({
      sessionId: `stage0-session-${crypto.randomUUID()}`,
      title: "Stage 0 Recognition Benchmark",
      metadata: { date: now.slice(0, 10), time: now.slice(11, 16), organizer: "Stage 0", cuppingMode: "open" },
      samples: samples.map((sample) => ({ label: sample.label, metadata: sample.metadata })),
      now,
      sampleIdFactory: (index) => `stage0-sample-${index + 1}-${crypto.randomUUID()}`
    });
    await driver.flush();
    return round(performance.now() - started);
  } finally {
    driver.close();
    indexedDB.deleteDatabase(databaseName);
  }
}

async function measureUiRender(sample: { label: string; metadata: Record<string, unknown> }): Promise<{ ms: number; fields: number }> {
  const root = document.createElement("div");
  document.body.append(root);
  const fields: BatchReviewField[] = Object.entries(sample.metadata)
    .filter(([, value]) => typeof value === "string" && String(value).trim())
    .slice(0, 10)
    .map(([key, value]) => ({ key, label: key, group: "Stage 0", value: String(value), tier: "core" }));
  const started = performance.now();
  const handle = openBatchReviewDialog({
    root,
    rowId: "stage0-benchmark",
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

window.Stage0AromaSenseBenchmark = {
  async run(): Promise<Stage0BenchmarkResult> {
    const single = await recognizeCase(await singleFixture());
    const multiEntry = await recognizeCase(await multiEntryFixture());
    const persistedSamples = multiEntry.result.samples.length;
    const persistenceMs = await measurePersistence(multiEntry.result.samples);
    const ui = await measureUiRender(single.result.samples[0]);
    return {
      fixtureKind: "deterministic-camera-like-jpeg",
      single: single.times,
      multiEntry: multiEntry.times,
      persistenceMs,
      persistedSamples,
      uiRenderMs: ui.ms,
      uiFieldCount: ui.fields
    };
  }
};
