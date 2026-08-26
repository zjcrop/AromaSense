import {
  BATCH_SETUP_DRAFT_VERSION,
  batchSetupDraftCounts,
  firstPendingItemIndex,
  normalizeBatchSetupDraft,
  type BatchSetupDraft,
  type BatchSetupDraftItem
} from "../../core/batch-setup-draft";
import type { CuppingSetupService } from "../../core/cupping-setup-service";
import { normalizeImportBundle, type ImportBundle, type ImportSessionDraft } from "../../core/import-bundle";
import { recognizeManualText } from "../../core/manual-text-recognizer";
import {
  defaultSessionMetadata,
  normalizeSessionMetadata,
  type CuppingSessionMetadata
} from "../../core/session-metadata";
import type { RecognizedPage, RecognizedSample, SampleRecognitionService } from "../../core/sample-recognition-service";
import { parseSpreadsheetFile, SPREADSHEET_ACCEPT } from "../../core/spreadsheet-import";
import { openBatchReviewDialog, type BatchReviewDialogHandle, type BatchReviewField, type BatchReviewValue } from "./batch-review-dialog";
import { button, clearElement, element } from "./dom-helpers";
import { compactImagePreview } from "./image-preview-data";
import { openImportBundleDialog } from "./import-bundle-dialog";
import { openManualTextImportDialog } from "./manual-text-import-dialog";
import { openQrScannerDialog } from "./qr-scanner-dialog";

export interface RecentSessionItem {
  sessionId: string;
  title?: string;
  status: "draft" | "active" | "completed" | "archived";
  updatedAt: string;
  sampleCount: number;
}

export interface BatchSetupRendererOptions {
  now(): string;
  createSessionId(): string;
  createSampleId(index: number): string;
  onCreated(sessionId: string): void | Promise<void>;
  onResume?(sessionId: string): void | Promise<void>;
  onOpenAccount?(): void | Promise<void>;
  onOpenRecords?(): void | Promise<void>;
  recentSessions?: readonly RecentSessionItem[];
  syncLabel?: string;
  loadDraft?(): Promise<BatchSetupDraft | undefined>;
  saveDraft?(draft: BatchSetupDraft): void | Promise<void>;
  clearDraft?(): void | Promise<void>;
}

type FieldSpec = readonly [key: string, label: string, group: string, kind?: "date" | "multiline"];
const FIELD_SPECS: readonly FieldSpec[] = [
  ["country", "国家", "产地信息"], ["origin", "产地", "产地信息"], ["region", "产区", "产地信息"],
  ["farm", "庄园", "产地信息"], ["station", "处理站", "产地信息"], ["producer", "生产者", "产地信息"], ["cooperative", "合作社", "产地信息"],
  ["variety", "品种", "豆种与处理"], ["species", "种属", "豆种与处理"], ["process", "处理法", "豆种与处理"], ["lot", "批次", "豆种与处理"], ["grade", "等级", "豆种与处理"],
  ["roast", "烘焙度", "烘焙与批次"], ["roastColor", "烘焙色值", "烘焙与批次"], ["roastDate", "烘焙日期", "烘焙与批次", "date"],
  ["productionDate", "生产日期", "烘焙与批次", "date"], ["packDate", "包装日期", "烘焙与批次", "date"], ["bestBefore", "最佳赏味期", "烘焙与批次", "date"], ["expiryDate", "到期日", "烘焙与批次", "date"], ["harvest", "产季", "烘焙与批次"],
  ["altitude", "海拔", "其他信息"], ["roaster", "烘焙商", "其他信息"], ["weight", "净重", "其他信息"], ["flavorNotes", "风味", "其他信息", "multiline"], ["aroma", "香气", "其他信息", "multiline"]
];

