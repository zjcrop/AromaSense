from pathlib import Path

ROOT = Path('.')

def replace_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))

# 1) Default recognition is whole-image. Automatic segmentation remains explicit/optional.
replace_once(
    'app/ui/dom/segmentation-review-recognizer.ts',
    '''  override async recognizePage(file: File, index = 0): Promise<RecognizedPage> {\n    const page = await this.delegate.recognizePage(file, index);\n    if (!page.requiresSegmentationReview) return page;\n    if (!buildSegmentationReviewModel(page)) return page;\n    return openSegmentationReviewDialogV2({\n      root: this.root,\n      page,\n      file,\n      recognizeWholePage: () => this.delegate.recognizePage(file, index)\n    });\n  }\n''',
    '''  override async recognizePage(file: File, index = 0): Promise<RecognizedPage> {\n    // Whole-image recognition is the production default. A segmentation-review flag\n    // is evidence for confirmation, not permission to interrupt the fast path.\n    return this.delegate.recognizePage(file, index);\n  }\n\n  /** Explicit fallback for genuinely complex multi-record images. */\n  async recognizeWithAutomaticSegmentation(file: File, index = 0): Promise<RecognizedPage> {\n    const page = await this.delegate.recognizePage(file, index);\n    if (!page.requiresSegmentationReview) return page;\n    if (!buildSegmentationReviewModel(page)) return page;\n    return openSegmentationReviewDialogV2({\n      root: this.root,\n      page,\n      file,\n      recognizeWholePage: () => this.delegate.recognizePage(file, index)\n    });\n  }\n'''
)

# 2) Shared manual ROI recognition and conservative evidence merge.
(ROOT / 'app/core/sample-manual-roi-recognition.ts').write_text(r'''import type { OCRBox } from "./ocr-layout-model";
import {
  attachROIRefinementProvenance,
  refineSegmentationRegionEvidence
} from "./sample-roi-refinement";
import {
  normalizeRegionBox,
  resegmentRecognizedPage,
  type SegmentationReviewModel
} from "./sample-segmentation-review";
import type { RecognizedPage, RecognizedSample } from "./sample-recognition-service";

export interface ManualROIBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ManualROIRecognitionResult {
  page: RecognizedPage;
  sample: RecognizedSample;
  box: OCRBox;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function placeholderLabel(value: string): boolean {
  return !value.trim() || /^待确认样品\s+\d+$/u.test(value.trim());
}

/**
 * Runs one user-selected rectangle through the existing Foundation ROI protocol.
 * The preview is never an OCR source: normalized coordinates are applied to the
 * untouched original File by recognizeImageRegion.
 */
export async function recognizeManualROIFromOriginal(input: {
  file: File;
  page: RecognizedPage;
  box: ManualROIBox;
  label?: string;
}): Promise<ManualROIRecognitionResult> {
  const box = normalizeRegionBox(input.box);
  const id = `manual-roi-${Date.now().toString(36)}`;
  const model: SegmentationReviewModel = {
    fileName: input.page.fileName,
    engine: input.page.engine,
    lines: [],
    regions: [{ id, label: input.label?.trim() ?? "", box, lineIds: [] }]
  };
  const refined = await refineSegmentationRegionEvidence({
    file: input.file,
    model,
    regionIndex: 0
  });
  const parsed = resegmentRecognizedPage(input.page, refined.model);
  const page = attachROIRefinementProvenance(
    parsed,
    refined.model,
    new Map([[id, refined.provenance]])
  );
  const sample = page.samples[0];
  if (!sample) throw new Error("局部识别没有形成可用样品信息");
  return { page, sample, box };
}

/**
 * Supplemental ROI evidence never silently overwrites a conflicting full-image
 * field. Empty fields are filled, matching fields are accepted, and conflicts are
 * surfaced as review candidates while both evidence sources remain auditable.
 */
export function mergeSupplementalRecognizedSample(
  base: RecognizedSample,
  supplemental: RecognizedSample,
  box: Pick<OCRBox, "left" | "top" | "right" | "bottom">
): RecognizedSample {
  const metadata: Record<string, unknown> = { ...base.metadata };
  const supplementalFields: Record<string, string> = {};
  const appliedFields: string[] = [];
  const conflicts: Array<{ field: string; current: string; supplemental: string }> = [];

  for (const [key, raw] of Object.entries(supplemental.metadata)) {
    if (key === "recognition") continue;
    const incoming = text(raw);
    if (!incoming) continue;
    supplementalFields[key] = incoming;
    const current = text(metadata[key]);
    if (!current) {
      metadata[key] = incoming;
      appliedFields.push(key);
    } else if (current !== incoming) {
      conflicts.push({ field: key, current, supplemental: incoming });
    }
  }

  const baseRecognition = record(metadata.recognition) ?? {};
  const previousReview = Array.isArray(baseRecognition.review) ? [...baseRecognition.review] : [];
  const conflictReview = conflicts.map((item) => ({
    field: item.field,
    value: item.current,
    confidence: 0.5,
    candidates: [
      { value: item.current, normalizedValue: item.current, score: 0.51 },
      { value: item.supplemental, normalizedValue: item.supplemental, score: 0.5 }
    ],
    source: "manual_roi_conflict"
  }));
  const existingROI = Array.isArray(baseRecognition.supplementalROI)
    ? [...baseRecognition.supplementalROI]
    : [];
  metadata.recognition = {
    ...baseRecognition,
    review: [...previousReview, ...conflictReview],
    supplementalROI: [...existingROI, {
      source: "manual_roi",
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      engine: supplemental.engine,
      rawText: supplemental.rawText,
      fields: supplementalFields,
      appliedFields,
      conflicts,
      capturedAt: new Date().toISOString()
    }]
  };

  const baseLabel = base.label.trim();
  const supplementalLabel = supplemental.label.trim();
  return {
    ...base,
    label: placeholderLabel(baseLabel) && !placeholderLabel(supplementalLabel) ? supplementalLabel : base.label,
    rawText: base.rawText,
    confidence: Math.max(Number(base.confidence ?? 0), Number(supplemental.confidence ?? 0)) || undefined,
    requiresReview: base.requiresReview || supplemental.requiresReview || conflicts.length > 0,
    metadata
  };
}
''')

