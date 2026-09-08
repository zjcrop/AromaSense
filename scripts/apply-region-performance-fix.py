from pathlib import Path


def patch(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, got {count}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# Reuse one prepared source image for the entire region batch and bound each ROI.
patch(
    'app/core/sample-roi-refinement.ts',
    '  type LuckyBeanCoreBlock,\n  type LuckyBeanRecognitionRegion,',
    '  type LuckyBeanCoreBlock,\n  type LuckyBeanPreparedImage,\n  type LuckyBeanRecognitionRegion,'
)
patch(
    'app/core/sample-roi-refinement.ts',
    '  file: File;\n  model: SegmentationReviewModel;\n  regionIndex: number;\n}',
    '  file: File;\n  preparedImage?: LuckyBeanPreparedImage;\n  model: SegmentationReviewModel;\n  regionIndex: number;\n}'
)
patch(
    'app/core/sample-roi-refinement.ts',
    '  const prepared = await core.preparePackageImage(input.file);',
    '  const prepared = input.preparedImage ?? await core.preparePackageImage(input.file);'
)
patch(
    'app/core/sample-roi-refinement.ts',
    '  }, normalizedRegion, { locale: "zh-CN", maxEdge: 2200 });',
    '  }, normalizedRegion, { locale: "zh-CN", maxEdge: 1280 });'
)

# Region batch: prepare once; treat first region as cold-start and never multiply it across all remaining regions.
p = Path('app/core/sample-region-batch-recognition.ts')
s = p.read_text(encoding='utf-8')
s = s.replace(
    'import type { RecognizedPage } from "./sample-recognition-service";\n',
    'import type { RecognizedPage } from "./sample-recognition-service";\nimport { requireLuckyBeanRecognitionCore } from "./luckybean-upstream-adapter";\n',
    1
)
anchor = '''function now(): number {\n  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();\n}\n'''
if s.count(anchor) != 1:
    raise SystemExit('sample-region-batch-recognition.ts: now anchor mismatch')
helpers = anchor + '''\nconst STEADY_REGION_DEFAULT_MS = 4_200;\nconst STEADY_REGION_MIN_MS = 1_500;\nconst STEADY_REGION_MAX_MS = 9_000;\n\nfunction median(values: readonly number[]): number | undefined {\n  const sorted = values.filter(Number.isFinite).filter((value) => value > 0).sort((a, b) => a - b);\n  if (!sorted.length) return undefined;\n  const middle = Math.floor(sorted.length / 2);\n  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;\n}\n\nexport function estimateRegionBatchRemainingMs(\n  durations: readonly number[],\n  remainingRegions: number\n): number | undefined {\n  if (remainingRegions <= 0) return 0;\n  if (!durations.length) return undefined;\n  // Region 1 includes OCR model/session cold-start on many browsers. Never multiply\n  // that one-time cost by every remaining crop. Once region 2+ exists, use their\n  // median as the steady-state per-region cost.\n  const steadySamples = durations.slice(1);\n  const observed = median(steadySamples);\n  const firstRegionDerived = Math.max(STEADY_REGION_MIN_MS, Math.min(STEADY_REGION_MAX_MS, durations[0] * 0.18));\n  const perRegion = observed === undefined\n    ? Math.min(STEADY_REGION_DEFAULT_MS * 1.35, firstRegionDerived)\n    : Math.max(STEADY_REGION_MIN_MS, Math.min(STEADY_REGION_MAX_MS, observed));\n  return Math.round(perRegion * remainingRegions);\n}\n'''
s = s.replace(anchor, helpers, 1)
s = s.replace(
    '  let working = input.model;\n  const refinements = new Map<string, ROIRefinementProvenance>();\n  const durations: number[] = [];\n\n  emit(input.onProgress, startedAt, "preparing", 0, total, 0.02, `准备从原图重新识别 ${total} 个分区`);\n',
    '  let working = input.model;\n  const refinements = new Map<string, ROIRefinementProvenance>();\n  const durations: number[] = [];\n\n  emit(input.onProgress, startedAt, "preparing", 0, total, 0.02, `准备一次原图并识别 ${total} 个分区`);\n  const preparedImage = await requireLuckyBeanRecognitionCore().preparePackageImage(input.file);\n',
    1
)
s = s.replace(
    '''    const estimatedPerRegion = durations.length\n      ? durations.reduce((sum, value) => sum + value, 0) / durations.length\n      : undefined;\n    const estimatedRemaining = estimatedPerRegion === undefined ? undefined : estimatedPerRegion * (total - index);\n''',
    '''    const estimatedRemaining = estimateRegionBatchRemainingMs(durations, total - index);\n''',
    1
)
s = s.replace(
    '      file: input.file,\n      model: working,',
    '      file: input.file,\n      preparedImage,\n      model: working,',
    1
)
s = s.replace(
    '''    const averageDuration = durations.reduce((sum, value) => sum + value, 0) / durations.length;\n    emit(\n''',
    '''    emit(\n''',
    1
)
s = s.replace(
    '      averageDuration * (total - index - 1)\n',
    '      estimateRegionBatchRemainingMs(durations, total - index - 1)\n',
    1
)
p.write_text(s, encoding='utf-8')

# Ambiguous multi-entry pages go to manual source-image segmentation before optional AI Path C.
patch(
    'app/core/sample-recognition-service.ts',
    '    if (harvest.shouldUseStructureAi && this.foundation?.structurePage) {',
    '    if (!layout.requiresReview && harvest.shouldUseStructureAi && this.foundation?.structurePage) {'
)
patch(
    'app/core/sample-recognition-service.ts',
    '''    } else if (harvest.shouldUseStructureAi) {\n      structureFallbackReason = "structure-ai-gateway-unavailable";\n    }\n''',
    '''    } else if (harvest.shouldUseStructureAi) {\n      structureFallbackReason = layout.requiresReview\n        ? "segmentation-review-before-ai"\n        : "structure-ai-gateway-unavailable";\n    }\n'''
)

# Review preview is visual-only: 960 px and medium resize is enough and materially faster on phones.
patch('app/ui/dom/image-review-preview.ts', 'const PREVIEW_MAX_EDGE = 1280;', 'const PREVIEW_MAX_EDGE = 960;')
patch("app/ui/dom/image-review-preview.ts", "resizeQuality: 'high'", "resizeQuality: 'medium'")
patch("app/ui/dom/image-review-preview.ts", "quality:0.82", "quality:0.76")

# Generic long-operation ETA must not infer wall-clock time from semantic milestone percentage.
p = Path('app/ui/dom/long-operation-progress.ts')
s = p.read_text(encoding='utf-8')
s = s.replace('const INITIAL_ESTIMATED_TOTAL_MS = 10_000;', 'const INITIAL_ESTIMATED_TOTAL_MS = 30_000;\nconst MAX_ESTIMATED_TOTAL_MS = 60_000;', 1)
old = '''  private calibrateEstimate(elapsedMs: number, confirmed: number): void {\n    if (confirmed < 3 || confirmed >= 99 || elapsedMs < 250) return;\n    const impliedTotal = elapsedMs / Math.max(0.03, confirmed / 100);\n    const bounded = Math.max(elapsedMs + 1000, Math.min(120_000, impliedTotal));\n    this.estimatedTotalMs = this.estimatedTotalMs * 0.76 + bounded * 0.24;\n  }\n'''
new = '''  private calibrateEstimate(elapsedMs: number, confirmed: number): void {\n    if (elapsedMs < 500) return;\n    // Foundation percentages are stage milestones, not a linear time axis. Using\n    // elapsed / percent produced 90s+ estimates from a single cold-start stage.\n    // Keep a conservative 30s prior and only extend it when real elapsed time is\n    // actually approaching the current estimate; late confirmed progress may\n    // shorten it gradually, but it never explodes from a milestone jump.\n    if (elapsedMs > this.estimatedTotalMs * 0.86) {\n      this.estimatedTotalMs = Math.min(MAX_ESTIMATED_TOTAL_MS, Math.max(this.estimatedTotalMs, elapsedMs + 7_000));\n    } else if (confirmed >= 72 && elapsedMs < this.estimatedTotalMs * 0.72) {\n      this.estimatedTotalMs = Math.max(elapsedMs + 2_500, this.estimatedTotalMs * 0.94);\n    }\n  }\n'''
if s.count(old) != 1:
    raise SystemExit('long-operation-progress.ts: calibrate anchor mismatch')
s = s.replace(old, new, 1)
s = s.replace(
    '''    this.elapsedNode.textContent = remainingMs < 800 ? "即将完成" : `预计剩余 ${Math.max(1, Math.round(remainingMs / 1000))} 秒`;\n''',
    '''    const etaReady = elapsedMs >= 3_000;\n    this.elapsedNode.textContent = !etaReady ? "正在估算" : remainingMs < 800 ? "即将完成" : `预计剩余 ${Math.max(1, Math.round(remainingMs / 1000))} 秒`;\n''',
    1
)
s = s.replace(
    '''    this.progressNode.setAttribute("aria-valuetext", `${detailLabel}；${Math.round(this.latestPercent)}%；预计剩余 ${Math.max(0, Math.round(remainingMs / 1000))} 秒`);\n''',
    '''    this.progressNode.setAttribute("aria-valuetext", etaReady\n      ? `${detailLabel}；${Math.round(this.latestPercent)}%；预计剩余 ${Math.max(0, Math.round(remainingMs / 1000))} 秒`\n      : `${detailLabel}；${Math.round(this.latestPercent)}%；正在估算剩余时间`);\n''',
    1
)
p.write_text(s, encoding='utf-8')

Path('tests/region-runtime-performance.test.ts').write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { estimateRegionBatchRemainingMs } from "../app/core/sample-region-batch-recognition";

test("region ETA never multiplies one-time cold start across remaining crops", () => {
  assert.equal(estimateRegionBatchRemainingMs([], 3), undefined);
  const afterColdStart = estimateRegionBatchRemainingMs([30_000], 3);
  assert.ok(afterColdStart !== undefined && afterColdStart <= 18_000, `cold-start ETA exploded: ${afterColdStart}`);
  const steady = estimateRegionBatchRemainingMs([30_000, 3_800, 4_200], 3);
  assert.ok(steady !== undefined && steady >= 9_000 && steady <= 15_000, `steady ETA invalid: ${steady}`);
});

test("region OCR prepares original once and bounds each web ROI", () => {
  const roi = readFileSync("app/core/sample-roi-refinement.ts", "utf8");
  const batch = readFileSync("app/core/sample-region-batch-recognition.ts", "utf8");
  assert.match(roi, /preparedImage\?: LuckyBeanPreparedImage/u);
  assert.match(roi, /input\.preparedImage \?\? await core\.preparePackageImage/u);
  assert.match(roi, /maxEdge: 1280/u);
  assert.doesNotMatch(roi, /maxEdge: 2200/u);
  assert.match(batch, /const preparedImage = await requireLuckyBeanRecognitionCore\(\)\.preparePackageImage\(input\.file\)/u);
  assert.match(batch, /preparedImage,/u);
});

test("ambiguous pages segment before optional AI and generic ETA is not percent-derived", () => {
  const service = readFileSync("app/core/sample-recognition-service.ts", "utf8");
  const progress = readFileSync("app/ui/dom/long-operation-progress.ts", "utf8");
  assert.match(service, /!layout\.requiresReview && harvest\.shouldUseStructureAi/u);
  assert.match(service, /segmentation-review-before-ai/u);
  assert.doesNotMatch(progress, /elapsedMs \/ Math\.max\(0\.03, confirmed \/ 100\)/u);
  assert.match(progress, /INITIAL_ESTIMATED_TOTAL_MS = 30_000/u);
  assert.match(progress, /MAX_ESTIMATED_TOTAL_MS = 60_000/u);
});
''', encoding='utf-8')