interface ReviewCandidateLike { normalizedValue?: string; value?: string; score?: number }
interface ReviewDecisionLike { field?: string; value?: string; confidence?: number; candidates?: ReviewCandidateLike[] }
interface RowState { id: string; previewDataUrl?: string; status?: string; requiresReview: boolean; confirmed: boolean }
interface ConfirmedImportSession {
  title?: string;
  metadata: CuppingSessionMetadata;
  samples: Array<{ label: string; metadata: Record<string, unknown> }>;
}
interface ImportQueueState {
  sessions: ImportSessionDraft[];
  index: number;
  completed: ConfirmedImportSession[];
  sourceName: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function storageKey(field: string): string { return field === "flavor" ? "flavorNotes" : field; }
function decisions(metadata: Record<string, unknown>): ReviewDecisionLike[] {
  const recognition = record(metadata.recognition);
  return Array.isArray(recognition?.review) ? recognition.review as ReviewDecisionLike[] : [];
}
function candidates(metadata: Record<string, unknown>, key: string): string[] {
  const item = decisions(metadata).find((decision) => storageKey(String(decision.field ?? "")) === key);
  return [...new Set((item?.candidates ?? []).map((candidate) => String(candidate.normalizedValue ?? candidate.value ?? "").trim()).filter(Boolean))];
}
function confidence(metadata: Record<string, unknown>, key: string): number | undefined {
  const item = decisions(metadata).find((decision) => storageKey(String(decision.field ?? "")) === key);
  const value = Number(item?.confidence);
  return Number.isFinite(value) ? value : undefined;
}

export class BatchSetupRenderer {
  private readonly rowsRoot = element("div", "batch-setup__rows");
  private readonly statusRoot = element("div", "batch-setup__status");
  private readonly titleInput = element("input", "batch-setup__title");
  private readonly sessionInputs = new Map<keyof CuppingSessionMetadata, HTMLInputElement>();
  private readonly metadata = new WeakMap<HTMLElement, Record<string, unknown>>();
  private readonly state = new WeakMap<HTMLElement, RowState>();
  private review?: BatchReviewDialogHandle;
  private sequence = 0;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private startButton?: HTMLButtonElement;
  private importQueue?: ImportQueueState;

  constructor(
    private readonly root: HTMLElement,
    private readonly service: CuppingSetupService,
    private readonly recognizer: SampleRecognitionService,
    private readonly options: BatchSetupRendererOptions
  ) {
    this.titleInput.type = "text";
    this.titleInput.placeholder = "杯测会名称（可选）";
    this.titleInput.addEventListener("change", () => void this.saveDraft());
  }

  async render(): Promise<void> {
    clearElement(this.root);
    clearElement(this.rowsRoot);
    this.root.classList.add("batch-setup");

    const header = element("header", "batch-setup__header");
    const copy = element("div", "batch-setup__header-copy");
    copy.append(element("h1", "batch-setup__heading", "AromaSense · 香迹 0.1C"));
    const headerActions = element("div", "batch-setup__header-actions");
    headerActions.append(
      button("batch-setup__account", "账户", () => this.options.onOpenAccount?.()),
      button("batch-setup__import", "导入", () => this.openImportMenu()),
      button("batch-setup__records", "杯测记录", () => this.options.onOpenRecords?.())
    );
    header.append(copy, headerActions);

    const metadataForm = this.renderSessionMetadataForm();
    const cameraInput = this.imageInput(false, true);
    const galleryInput = this.imageInput(true, false);
    const spreadsheetInput = this.spreadsheetInput();
    const qrInput = this.qrInput();
    const actions = element("section", "batch-setup__capture-actions");
    actions.setAttribute("aria-label", "识别方法");
    actions.append(
      button("batch-setup__capture", "拍摄录入", () => cameraInput.click()),
      button("batch-setup__capture", "批量识别", () => this.openBatchRecognitionMenu(galleryInput, spreadsheetInput, qrInput)),
      button("batch-setup__add", "手工录入", () => this.openManualText())
    );
    this.startButton = button("batch-setup__start", "开始杯测", () => this.submit());
    this.statusRoot.hidden = true;
    this.root.append(header, metadataForm, actions, cameraInput, galleryInput, spreadsheetInput, qrInput, this.rowsRoot, this.statusRoot, this.startButton);
    const recent = this.renderRecentSessions();
    if (recent) this.root.append(recent);
    await this.restoreDraft();
    this.ensureEmptyHint();
  }