# 3) Lightweight original-image rectangle picker.
(ROOT / 'app/ui/dom/manual-roi-recognition-dialog.ts').write_text(r'''import { createSegmentationImagePreview } from "./image-review-preview";
import type { ManualROIBox } from "../../core/sample-manual-roi-recognition";
import { button, element } from "./dom-helpers";

export interface ManualROIRecognitionDialogOptions {
  root: HTMLElement;
  file: File;
  onRecognize(box: ManualROIBox): void | Promise<void>;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-manual-roi]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseManualRoi = "true";
  style.textContent = `
    .manual-roi{position:fixed;inset:0;z-index:14050;display:grid;place-items:center;padding:14px;background:rgba(0,0,0,.78);backdrop-filter:blur(5px)}
    .manual-roi__panel{width:min(880px,100%);max-height:94dvh;overflow:auto;box-sizing:border-box;padding:16px;border:1px solid rgba(214,173,99,.34);border-radius:14px;background:#151515;color:#f4efe4;box-shadow:0 22px 60px rgba(0,0,0,.55);scrollbar-width:none}
    .manual-roi__panel::-webkit-scrollbar{display:none;width:0;height:0}
    .manual-roi__title{margin:0 0 5px;font-size:18px}.manual-roi__note{margin:0 0 12px;color:#aaa39a;font-size:11px;line-height:1.55}
    .manual-roi__stage{position:relative;width:max-content;max-width:100%;margin:0 auto;touch-action:none;user-select:none;cursor:crosshair}
    .manual-roi__image{display:block;max-width:100%;max-height:68dvh;width:auto;height:auto;border-radius:9px;pointer-events:none}
    .manual-roi__selection{position:absolute;display:none;box-sizing:border-box;border:2px solid #d6ad63;border-radius:5px;background:rgba(214,173,99,.10);box-shadow:0 0 0 9999px rgba(0,0,0,.22);pointer-events:none}
    .manual-roi__status{min-height:18px;margin:9px 0 0;color:#aaa39a;font-size:10px}.manual-roi__status.is-error{color:#df8d85}
    .manual-roi__actions{display:grid;grid-template-columns:.7fr 1.2fr;gap:8px;margin-top:10px}.manual-roi__cancel,.manual-roi__recognize{min-height:42px;border-radius:9px;font:inherit;font-weight:750}
    .manual-roi__cancel{border:1px solid rgba(214,173,99,.28);background:#202020;color:#aaa39a}.manual-roi__recognize{border:1px solid #b9995a;background:#b9995a;color:#111}.manual-roi__recognize:disabled{opacity:.4}
  `;
  document.head.append(style);
}

export async function openManualROIRecognitionDialog(options: ManualROIRecognitionDialogOptions): Promise<boolean> {
  installStyles();
  const preview = await createSegmentationImagePreview(options.file);
  if (!preview) throw new Error("当前环境无法生成局部识别预览");
  const previewUrl = URL.createObjectURL(preview.blob);
  return new Promise<boolean>((resolve) => {
    const overlay = element("div", "manual-roi");
    const panel = element("section", "manual-roi__panel");
    panel.append(
      element("h2", "manual-roi__title", "框选补充识别"),
      element("p", "manual-roi__note", "直接在原图预览上拖出一个矩形。确认后系统按该坐标从原始照片裁取区域并使用同一 PP-OCRv5 识别；整图结果不会被静默覆盖。")
    );
    const stage = element("div", "manual-roi__stage");
    const image = element("img", "manual-roi__image");
    image.src = previewUrl;
    image.alt = "原始照片的轻量框选预览";
    const selection = element("div", "manual-roi__selection");
    stage.append(image, selection);
    const status = element("p", "manual-roi__status", "拖动框选需要补充识别的区域");
    const actions = element("div", "manual-roi__actions");
    let box: ManualROIBox | undefined;
    let startX = 0;
    let startY = 0;
    let pointerId: number | undefined;
    let busy = false;

    const finish = (accepted: boolean): void => {
      URL.revokeObjectURL(previewUrl);
      overlay.remove();
      resolve(accepted);
    };
    const cancel = button("manual-roi__cancel", "取消", () => { if (!busy) finish(false); });
    const recognize = button("manual-roi__recognize", "识别框选区域", async () => {
      if (!box || busy) return;
      busy = true; recognize.disabled = true; cancel.disabled = true;
      status.classList.remove("is-error"); status.textContent = "正在从原始照片裁取该区域并进行 PP-OCRv5 识别…";
      try {
        await options.onRecognize(box);
        finish(true);
      } catch (error) {
        busy = false; recognize.disabled = false; cancel.disabled = false;
        status.classList.add("is-error");
        status.textContent = `局部识别失败：${error instanceof Error ? error.message : String(error)}`;
      }
    });
    recognize.disabled = true;
    actions.append(cancel, recognize);
    panel.append(stage, status, actions);
    overlay.append(panel);
    options.root.append(overlay);

    const point = (event: PointerEvent): { x: number; y: number } => {
      const rect = image.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
      };
    };
    const update = (x: number, y: number): void => {
      const rect = image.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      const left = Math.min(startX, x), top = Math.min(startY, y);
      const right = Math.max(startX, x), bottom = Math.max(startY, y);
      selection.style.display = "block";
      selection.style.left = `${left}px`; selection.style.top = `${top}px`;
      selection.style.width = `${Math.max(1, right - left)}px`; selection.style.height = `${Math.max(1, bottom - top)}px`;
      const width = right - left, height = bottom - top;
      box = width >= 18 && height >= 18 ? {
        left: left / rect.width,
        top: top / rect.height,
        right: right / rect.width,
        bottom: bottom / rect.height
      } : undefined;
      recognize.disabled = !box;
      status.textContent = box ? `已框选 ${Math.round((right-left))} × ${Math.round((bottom-top))} px 预览区域` : "框选范围过小，请重新拖动";
    };
    stage.addEventListener("pointerdown", (event) => {
      if (busy || event.button > 0) return;
      const p = point(event); startX = p.x; startY = p.y; pointerId = event.pointerId;
      stage.setPointerCapture?.(event.pointerId); update(p.x, p.y); event.preventDefault();
    });
    stage.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId || busy) return;
      const p = point(event); update(p.x, p.y); event.preventDefault();
    });
    const stop = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      const p = point(event); update(p.x, p.y); pointerId = undefined; event.preventDefault();
    };
    stage.addEventListener("pointerup", stop);
    stage.addEventListener("pointercancel", stop);
    overlay.addEventListener("click", (event) => { if (event.target === overlay && !busy) finish(false); });
  });
}
''')