  private renderSessionMetadataForm(): HTMLElement {
    const defaults = defaultSessionMetadata(this.options.now());
    const section = element("section", "batch-setup__session-meta");
    section.append(element("h2", "batch-setup__session-meta-title", "本次杯测标注"));
    const grid = element("div", "batch-setup__session-meta-grid");
    const specs: Array<[keyof CuppingSessionMetadata, string, string, boolean]> = [
      ["date", "日期", "date", true], ["time", "时间", "time", true], ["organizer", "组织方", "text", true],
      ["participants", "参与对象", "text", false], ["target", "测试目标", "text", false], ["eventName", "杯测会名称", "text", false]
    ];
    for (const [key, label, type, required] of specs) {
      const field = element("label", "batch-setup__session-meta-field");
      const caption = element("span", "batch-setup__session-meta-label", required ? `${label} *` : label);
      const input = element("input", "batch-setup__session-meta-input");
      input.type = type;
      input.required = required;
      if (key === "date") input.value = defaults.date;
      if (key === "time") input.value = defaults.time;
      input.addEventListener("change", () => {
        if (key === "eventName") this.titleInput.value = input.value;
        void this.saveDraft();
      });
      this.sessionInputs.set(key, input);
      field.append(caption, input);
      grid.append(field);
    }
    section.append(grid);
    return section;
  }

  private resetSessionMetadata(): void {
    const defaults = defaultSessionMetadata(this.options.now());
    for (const key of ["date", "time", "organizer", "participants", "target", "eventName"] as const) {
      const input = this.sessionInputs.get(key);
      if (!input) continue;
      input.value = key === "date" ? defaults.date : key === "time" ? defaults.time : "";
    }
    this.titleInput.value = "";
  }

  private sessionMetadata(): CuppingSessionMetadata {
    return normalizeSessionMetadata({
      date: this.sessionInputs.get("date")?.value,
      time: this.sessionInputs.get("time")?.value,
      organizer: this.sessionInputs.get("organizer")?.value,
      participants: this.sessionInputs.get("participants")?.value,
      target: this.sessionInputs.get("target")?.value,
      eventName: this.sessionInputs.get("eventName")?.value || this.titleInput.value
    });
  }

  private applySessionMetadata(metadata: Partial<CuppingSessionMetadata>): void {
    for (const key of ["date", "time", "organizer", "participants", "target", "eventName"] as const) {
      const input = this.sessionInputs.get(key);
      const value = metadata[key];
      if (input && typeof value === "string") input.value = value;
    }
    if (metadata.eventName) this.titleInput.value = metadata.eventName;
  }

  private imageInput(multiple: boolean, capture: boolean): HTMLInputElement {
    const input = element("input", "batch-setup__file-input");
    input.type = "file"; input.accept = "image/*"; input.multiple = multiple; input.hidden = true;
    if (capture) input.setAttribute("capture", "environment");
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])]; input.value = ""; void this.addPhotoFiles(files);
    });
    return input;
  }

  private spreadsheetInput(): HTMLInputElement {
    const input = element("input", "batch-setup__file-input");
    input.type = "file";
    input.accept = SPREADSHEET_ACCEPT;
    input.multiple = true;
    input.hidden = true;
    input.dataset.importSpreadsheet = "true";
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])]; input.value = ""; if (files.length) void this.importSpreadsheetFiles(files);
    });
    return input;
  }

  private qrInput(): HTMLInputElement {
    const input = element("input", "batch-setup__file-input");
    input.type = "file"; input.accept = "image/*"; input.hidden = true; input.dataset.importQr = "true";
    input.addEventListener("change", () => {
      const file = input.files?.[0]; input.value = ""; if (file) void this.importQr(file);
    });
    return input;
  }

  private scanQr(fallbackInput: HTMLInputElement): void {
    void openQrScannerDialog({
      root: this.root,
      onFallbackImage: () => fallbackInput.click(),
      onResult: async (value) => this.importFromLink(value, "qr")
    });
  }

  private openBatchRecognitionMenu(gallery: HTMLInputElement, spreadsheet: HTMLInputElement, qr: HTMLInputElement): void {
    const mode = window.prompt("批量识别：1 批量照片；2 表格/文档；3 链接；4 二维码。", "1")?.trim();
    if (mode === "1") gallery.click();
    else if (mode === "2") spreadsheet.click();
    else if (mode === "3") {
      const link = window.prompt("粘贴 AromaSense 分享链接");
      if (link?.trim()) void this.importFromLink(link.trim());
    } else if (mode === "4") this.scanQr(qr);
  }

  private openImportMenu(): void {
    const mode = window.prompt("导入：1 链接；2 二维码；3 表格文件。", "1")?.trim();
    if (mode === "2") {
      const qr = this.root.querySelector<HTMLInputElement>('input[data-import-qr="true"]');
      if (qr) this.scanQr(qr);
    } else if (mode === "3") this.root.querySelector<HTMLInputElement>('input[data-import-spreadsheet="true"]')?.click();
    else if (mode === "1") {
      const link = window.prompt("粘贴 AromaSense 分享链接");
      if (link?.trim()) void this.importFromLink(link.trim());
    }
  }

  private openManualText(): void {
    openManualTextImportDialog({
      root: this.root,
      onParse: async (text) => this.previewImportBundle(recognizeManualText(text))
    });
  }

  private async importSpreadsheetFiles(files: readonly File[]): Promise<void> {
    this.root.toggleAttribute("aria-busy", true);
    this.showStatus(`正在解析 ${files.length} 个表格/数据文件…`);
    try {
      const bundles = await Promise.all(files.map((file) => parseSpreadsheetFile(file)));
      const bundle: ImportBundle = {
        schema: "aromasense-import/1",
        source: { kind: "spreadsheet", name: files.length === 1 ? files[0].name : `${files.length} 个文件` },
        sessions: bundles.flatMap((item) => item.sessions),
        warnings: bundles.flatMap((item) => item.warnings)
      };
      this.previewImportBundle(bundle);
    } catch (error) {
      this.showStatus(`表格导入失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally { this.root.toggleAttribute("aria-busy", false); }
  }

  private async importQr(file: File): Promise<void> {
    const BarcodeDetectorCtor = (globalThis as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!BarcodeDetectorCtor || typeof createImageBitmap !== "function") {
      const link = window.prompt("当前环境不支持二维码图片解析，请粘贴二维码中的链接");
      if (link?.trim()) await this.importFromLink(link.trim());
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const results = await new BarcodeDetectorCtor({ formats: ["qr_code"] }).detect(bitmap);
      bitmap.close?.();
      const link = results[0]?.rawValue?.trim();
      if (!link) throw new Error("二维码中未检测到可用链接");
      await this.importFromLink(link, "qr");
    } catch (error) { this.showStatus(`二维码导入失败：${error instanceof Error ? error.message : String(error)}`, true); }
  }

  private async importFromLink(link: string, kind: "link" | "qr" = "link"): Promise<void> {
    this.root.toggleAttribute("aria-busy", true);
    this.showStatus("正在读取分享数据…");
    try {
      const url = new URL(link, window.location.href);
      const embedded = url.searchParams.get("import");
      const payload: unknown = embedded
        ? JSON.parse(decodeURIComponent(embedded))
        : await (async () => {
            const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
            if (!response.ok) throw new Error(`分享链接返回 HTTP ${response.status}`);
            return response.json();
          })();
      const bundle = normalizeImportBundle(payload, { kind, name: url.hostname || "分享链接" });
      if (!bundle) throw new Error("分享数据没有可识别的杯测组或样品");
      this.previewImportBundle(bundle);
    } catch (error) { this.showStatus(`链接导入失败：${error instanceof Error ? error.message : String(error)}`, true); }
    finally { this.root.toggleAttribute("aria-busy", false); }
  }

  private previewImportBundle(bundle: ImportBundle): void {
    openImportBundleDialog({
      root: this.root,
      bundle,
      onAccept: async (sessions) => {
        if (sessions.length > 1) {
          this.importQueue = { sessions: [...sessions], index: 0, completed: [], sourceName: bundle.source.name ?? "批量导入" };
          await this.loadImportSession(this.importQueue.sessions[0], 0, this.importQueue.sessions.length);
          return;
        }
        this.importQueue = undefined;
        await this.loadImportSession(sessions[0], 0, 1);
      }
    });
  }

  private async loadImportSession(session: ImportSessionDraft, index: number, total: number): Promise<void> {
    this.review?.close(); this.review = undefined;
    clearElement(this.rowsRoot);
    this.resetSessionMetadata();
    this.applySessionMetadata(session.metadata);
    this.titleInput.value = session.title ?? session.metadata.eventName ?? "";
    for (const sample of session.samples) {
      const metadata = { ...sample.metadata };
      if (sample.rawText) {
        const recognition = record(metadata.recognition) ?? {};
        metadata.recognition = { ...recognition, rawText: sample.rawText, sourceRow: sample.sourceRow };
      }
      this.addRow(sample.label, metadata, {
        id: this.rowId(),
        status: `${session.sourceGroup} · 导入待确认`,
        requiresReview: sample.requiresReview,
        confirmed: false
      });
    }
    if (this.startButton) this.startButton.textContent = total > 1 ? (index + 1 < total ? "保存本组并继续" : "完成批量导入") : "开始杯测";
    await this.saveDraft();
    this.showStatus(total > 1 ? `批量导入 ${index + 1}/${total}：${session.sourceGroup} · ${session.samples.length} 个样品。先逐一确认。` : `已导入 ${session.samples.length} 个样品，开始逐一确认。`);
    const pending = firstPendingItemIndex(this.items());
    if (pending >= 0) { const row = this.rows()[pending]; if (row) this.openReview(row); }
  }

  private renderRecentSessions(): HTMLElement | undefined {
    const sessions = this.options.recentSessions?.filter((item) => item.status === "draft" || item.status === "active") ?? [];
    if (!sessions.length || !this.options.onResume) return undefined;
    const section = element("section", "batch-setup__recent");
    section.append(element("h2", "batch-setup__recent-title", "继续未完成杯测"));
    for (const session of sessions.slice(0, 5)) {
      const row = element("button", "batch-setup__recent-item"); row.type = "button";
      row.append(
        element("strong", "batch-setup__recent-name", session.title?.trim() || "未命名杯测"),
        element("span", "batch-setup__recent-meta", `${session.sampleCount} 个样品 · ${session.status === "active" ? "进行中" : "未开始"}`)
      );
      row.addEventListener("click", () => void this.options.onResume?.(session.sessionId)); section.append(row);
    }
    return section;
  }

  private rowId(): string { this.sequence += 1; return `batch-${Date.now().toString(36)}-${this.sequence.toString(36)}`; }

  private addRow(label: string, metadata: Record<string, unknown>, state: RowState): HTMLElement {
    this.rowsRoot.querySelector(".batch-setup__empty-hint")?.remove();
    const row = element("article", "batch-setup__row"); row.dataset.rowId = state.id;
    this.metadata.set(row, { ...metadata }); this.state.set(row, state);
    const preview = state.previewDataUrl ? element("button", "batch-setup__preview-button") : element("button", "batch-setup__manual-mark", "录入");
    preview.type = "button";
    if (state.previewDataUrl) {
      const image = element("img", "batch-setup__preview"); image.src = state.previewDataUrl; image.alt = "样品来源图片预览"; preview.append(image);
    }
    preview.addEventListener("click", () => this.openReview(row));
    const main = element("div", "batch-setup__row-main");
    const name = element("input", "batch-setup__sample-label"); name.type = "text"; name.readOnly = true; name.value = label; name.addEventListener("click", () => this.openReview(row)); main.append(name);
    const rowActions = element("div", "batch-setup__row-actions");
    const review = button("batch-setup__review", state.confirmed ? "修改" : "确认", () => this.openReview(row)); review.dataset.review = "true";
    rowActions.append(review, button("batch-setup__remove", "删除", () => this.removeRow(row)));
    row.append(preview, main, rowActions); this.rowsRoot.append(row); this.refreshRow(row); this.renumber(); return row;
  }

  private refreshRow(row: HTMLElement): void {
    const state = this.state.get(row); if (!state) return;
    row.classList.toggle("requires-review", state.requiresReview && !state.confirmed);
    row.classList.toggle("is-pending-confirmation", !state.confirmed); row.classList.toggle("is-confirmed", state.confirmed);
    const review = row.querySelector<HTMLButtonElement>("[data-review]"); if (review) review.textContent = state.confirmed ? "修改" : "确认";
    const main = row.querySelector<HTMLElement>(".batch-setup__row-main"); if (!main) return;
    main.querySelector(".batch-setup__recognition-status")?.remove(); main.querySelector(".batch-setup__field-summary")?.remove();
    main.append(element("small", `batch-setup__recognition-status${state.confirmed ? " is-confirmed" : state.requiresReview ? " is-review" : ""}`, `${state.confirmed ? "已确认" : "待确认"}${state.status ? ` · ${state.status}` : ""}`));
    const metadata = this.metadata.get(row) ?? {}; const summary = element("div", "batch-setup__field-summary");
    for (const [key, labelText] of FIELD_SPECS) {
      const value = String(metadata[key] ?? "").trim(); if (!value || summary.childElementCount >= 8) continue;
      summary.append(element("span", "batch-setup__field-chip", `${labelText}：${value}`));
    }
    if (summary.childElementCount) main.append(summary);
  }

  private removeRow(row: HTMLElement): void {
    if (this.review && row.dataset.rowId === this.root.querySelector<HTMLElement>(".batch-review")?.dataset.rowId) { this.review.close(); this.review = undefined; }
    row.remove(); this.renumber(); this.ensureEmptyHint(); void this.saveDraft();
  }

  private rows(): HTMLElement[] { return [...this.rowsRoot.querySelectorAll<HTMLElement>(".batch-setup__row")]; }
  private items(): BatchSetupDraftItem[] {
    return this.rows().flatMap((row) => {
      const state = this.state.get(row); if (!state) return [];
      return [{ id: state.id, label: row.querySelector<HTMLInputElement>(".batch-setup__sample-label")?.value ?? "", metadata: { ...(this.metadata.get(row) ?? {}) }, previewDataUrl: state.previewDataUrl, recognitionStatus: state.status, requiresReview: state.requiresReview, confirmed: state.confirmed }];
    });
  }

  private sampleDrafts(): Array<{ label: string; metadata: Record<string, unknown> }> {
    return this.rows().flatMap((row) => {
      const label = row.querySelector<HTMLInputElement>(".batch-setup__sample-label")?.value.trim() ?? "";
      return label && !/^待确认样品\s+\d+$/u.test(label) ? [{ label, metadata: { ...(this.metadata.get(row) ?? {}) } }] : [];
    });
  }

  private async saveDraft(): Promise<void> {
    try {
      const items = this.items();
      if (!items.length) { await this.options.clearDraft?.(); return; }
      const sessionMetadata: Partial<CuppingSessionMetadata> = {};
      for (const key of ["date", "time", "organizer", "participants", "target", "eventName"] as const) {
        const value = this.sessionInputs.get(key)?.value.trim(); if (value) sessionMetadata[key] = value;
      }
      await this.options.saveDraft?.({ version: BATCH_SETUP_DRAFT_VERSION, title: this.titleInput.value, sessionMetadata, items, updatedAt: this.options.now() });
    } catch (error) { this.showStatus(`本地暂存失败：${error instanceof Error ? error.message : String(error)}`, true); }
  }
  private scheduleSave(): void { if (this.saveTimer) clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => void this.saveDraft(), 250); }

  private async restoreDraft(): Promise<void> {
    try {
      const draft = normalizeBatchSetupDraft(await this.options.loadDraft?.()); if (!draft) return;
      this.titleInput.value = draft.title; this.applySessionMetadata(draft.sessionMetadata);
      for (const item of draft.items) this.addRow(item.label, item.metadata, { id: item.id, previewDataUrl: item.previewDataUrl, status: item.recognitionStatus, requiresReview: item.requiresReview, confirmed: item.confirmed });
      const counts = batchSetupDraftCounts(draft.items);
      this.showStatus(counts.pending ? `已恢复上次录入：${counts.confirmed}/${counts.total} 已确认，剩余 ${counts.pending} 个。` : `已恢复 ${counts.total} 个已确认样品。`);
    } catch (error) { this.showStatus(`恢复批量录入草稿失败：${error instanceof Error ? error.message : String(error)}`, true); }
  }

  private reviewFields(row: HTMLElement): BatchReviewField[] {
    const metadata = this.metadata.get(row) ?? {};
    return FIELD_SPECS.map(([key, labelText, group, kind]) => ({ key, label: labelText, group, value: String(metadata[key] ?? ""), candidates: candidates(metadata, key), confidence: confidence(metadata, key), multiline: kind === "multiline", date: kind === "date" }));
  }

  private applyReviewValue(row: HTMLElement, value: BatchReviewValue, markDirty: boolean, confirm: boolean): void {
    const state = this.state.get(row); if (!state) return;
    const metadata = { ...(this.metadata.get(row) ?? {}) };
    for (const [key] of FIELD_SPECS) delete metadata[key];
    for (const [key, fieldValue] of Object.entries(value.fields)) metadata[key] = fieldValue;
    if (confirm) metadata.recognition = { ...(record(metadata.recognition) ?? {}), userConfirmedFields: { ...value.fields }, confirmedAt: this.options.now() };
    this.metadata.set(row, metadata);
    const label = row.querySelector<HTMLInputElement>(".batch-setup__sample-label"); if (label) label.value = value.label;
    if (markDirty && state.confirmed) state.confirmed = false; if (confirm) state.confirmed = true; this.refreshRow(row);
  }

  private openReview(row: HTMLElement): void {
    this.review?.close(); const rows = this.rows(); const index = rows.indexOf(row); if (index < 0) return;
    const state = this.state.get(row); if (!state) return; const metadata = this.metadata.get(row) ?? {};
    const counts = batchSetupDraftCounts(this.items()); const recognition = record(metadata.recognition);
    this.review = openBatchReviewDialog({
      root: this.root, rowId: state.id, index, total: rows.length, confirmed: counts.confirmed,
      previewUrl: state.previewDataUrl, recognitionStatus: state.status, rawText: String(recognition?.rawText ?? ""),
      label: row.querySelector<HTMLInputElement>(".batch-setup__sample-label")?.value ?? "", fields: this.reviewFields(row),
      onChange: (value) => { this.applyReviewValue(row, value, true, false); this.scheduleSave(); },
      onExit: async (value) => { this.applyReviewValue(row, value, false, false); await this.saveDraft(); this.review?.close(); this.review = undefined; },
      onPrevious: index > 0 ? async (value) => { this.applyReviewValue(row, value, false, false); await this.saveDraft(); this.openReview(rows[index - 1]); } : undefined,
      onConfirm: async (value) => {
        this.applyReviewValue(row, value, false, true); await this.saveDraft();
        const next = firstPendingItemIndex(this.items(), index);
        if (next >= 0) { const target = this.rows()[next]; if (target) this.openReview(target); return; }
        this.review?.close(); this.review = undefined;
        const final = batchSetupDraftCounts(this.items());
        this.showStatus(this.importQueue
          ? `本组 ${final.total} 个样品已确认。检查日期、时间和组织方后点击“${this.startButton?.textContent ?? "保存本组"}”。`
          : `已完成 ${final.total} 个样品确认。`);
      }
    });
  }

  private addRecognizedPage(page: RecognizedPage, preview: string): number {
    for (let index = 0; index < page.samples.length; index += 1) {
      const sample: RecognizedSample = page.samples[index]; const needsReview = sample.requiresReview || page.requiresSegmentationReview;
      this.addRow(sample.label, sample.metadata, { id: this.rowId(), previewDataUrl: preview, status: [page.engine, page.samples.length > 1 ? `同图样品 ${index + 1}/${page.samples.length}` : "单样品", `版面 ${page.layoutType}`, needsReview ? "存在待核对字段" : "自动识别完成"].join(" · "), requiresReview: needsReview, confirmed: false });
    }
    return page.samples.length;
  }

  private async addPhotoFiles(files: readonly File[]): Promise<void> {
    const images = files.filter((file) => file.type.startsWith("image/")); if (!images.length) { this.showStatus("没有选择可识别的图片", true); return; }
    this.root.toggleAttribute("aria-busy", true); this.showStatus(`正在分析 ${images.length} 张图片…`);
    try {
      const previewPromise = Promise.all(images.map((file) => compactImagePreview(file)));
      const results = await this.recognizer.recognizeBatch(images, (progress) => this.showStatus(`识别 ${progress.index}/${progress.total}：${progress.fileName}${progress.message ? ` · ${progress.message}` : ""}`, progress.status === "failed"));
      const previews = await previewPromise; let count = 0;
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index]; const preview = previews[index];
        if (result instanceof Error) { this.addRow("", { recognition: { source: "photo", fileName: images[index].name, status: "failed", error: result.message } }, { id: this.rowId(), previewDataUrl: preview, status: `自动识别失败：${result.message}`, requiresReview: true, confirmed: false }); count += 1; }
        else count += this.addRecognizedPage(result, preview);
      }
      await this.saveDraft(); this.showStatus(`已得到 ${count} 个样品。`);
      const pending = firstPendingItemIndex(this.items()); if (pending >= 0) { const row = this.rows()[pending]; if (row) this.openReview(row); }
    } catch (error) { this.showStatus(error instanceof Error ? error.message : String(error), true); }
    finally { this.root.toggleAttribute("aria-busy", false); this.renumber(); }
  }

  private renumber(): void { this.rows().forEach((row, index) => { const input = row.querySelector<HTMLInputElement>(".batch-setup__sample-label"); if (input) input.placeholder = `样品 ${index + 1}`; }); }
  private ensureEmptyHint(): void { if (!this.rows().length && !this.rowsRoot.querySelector(".batch-setup__empty-hint")) this.rowsRoot.append(element("p", "batch-setup__empty-hint", "尚未添加样品。可使用拍摄录入、批量识别或手工录入。")); }

  private validateCurrentGroup(): ConfirmedImportSession | undefined {
    const rows = this.rows();
    const pending = rows.filter((row) => this.state.get(row)?.confirmed !== true);
    if (pending.length) { this.showStatus(`仍有 ${pending.length} 个样品未确认。`, true); this.openReview(pending[0]); return undefined; }
    const samples = this.sampleDrafts();
    if (!samples.length || samples.length !== rows.length) { this.showStatus("所有样品都必须确认有效名称。", true); return undefined; }
    let metadata: CuppingSessionMetadata;
    try { metadata = this.sessionMetadata(); }
    catch { this.showStatus("日期、时间和组织方为必填项。", true); return undefined; }
    return { title: metadata.eventName || this.titleInput.value.trim() || undefined, metadata, samples };
  }

  private async saveImportGroupAndContinue(): Promise<void> {
    const queue = this.importQueue;
    if (!queue) return;
    const current = this.validateCurrentGroup();
    if (!current) return;
    queue.completed.push(current);
    if (queue.index + 1 < queue.sessions.length) {
      queue.index += 1;
      await this.loadImportSession(queue.sessions[queue.index], queue.index, queue.sessions.length);
      return;
    }

    this.root.toggleAttribute("aria-busy", true);
    try {
      let sampleOffset = 0;
      const inputs = queue.completed.map((group) => {
        const offset = sampleOffset;
        sampleOffset += group.samples.length;
        return {
          sessionId: this.options.createSessionId(),
          title: group.title,
          metadata: group.metadata,
          samples: group.samples,
          now: this.options.now(),
          sampleIdFactory: (index: number) => this.options.createSampleId(offset + index)
        };
      });
      await this.service.createMany(inputs);
      const count = queue.completed.length;
      this.importQueue = undefined;
      await this.options.clearDraft?.();
      clearElement(this.rowsRoot);
      if (this.startButton) this.startButton.textContent = "开始杯测";
      this.showStatus(`已完成 ${count} 组杯测批量导入，全部以单一事务保存为未开始记录。`);
      await this.options.onOpenRecords?.();
    } catch (error) {
      this.showStatus(`批量建立杯测失败，整批数据已回滚：${error instanceof Error ? error.message : String(error)}`, true);
    } finally { this.root.toggleAttribute("aria-busy", false); }
  }

  private async submit(): Promise<void> {
    if (this.importQueue) { await this.saveImportGroupAndContinue(); return; }
    const group = this.validateCurrentGroup();
    if (!group) return;
    this.root.toggleAttribute("aria-busy", true);
    try {
      const result = await this.service.create({ sessionId: this.options.createSessionId(), title: group.title, metadata: group.metadata, samples: group.samples, now: this.options.now(), sampleIdFactory: (index) => this.options.createSampleId(index) });
      await this.options.clearDraft?.(); this.showStatus(""); await this.options.onCreated(result.session.sessionId);
    } catch (error) { this.showStatus(error instanceof Error ? error.message : String(error), true); }
    finally { this.root.toggleAttribute("aria-busy", false); }
  }

  private showStatus(text: string, error = false): void { this.statusRoot.textContent = text; this.statusRoot.classList.toggle("is-error", error); this.statusRoot.hidden = text.length === 0; }
}