# 4) Review dialog exposes a supplemental-ROI action.
replace_once(
    'app/ui/dom/batch-review-dialog.ts',
    '''  onPrevious?(value: BatchReviewValue): void | Promise<void>;\n  onConfirm(value: BatchReviewValue): boolean | void | Promise<boolean | void>;\n''',
    '''  onPrevious?(value: BatchReviewValue): void | Promise<void>;\n  onSupplementalRecognition?(): void | Promise<void>;\n  onConfirm(value: BatchReviewValue): boolean | void | Promise<boolean | void>;\n'''
)
replace_once(
    'app/ui/dom/batch-review-dialog.ts',
    '''    source.append(element("summary", "batch-review__details-title", "来源与识别证据"));\n    if (options.previewUrl) {\n''',
    '''    source.append(element("summary", "batch-review__details-title", "来源与识别证据"));\n    if (options.onSupplementalRecognition) {\n      const sourceActions = element("div", "batch-review__source-actions");\n      const sourceStatus = element("p", "batch-review__validation");\n      sourceStatus.hidden = true;\n      const roi = button("batch-review__secondary", "框选补充识别", async () => {\n        roi.disabled = true; sourceStatus.hidden = true;\n        try {\n          await options.onSupplementalRecognition?.();\n        } catch (error) {\n          sourceStatus.textContent = `局部识别失败：${errorMessage(error)}`;\n          sourceStatus.hidden = false;\n          roi.disabled = false;\n        }\n      });\n      sourceActions.append(roi);\n      source.append(sourceActions, sourceStatus);\n    }\n    if (options.previewUrl) {\n'''
)

# 5) Batch setup rows remember the original File only for the current app lifetime,
# then merge manual ROI evidence into the same confirmation row.
replace_once(
    'app/ui/dom/batch-setup-review-renderer.ts',
    '''import { openBatchReviewDialog, type BatchReviewDialogHandle, type BatchReviewField, type BatchReviewValue } from "./batch-review-dialog";\n''',
    '''import { openBatchReviewDialog, type BatchReviewDialogHandle, type BatchReviewField, type BatchReviewValue } from "./batch-review-dialog";\nimport { openManualROIRecognitionDialog } from "./manual-roi-recognition-dialog";\nimport { mergeSupplementalRecognizedSample, recognizeManualROIFromOriginal } from "../../core/sample-manual-roi-recognition";\n'''
)
replace_once(
    'app/ui/dom/batch-setup-review-renderer.ts',
    '''interface RowState { id: string; previewDataUrl?: string; status?: string; requiresReview: boolean; confirmed: boolean }\n''',
    '''interface RowState {\n  id: string;\n  previewDataUrl?: string;\n  status?: string;\n  requiresReview: boolean;\n  confirmed: boolean;\n  sourceFile?: File;\n  sourcePage?: RecognizedPage;\n  sourceSampleIndex?: number;\n}\n'''
)
replace_once(
    'app/ui/dom/batch-setup-review-renderer.ts',
    '''      onPrevious: index > 0 ? async (value) => { this.applyReviewValue(row, value, false, false); await this.saveDraft(); this.openReview(rows[index - 1]); } : undefined,\n      onConfirm: async (value) => {\n''',
    '''      onPrevious: index > 0 ? async (value) => { this.applyReviewValue(row, value, false, false); await this.saveDraft(); this.openReview(rows[index - 1]); } : undefined,\n      onSupplementalRecognition: state.sourceFile && state.sourcePage ? async () => {\n        const currentValue = this.review?.read();\n        if (currentValue) this.applyReviewValue(row, currentValue, false, false);\n        const sourceFile = state.sourceFile!;\n        const sourcePage = state.sourcePage!;\n        const currentMetadata = this.metadata.get(row) ?? {};\n        const currentRecognition = record(currentMetadata.recognition);\n        const base: RecognizedSample = {\n          label: row.querySelector<HTMLInputElement>(".batch-setup__sample-label")?.value ?? "",\n          rawText: String(currentRecognition?.rawText ?? ""),\n          engine: String(currentRecognition?.engine ?? sourcePage.engine),\n          confidence: typeof currentRecognition?.confidence === "number" ? currentRecognition.confidence : undefined,\n          requiresReview: state.requiresReview,\n          metadata: { ...currentMetadata }\n        };\n        let changed = false;\n        await openManualROIRecognitionDialog({\n          root: this.root,\n          file: sourceFile,\n          onRecognize: async (box) => {\n            const result = await recognizeManualROIFromOriginal({ file: sourceFile, page: sourcePage, box, label: base.label });\n            const merged = mergeSupplementalRecognizedSample(base, result.sample, result.box);\n            this.metadata.set(row, merged.metadata);\n            const labelInput = row.querySelector<HTMLInputElement>(".batch-setup__sample-label");\n            if (labelInput) labelInput.value = merged.label;\n            state.requiresReview = merged.requiresReview;\n            state.status = `${state.status ?? sourcePage.engine} · 手工框选补充识别`;\n            this.refreshRow(row);\n            await this.saveDraft();\n            changed = true;\n          }\n        });\n        if (changed) {\n          this.review?.close(); this.review = undefined;\n          this.openReview(row);\n        }\n      } : undefined,\n      onConfirm: async (value) => {\n'''
)
replace_once(
    'app/ui/dom/batch-setup-review-renderer.ts',
    '''  private addRecognizedPage(page: RecognizedPage, preview: string): number {\n    for (let index = 0; index < page.samples.length; index += 1) {\n      const sample: RecognizedSample = page.samples[index]; const needsReview = sample.requiresReview || page.requiresSegmentationReview;\n      this.addRow(sample.label, sample.metadata, { id: this.rowId(), previewDataUrl: preview, status: [page.engine, page.samples.length > 1 ? `同图样品 ${index + 1}/${page.samples.length}` : "单样品", `版面 ${page.layoutType}`, needsReview ? "存在待核对字段" : "自动识别完成"].join(" · "), requiresReview: needsReview, confirmed: false });\n    }\n    return page.samples.length;\n  }\n''',
    '''  private addRecognizedPage(page: RecognizedPage, preview: string, sourceFile?: File): number {\n    for (let index = 0; index < page.samples.length; index += 1) {\n      const sample: RecognizedSample = page.samples[index]; const needsReview = sample.requiresReview || page.requiresSegmentationReview;\n      this.addRow(sample.label, sample.metadata, {\n        id: this.rowId(),\n        previewDataUrl: preview,\n        status: [page.engine, page.samples.length > 1 ? `同图样品 ${index + 1}/${page.samples.length}` : "单样品", `整图识别 · 版面 ${page.layoutType}`, needsReview ? "存在待核对字段" : "自动识别完成"].join(" · "),\n        requiresReview: needsReview,\n        confirmed: false,\n        sourceFile,\n        sourcePage: page,\n        sourceSampleIndex: index\n      });\n    }\n    return page.samples.length;\n  }\n'''
)
replace_once(
    'app/ui/dom/batch-setup-review-renderer.ts',
    '''          const result = await this.recognizer.recognizePage(file, index);\n          count += this.addRecognizedPage(result, preview ?? "");\n''',
    '''          const result = await this.recognizer.recognizePage(file, index);\n          count += this.addRecognizedPage(result, preview ?? "", file);\n'''
)

# 6) Runtime add-bean flow also defaults to whole image and exposes the same ROI supplement.
replace_once(
    'app/ui/dom/stable-cupping-screen-renderer.ts',
    '''import { SegmentationReviewRecognitionService } from "./segmentation-review-recognizer";\n''',
    '''import { SegmentationReviewRecognitionService } from "./segmentation-review-recognizer";\nimport { openManualROIRecognitionDialog } from "./manual-roi-recognition-dialog";\nimport { mergeSupplementalRecognizedSample, recognizeManualROIFromOriginal } from "../../core/sample-manual-roi-recognition";\n'''
)
replace_once(
    'app/ui/dom/stable-cupping-screen-renderer.ts',
    '''      this.openRecognitionReview(page, preview, status, add, 0, []);\n''',
    '''      this.openRecognitionReview(page, preview, status, add, 0, [], file);\n'''
)
replace_once(
    'app/ui/dom/stable-cupping-screen-renderer.ts',
    '''    startIndex = 0,\n    restoredAddedIds: readonly string[] = []\n  ): void {\n    const samples = [...page.samples];\n''',
    '''    startIndex = 0,\n    restoredAddedIds: readonly string[] = [],\n    sourceFile?: File\n  ): void {\n    const samples = [...page.samples];\n    const workingPage = (): RecognizedPage => ({ ...page, samples: [...samples] });\n'''
)
replace_once(
    'app/ui/dom/stable-cupping-screen-renderer.ts',
    '''        onExit: (value) => {\n          this.saveRuntimeRecognitionDraft(page, index, addedIds, preview, value);\n''',
    '''        onExit: (value) => {\n          this.saveRuntimeRecognitionDraft(workingPage(), index, addedIds, preview, value);\n'''
)
replace_once(
    'app/ui/dom/stable-cupping-screen-renderer.ts',
    '''        onConfirm: async (value: BatchReviewValue) => {\n''',
    '''        onSupplementalRecognition: sourceFile ? async () => {\n          const currentValue = this.runtimeReview?.read();\n          if (currentValue) samples[index] = this.reviewedSample(samples[index], currentValue);\n          let changed = false;\n          await openManualROIRecognitionDialog({\n            root: this.managerOverlay!,\n            file: sourceFile,\n            onRecognize: async (box) => {\n              const result = await recognizeManualROIFromOriginal({ file: sourceFile, page: workingPage(), box, label: samples[index].label });\n              samples[index] = mergeSupplementalRecognizedSample(samples[index], result.sample, result.box);\n              this.saveRuntimeRecognitionDraft(workingPage(), index, addedIds, preview);\n              status.textContent = "局部信息已补充到当前豆子，请核对冲突候选后确认。";\n              changed = true;\n            }\n          });\n          if (changed) {\n            this.runtimeReview?.close(); this.runtimeReview = undefined;\n            openAt(index);\n          }\n        } : undefined,\n        onConfirm: async (value: BatchReviewValue) => {\n'''
)
replace_once(
    'app/ui/dom/stable-cupping-screen-renderer.ts',
    '''              this.saveRuntimeRecognitionDraft(page, index + 1, addedIds, preview);\n''',
    '''              this.saveRuntimeRecognitionDraft(workingPage(), index + 1, addedIds, preview);\n'''
)
replace_once(
    'app/ui/dom/stable-cupping-screen-renderer.ts',
    '''    const note = document.createElement("p"); note.className = "free-cupping-manager__note"; note.textContent = "当前杯测内容已落盘。拍照新增会经过 PP-OCRv5 识别、必要的多条目分割和逐豆确认；确认前不会写入当前杯测。";\n''',
    '''    const note = document.createElement("p"); note.className = "free-cupping-manager__note"; note.textContent = "当前杯测内容已落盘。拍照新增默认直接整图 PP-OCRv5 识别；需要补充小字或局部信息时，可在确认页手工框选原图区域再次识别。确认前不会写入当前杯测。";\n'''
)
replace_once(
    'app/ui/dom/stable-cupping-screen-renderer.ts',
    '''        this.openRecognitionReview(draft.page, draft.preview, status, add, draft.index, draft.addedSampleIds);\n''',
    '''        this.openRecognitionReview(draft.page, draft.preview, status, add, draft.index, draft.addedSampleIds);\n'''
)

# 7) Regression contract: default fast path + explicit fallback + manual ROI evidence.
(ROOT / 'tests/full-image-default-roi-regression.test.ts').write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("segmentation decorator keeps whole-image recognition as default and automatic segmentation explicit", () => {
  const source = readFileSync("app/ui/dom/segmentation-review-recognizer.ts", "utf8");
  assert.match(source, /override async recognizePage[\s\S]*return this\.delegate\.recognizePage\(file, index\)/);
  assert.match(source, /recognizeWithAutomaticSegmentation/);
  assert.match(source, /openSegmentationReviewDialogV2/);
});

test("manual ROI supplement is exposed from confirmation without overwriting full-image evidence", () => {
  const dialog = readFileSync("app/ui/dom/batch-review-dialog.ts", "utf8");
  const core = readFileSync("app/core/sample-manual-roi-recognition.ts", "utf8");
  assert.match(dialog, /框选补充识别/);
  assert.match(core, /recognizeManualROIFromOriginal/);
  assert.match(core, /source: "manual_roi"/);
  assert.match(core, /manual_roi_conflict/);
  assert.match(core, /refineSegmentationRegionEvidence/);
  assert.match(core, /untouched original File|original File/);
});

test("setup and runtime add-bean flows retain original File for optional ROI supplement", () => {
  const setup = readFileSync("app/ui/dom/batch-setup-review-renderer.ts", "utf8");
  const runtime = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
  assert.match(setup, /sourceFile\?: File/);
  assert.match(setup, /openManualROIRecognitionDialog/);
  assert.match(setup, /整图识别/);
  assert.match(runtime, /openManualROIRecognitionDialog/);
  assert.match(runtime, /默认直接整图 PP-OCRv5 识别/);
});
''')

print('full-image default + manual ROI migration applied')
