import {
  BATCH_SETUP_DRAFT_VERSION,
  batchSetupDraftCounts,
  firstPendingItemIndex,
  normalizeBatchSetupDraft,
  type BatchSetupDraft,
  type BatchSetupDraftItem
} from "../../core/batch-setup-draft";
import {
  buildEmptySampleDrafts,
  cuppingTargetChoiceFromMetadata,
  type CuppingTargetChoice
} from "../../core/cupping-target";
import type { CuppingSetupService } from "../../core/cupping-setup-service";
import { normalizeImportBundle, type ImportBundle, type ImportSessionDraft } from "../../core/import-bundle";
import { recognizeManualText } from "../../core/manual-text-recognizer";
import { canonicalizeAndValidateImportBundle, canonicalizeSampleInput, validateSampleInput, type CoffeeFoundationGateway, type InputValidationResult } from "../../core/sample-input-pipeline";
import {
  cuppingModeLabel,
  defaultSessionMetadata,
  normalizeCuppingMode,
  normalizeSessionMetadata,
  type CuppingMode,
  type CuppingSessionMetadata
} from "../../core/session-metadata";
import type { RecognizedPage, RecognizedSample, SampleRecognitionService } from "../../core/sample-recognition-service";
import { parseSpreadsheetFile, SPREADSHEET_ACCEPT } from "../../core/spreadsheet-import";
import { openBatchReviewDialog, type BatchReviewDialogHandle, type BatchReviewField, type BatchReviewValue } from "./batch-review-dialog";
import { eventManifestFromSubmission, type EventManifest } from "../../core/submission-bundle";
import { button, clearElement, element } from "./dom-helpers";
import { compactImagePreview } from "./image-preview-data";
import { openImportBundleDialog } from "./import-bundle-dialog";
import { openImportSourceDialog } from "./import-source-dialog";
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
  foundationGateway?: CoffeeFoundationGateway;
  cacheEvent?(manifest: EventManifest): void | Promise<void>;
}

type FieldSpec = readonly [key: string, label: string, group: string, kind?: "date" | "multiline", tier?: "core" | "detail"];
const FIELD_SPECS: readonly FieldSpec[] = [
  ["country", "国家", "产地信息"], ["origin", "产地", "产地信息"], ["region", "产区", "产地信息"],
  ["variety", "品种", "豆种与处理"], ["process", "处理法", "豆种与处理"], ["altitude", "海拔", "产地信息"],
  ["roaster", "烘焙商", "烘焙与批次"], ["roast", "烘焙度", "烘焙与批次"], ["roastDate", "烘焙日期", "烘焙与批次", "date"],
  ["flavorNotes", "风味", "风味线索", "multiline"], ["aroma", "香气", "风味线索", "multiline"],
  ["farm", "庄园", "产地信息", undefined, "detail"], ["station", "处理站", "产地信息", undefined, "detail"], ["producer", "生产者", "产地信息", undefined, "detail"], ["cooperative", "合作社", "产地信息", undefined, "detail"],
  ["species", "种属", "豆种与处理", undefined, "detail"], ["lot", "批次", "豆种与处理", undefined, "detail"], ["grade", "等级", "豆种与处理", undefined, "detail"],
  ["roastColor", "烘焙色值", "烘焙与批次", undefined, "detail"], ["productionDate", "生产日期", "烘焙与批次", "date", "detail"], ["packDate", "包装日期", "烘焙与批次", "date", "detail"], ["bestBefore", "最佳赏味期", "烘焙与批次", "date", "detail"], ["expiryDate", "到期日", "烘焙与批次", "date", "detail"], ["harvest", "产季", "烘焙与批次", undefined, "detail"],
  ["weight", "净重", "其他信息", undefined, "detail"]
];

const CUPPING_TARGET_OPTIONS: readonly CuppingTargetChoice[] = ["open", "blind", "semi_blind"] as const;

interface ReviewCandidateLike { normalizedValue?: string; value?: string; score?: number }
interface ReviewDecisionLike { field?: string; value?: string; confidence?: number; candidates?: ReviewCandidateLike[] }
interface RowState { id: string; previewDataUrl?: string; status?: string; requiresReview: boolean; confirmed: boolean }
interface SampleSetupDraft { label?: string; metadata: Record<string, unknown> }
interface ConfirmedImportSession {
  title?: string;
  metadata: CuppingSessionMetadata;
  samples: SampleSetupDraft[];
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

function installCuppingTargetStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cupping-target]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCuppingTarget = "true";
  style.textContent = `
    .batch-setup__target-shell{position:relative;display:grid;gap:6px}
    .batch-setup__target-button{width:100%;min-height:42px;border:1px solid rgba(185,153,90,.34);border-radius:9px;padding:8px 10px;background:#242424;color:#f4efe4;text-align:left;font:inherit;cursor:pointer}
    .batch-setup__target-button::after{content:'⌄';float:right;color:#b9995a}
    .batch-setup__target-menu{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:1400;overflow:hidden;border:1px solid #777;border-radius:9px;background:#fff;box-shadow:0 12px 30px rgba(0,0,0,.42)}
    .batch-setup__target-option{display:block;width:100%;min-height:40px;border:0;border-bottom:1px solid #dedede;padding:8px 11px;background:#fff;color:#111;text-align:left;font:inherit;cursor:pointer}
    .batch-setup__target-option:last-child{border-bottom:0}
    .batch-setup__target-option:hover,.batch-setup__target-option:focus-visible,.batch-setup__target-option.is-selected{background:#3b3b3b;color:#fff;outline:none}
    .batch-setup__target-help{color:#928d84;font-size:10px;line-height:1.45}
    .batch-setup__blind-entry-note{margin:0 0 14px;padding:12px;border:1px dashed rgba(185,153,90,.28);border-radius:10px;color:#aaa39a;background:rgba(185,153,90,.05);font-size:11px;line-height:1.55}
    .cupping-count-dialog{position:fixed;inset:0;z-index:1700;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72);backdrop-filter:blur(5px)}
    .cupping-count-dialog__panel{width:min(420px,100%);border:1px solid rgba(185,153,90,.36);border-radius:14px;padding:18px;background:#181818;color:#f4efe4;box-shadow:0 18px 48px rgba(0,0,0,.55)}
    .cupping-count-dialog__title{margin:0 0 8px;font-size:18px}
    .cupping-count-dialog__note{margin:0 0 14px;color:#aaa39a;font-size:12px;line-height:1.5}
    .cupping-count-dialog__label{display:grid;gap:6px;color:#c6b58b;font-size:12px}
    .cupping-count-dialog__input{width:100%;min-height:44px;border:1px solid rgba(185,153,90,.42);border-radius:9px;padding:8px 10px;background:#fff;color:#111;font:inherit}
    .cupping-count-dialog__input:focus{border-color:#b9995a;outline:none;box-shadow:0 0 0 2px rgba(185,153,90,.12)}
    .cupping-count-dialog__error{min-height:18px;margin:8px 0 0;color:#ef9e9e;font-size:11px}
    .cupping-count-dialog__actions{display:grid;grid-template-columns:.7fr 1fr;gap:8px;margin-top:14px}
    .cupping-count-dialog__cancel,.cupping-count-dialog__confirm{min-height:42px;border-radius:9px;font-weight:700}
    .cupping-count-dialog__cancel{border:1px solid rgba(185,153,90,.32);background:#222;color:#c9c0ae}
    .cupping-count-dialog__confirm{border:1px solid #b9995a;background:#b9995a;color:#111}
  `;
  document.head.append(style);
}

export class BatchSetupRenderer {
  private readonly rowsRoot = element("div", "batch-setup__rows");
  private readonly statusRoot = element("div", "batch-setup__status");
  private readonly titleInput = element("input", "batch-setup__title");
  private readonly sessionInputs = new Map<keyof CuppingSessionMetadata, HTMLInputElement>();
  private readonly metadata = new WeakMap<HTMLElement, Record<string, unknown>>();
  private readonly state = new WeakMap<HTMLElement, RowState>();
  private readonly blindEntryNote = element("p", "batch-setup__blind-entry-note", "盲测无需预先录入样品信息。点击“开始杯测”后填写样品数量，系统会自动建立对应数量的空标签杯测进程。 ");
  private review?: BatchReviewDialogHandle;
  private sequence = 0;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private startButton?: HTMLButtonElement;
  private captureActions?: HTMLElement;
  private cuppingModeButton?: HTMLButtonElement;
  private cuppingModeMenu?: HTMLElement;
  private cuppingMode: CuppingMode = "open";
  private importQueue?: ImportQueueState;
  private eventContext: Partial<CuppingSessionMetadata> = {};

  constructor(
    private readonly root: HTMLElement,
    private readonly service: CuppingSetupService,
    private readonly recognizer: SampleRecognitionService,
    private readonly options: BatchSetupRendererOptions
  ) {
    installCuppingTargetStyles();
    this.titleInput.type = "text";
    this.titleInput.placeholder = "杯测会名称（可选）";
    this.titleInput.addEventListener("change", () => void this.saveDraft());
    this.blindEntryNote.hidden = true;
  }

  async render(): Promise<void> {
    clearElement(this.root);
    clearElement(this.rowsRoot);
    this.root.classList.add("batch-setup");

    const header = element("header", "batch-setup__header");
    const copy = element("div", "batch-setup__header-copy");
    copy.append(element("h1", "batch-setup__heading", "AromaSense · 香迹 B0.2.a"));
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
    actions.setAttribute("aria-label", "录入方法");
    actions.append(
      button("batch-setup__capture", "拍摄录入", () => cameraInput.click()),
      button("batch-setup__capture", "批量识别", () => this.openBatchRecognitionMenu(galleryInput, spreadsheetInput, qrInput)),
      button("batch-setup__add", "手工录入", () => this.openManualText()),
      button("batch-setup__clear", "清空样品", () => void this.clearAllRows())
    );
    this.captureActions = actions;
    this.startButton = button("batch-setup__start", "开始杯测", () => this.submit());
    this.statusRoot.hidden = true;
    this.root.append(header, metadataForm, actions, this.blindEntryNote, cameraInput, galleryInput, spreadsheetInput, qrInput, this.rowsRoot, this.statusRoot, this.startButton);
    const recent = this.renderRecentSessions();
    if (recent) this.root.append(recent);
    await this.restoreDraft();
    this.applyCuppingModeUi();
    this.ensureEmptyHint();
  }

  private renderMetadataInput(key: keyof CuppingSessionMetadata, label: string, type: string, required: boolean, value = ""): HTMLLabelElement {
    const field = element("label", "batch-setup__session-meta-field");
    const caption = element("span", "batch-setup__session-meta-label", required ? `${label} *` : label);
    const input = element("input", "batch-setup__session-meta-input");
    input.type = type;
    input.required = required;
    input.value = value;
    input.addEventListener("change", () => {
      if (key === "eventName") this.titleInput.value = input.value;
      void this.saveDraft();
    });
    this.sessionInputs.set(key, input);
    field.append(caption, input);
    return field;
  }

  private renderCuppingModeField(): HTMLLabelElement {
    const field = element("label", "batch-setup__session-meta-field batch-setup__session-meta-field--target");
    const caption = element("span", "batch-setup__session-meta-label", "杯测目标");
    const shell = element("div", "batch-setup__target-shell");
    const trigger = button("batch-setup__target-button", cuppingModeLabel(this.cuppingMode), () => this.toggleCuppingModeMenu());
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    this.cuppingModeButton = trigger;
    const menu = element("div", "batch-setup__target-menu");
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    for (const mode of CUPPING_TARGET_OPTIONS) {
      const option = button(`batch-setup__target-option${mode === this.cuppingMode ? " is-selected" : ""}`, cuppingModeLabel(mode), () => this.setCuppingMode(mode));
      option.dataset.cuppingMode = mode;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(mode === this.cuppingMode));
      menu.append(option);
    }
    this.cuppingModeMenu = menu;
    const help = element("small", "batch-setup__target-help", "公开杯测为默认；盲测无需录入；半盲测保留现有录入流程，开始时再确认杯测数量。 ");
    shell.append(trigger, menu, help);
    field.append(caption, shell);
    return field;
  }

  private renderSessionMetadataForm(): HTMLElement {
    const defaults = defaultSessionMetadata(this.options.now());
    this.cuppingMode = "open";
    const section = element("section", "batch-setup__session-meta");
    section.append(element("h2", "batch-setup__session-meta-title", "本次杯测标注"));
    const grid = element("div", "batch-setup__session-meta-grid");
    grid.append(
      this.renderMetadataInput("date", "日期", "date", true, defaults.date),
      this.renderMetadataInput("time", "时间", "time", true, defaults.time),
      this.renderMetadataInput("organizer", "组织方", "text", true),
      this.renderMetadataInput("participants", "参与对象", "text", false),
      this.renderCuppingModeField(),
      this.renderMetadataInput("eventName", "杯测会名称", "text", false)
    );
    section.append(grid);
    return section;
  }

  private toggleCuppingModeMenu(): void {
    if (!this.cuppingModeMenu || !this.cuppingModeButton) return;
    const opening = this.cuppingModeMenu.hidden;
    this.cuppingModeMenu.hidden = !opening;
    this.cuppingModeButton.setAttribute("aria-expanded", String(opening));
    if (opening) {
      queueMicrotask(() => document.addEventListener("click", () => {
        if (this.cuppingModeMenu) this.cuppingModeMenu.hidden = true;
        this.cuppingModeButton?.setAttribute("aria-expanded", "false");
      }, { once: true }));
    }
  }

  private setCuppingMode(mode: CuppingMode, save = true): void {
    this.cuppingMode = mode;
    if (this.cuppingModeButton) this.cuppingModeButton.textContent = cuppingModeLabel(mode);
    if (this.cuppingModeMenu) {
      for (const option of this.cuppingModeMenu.querySelectorAll<HTMLButtonElement>("[data-cupping-mode]")) {
        const selected = option.dataset.cuppingMode === mode;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-selected", String(selected));
      }
      this.cuppingModeMenu.hidden = true;
    }
    this.applyCuppingModeUi();
    if (save) void this.saveDraft();
  }

  private applyCuppingModeUi(): void {
    const blind = this.cuppingMode === "blind";
    if (this.captureActions) this.captureActions.hidden = blind;
    this.rowsRoot.hidden = blind;
    this.blindEntryNote.hidden = !blind;
  }

  private resetSessionMetadata(): void {
    this.eventContext = {};
    const defaults = defaultSessionMetadata(this.options.now());
    for (const key of ["date", "time", "organizer", "participants", "eventName"] as const) {
      const input = this.sessionInputs.get(key);
      if (!input) continue;
      input.value = key === "date" ? defaults.date : key === "time" ? defaults.time : "";
    }
    this.titleInput.value = "";
    this.setCuppingMode("open", false);
  }

  private sessionMetadata(): CuppingSessionMetadata {
    return normalizeSessionMetadata({
      ...this.eventContext,
      date: this.sessionInputs.get("date")?.value,
      time: this.sessionInputs.get("time")?.value,
      organizer: this.sessionInputs.get("organizer")?.value,
      participants: this.sessionInputs.get("participants")?.value,
      eventName: this.sessionInputs.get("eventName")?.value || this.titleInput.value,
      cuppingMode: this.cuppingMode
    });
  }

  private applySessionMetadata(metadata: Partial<CuppingSessionMetadata>): void {
    this.eventContext = {
      eventId: metadata.eventId,
      eventRevision: metadata.eventRevision,
      lowPrecisionLocation: metadata.lowPrecisionLocation
    };
    for (const key of ["date", "time", "organizer", "participants", "eventName"] as const) {
      const input = this.sessionInputs.get(key);
      const value = metadata[key];
      if (input && typeof value === "string") input.value = value;
    }
    if (metadata.eventName) this.titleInput.value = metadata.eventName;
    this.setCuppingMode(cuppingTargetChoiceFromMetadata(metadata), false);
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
    openImportSourceDialog({
      root: this.root,
      allowPhotos: true,
      onPhotos: () => gallery.click(),
      onSpreadsheet: () => spreadsheet.click(),
      onLink: async (link) => this.importFromLink(link),
      onQr: () => this.scanQr(qr)
    });
  }

  private openImportMenu(): void {
    const spreadsheet = this.root.querySelector<HTMLInputElement>('input[data-import-spreadsheet="true"]');
    const qr = this.root.querySelector<HTMLInputElement>('input[data-import-qr="true"]');
    if (!spreadsheet || !qr) return;
    openImportSourceDialog({
      root: this.root,
      allowPhotos: false,
      onSpreadsheet: () => spreadsheet.click(),
      onLink: async (link) => this.importFromLink(link),
      onQr: () => this.scanQr(qr)
    });
  }

  private openManualText(): void {
    openManualTextImportDialog({
      root: this.root,
      onParse: async (text) => {
        const local = recognizeManualText(text);
        const bundle = this.options.foundationGateway
          ? await canonicalizeAndValidateImportBundle(local, this.options.foundationGateway)
          : local;
        const samples = bundle.sessions.flatMap((session) => session.samples);
        for (const sample of samples) this.addRow(sample.label, sample.metadata, {
          id: this.rowId(), status: "本地解析完成", requiresReview: sample.requiresReview, confirmed: !sample.requiresReview
        });
        await this.saveDraft();
        this.showStatus(`已自动导入 ${samples.length} 个样品${bundle.warnings.length ? ` · ${bundle.warnings.join("；")}` : ""}。`);
      }
    });
  }

  private async importSpreadsheetFiles(files: readonly File[]): Promise<void> {
    this.root.toggleAttribute("aria-busy", true);
    this.showStatus(`正在解析 ${files.length} 个表格/数据文件…`);
    try {
      const bundles: ImportBundle[] = [];
      for (let index = 0; index < files.length; index += 1) {
        this.showStatus(`正在解析表格 ${index + 1}/${files.length}：${files[index].name}`);
        bundles.push(await parseSpreadsheetFile(files[index]));
        await this.yieldToUi();
      }
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
      this.showStatus("当前环境不支持二维码图片解析，请使用链接导入。", true);
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
      const eventManifest = eventManifestFromSubmission(payload);
      if (eventManifest) await this.options.cacheEvent?.(eventManifest);
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
    const validation = record((this.metadata.get(row) ?? {}).inputValidation) as unknown as InputValidationResult | undefined;
    const marker = validation?.marker ?? (state.requiresReview && !state.confirmed ? "?" : "");
    main.append(element("small", `batch-setup__recognition-status${state.confirmed ? " is-confirmed" : state.requiresReview ? " is-review" : ""}`, `${marker ? `${marker} ` : ""}${state.confirmed ? "已确认" : "待确认"}${state.status ? ` · ${state.status}` : ""}`));
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

  private async clearAllRows(): Promise<void> {
    if (!this.rows().length) return;
    if (!window.confirm("一次性清空全部已录入样品？此操作不会删除已建立的历史杯测。")) return;
    this.review?.close(); this.review = undefined;
    clearElement(this.rowsRoot);
    this.importQueue = undefined;
    this.eventContext = {};
    await this.options.clearDraft?.();
    this.ensureEmptyHint();
    this.showStatus("已清空本次尚未建立的全部样品。");
  }

  private rows(): HTMLElement[] { return [...this.rowsRoot.querySelectorAll<HTMLElement>(".batch-setup__row")]; }
  private items(): BatchSetupDraftItem[] {
    return this.rows().flatMap((row) => {
      const state = this.state.get(row); if (!state) return [];
      return [{ id: state.id, label: row.querySelector<HTMLInputElement>(".batch-setup__sample-label")?.value ?? "", metadata: { ...(this.metadata.get(row) ?? {}) }, previewDataUrl: state.previewDataUrl, recognitionStatus: state.status, requiresReview: state.requiresReview, confirmed: state.confirmed }];
    });
  }

  private sampleDrafts(): SampleSetupDraft[] {
    return this.rows().flatMap((row) => {
      const label = row.querySelector<HTMLInputElement>(".batch-setup__sample-label")?.value.trim() ?? "";
      return label && !/^待确认样品\s+\d+$/u.test(label) ? [{ label, metadata: { ...(this.metadata.get(row) ?? {}) } }] : [];
    });
  }

  private async saveDraft(): Promise<void> {
    try {
      const items = this.items();
      if (!items.length) { await this.options.clearDraft?.(); return; }
      const sessionMetadata: Partial<CuppingSessionMetadata> = { ...this.eventContext, cuppingMode: this.cuppingMode };
      for (const key of ["date", "time", "organizer", "participants", "eventName"] as const) {
        const value = this.sessionInputs.get(key)?.value.trim(); if (value) sessionMetadata[key] = value;
      }
      await this.options.saveDraft?.({
        version: BATCH_SETUP_DRAFT_VERSION,
        title: this.titleInput.value,
        sessionMetadata,
        items,
        importQueue: this.importQueue ? {
          sessions: [...this.importQueue.sessions],
          index: this.importQueue.index,
          completed: this.importQueue.completed.map((group) => ({
            title: group.title,
            metadata: { ...group.metadata },
            samples: group.samples.flatMap((sample) => sample.label ? [{ label: sample.label, metadata: { ...sample.metadata } }] : [])
          })),
          sourceName: this.importQueue.sourceName
        } : undefined,
        updatedAt: this.options.now()
      });
    } catch (error) { this.showStatus(`本地暂存失败：${error instanceof Error ? error.message : String(error)}`, true); }
  }
  private scheduleSave(): void { if (this.saveTimer) clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => void this.saveDraft(), 250); }

  private async restoreDraft(): Promise<void> {
    try {
      const draft = normalizeBatchSetupDraft(await this.options.loadDraft?.()); if (!draft) return;
      this.titleInput.value = draft.title; this.applySessionMetadata(draft.sessionMetadata);
      if (draft.importQueue) {
        this.importQueue = {
          sessions: [...draft.importQueue.sessions],
          index: draft.importQueue.index,
          completed: draft.importQueue.completed.map((group) => ({
            title: group.title,
            metadata: { ...group.metadata },
            samples: group.samples.map((sample) => ({ label: sample.label, metadata: { ...sample.metadata } }))
          })),
          sourceName: draft.importQueue.sourceName
        };
      }
      for (const item of draft.items) this.addRow(item.label, item.metadata, { id: item.id, previewDataUrl: item.previewDataUrl, status: item.recognitionStatus, requiresReview: item.requiresReview, confirmed: item.confirmed });
      const counts = batchSetupDraftCounts(draft.items);
      if (this.importQueue && this.startButton) {
        const index = this.importQueue.index;
        const total = this.importQueue.sessions.length;
        this.startButton.textContent = index + 1 < total ? "保存本组并继续" : "完成批量导入";
        this.showStatus(`已恢复批量导入 ${index + 1}/${total}：${counts.confirmed}/${counts.total} 个样品已确认。`);
      } else {
        this.showStatus(counts.pending ? `已恢复上次录入：${counts.confirmed}/${counts.total} 已确认，剩余 ${counts.pending} 个。` : `已恢复 ${counts.total} 个已确认样品。`);
      }
    } catch (error) { this.showStatus(`恢复批量录入草稿失败：${error instanceof Error ? error.message : String(error)}`, true); }
  }

  private reviewFields(row: HTMLElement): BatchReviewField[] {
    const metadata = this.metadata.get(row) ?? {};
    return FIELD_SPECS.map(([key, labelText, group, kind, tier]) => ({ key, label: labelText, group, tier, value: String(metadata[key] ?? ""), candidates: candidates(metadata, key), confidence: confidence(metadata, key), multiline: kind === "multiline", date: kind === "date" }));
  }

  private applyReviewValue(row: HTMLElement, value: BatchReviewValue, markDirty: boolean, confirm: boolean): InputValidationResult | undefined {
    const state = this.state.get(row); if (!state) return;
    const metadata = { ...(this.metadata.get(row) ?? {}) };
    for (const [key] of FIELD_SPECS) delete metadata[key];
    for (const [key, fieldValue] of Object.entries(value.fields)) metadata[key] = fieldValue;
    const sample = canonicalizeSampleInput({ label: value.label, metadata, requiresReview: state.requiresReview }, this.options.foundationGateway, `sample:${this.rows().indexOf(row) + 1}`);
    const validation = validateSampleInput(sample);
    const accepted = confirm && validation.state !== "invalid";
    if (accepted) sample.metadata.recognition = { ...(record(metadata.recognition) ?? {}), userConfirmedFields: { ...value.fields }, confirmedAt: this.options.now() };
    this.metadata.set(row, sample.metadata);
    state.requiresReview = sample.requiresReview;
    const label = row.querySelector<HTMLInputElement>(".batch-setup__sample-label"); if (label) label.value = value.label;
    if (markDirty || validation.state === "invalid") state.confirmed = false;
    if (accepted) state.confirmed = true;
    this.refreshRow(row);
    return validation;
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
        const validation = this.applyReviewValue(row, value, false, true); await this.saveDraft();
        if (validation?.state === "invalid") return false;
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

  private async yieldToUi(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  private async addPhotoFiles(files: readonly File[]): Promise<void> {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) { this.showStatus("没有选择可识别的图片", true); return; }
    this.root.toggleAttribute("aria-busy", true);
    let count = 0;
    let failed = 0;
    try {
      for (let index = 0; index < images.length; index += 1) {
        const file = images[index];
        this.showStatus(`处理 ${index + 1}/${images.length}：${file.name} · 正在生成轻量预览`);
        let preview: string | undefined;
        try { preview = await compactImagePreview(file); }
        catch { preview = undefined; }
        await this.yieldToUi();

        this.showStatus(`识别 ${index + 1}/${images.length}：${file.name} · LuckyBean 正式识别核心`);
        try {
          const result = await this.recognizer.recognizePage(file, index);
          count += this.addRecognizedPage(result, preview ?? "");
          this.showStatus(`完成 ${index + 1}/${images.length}：${file.name} · ${result.samples.length} 个样品`);
        } catch (error) {
          failed += 1;
          const normalized = error instanceof Error ? error : new Error(String(error));
          this.addRow("", { recognition: { source: "photo", fileName: file.name, status: "failed", error: normalized.message } }, {
            id: this.rowId(), previewDataUrl: preview, status: `自动识别失败：${normalized.message}`, requiresReview: true, confirmed: false
          });
          count += 1;
          this.showStatus(`识别 ${index + 1}/${images.length} 失败：${file.name} · ${normalized.message}`, true);
        }

        await this.saveDraft();
        await this.yieldToUi();
        preview = undefined;
      }
      this.showStatus(`已逐张处理 ${images.length} 张图片，得到 ${count} 个样品${failed ? `，${failed} 张需要手工核对` : ""}。`);
      const pending = firstPendingItemIndex(this.items()); if (pending >= 0) { const row = this.rows()[pending]; if (row) this.openReview(row); }
    } catch (error) { this.showStatus(error instanceof Error ? error.message : String(error), true); }
    finally { this.root.toggleAttribute("aria-busy", false); this.renumber(); }
  }

  private renumber(): void { this.rows().forEach((row, index) => { const input = row.querySelector<HTMLInputElement>(".batch-setup__sample-label"); if (input) input.placeholder = `样品 ${index + 1}`; }); }
  private ensureEmptyHint(): void {
    if (this.cuppingMode === "blind") return;
    if (!this.rows().length && !this.rowsRoot.querySelector(".batch-setup__empty-hint")) this.rowsRoot.append(element("p", "batch-setup__empty-hint", "尚未添加样品。可使用拍摄录入、批量识别或手工录入。"));
  }

  private validateSessionMetadata(): CuppingSessionMetadata | undefined {
    try { return this.sessionMetadata(); }
    catch { this.showStatus("日期、时间和组织方为必填项。", true); return undefined; }
  }

  private validateCurrentGroup(): ConfirmedImportSession | undefined {
    const rows = this.rows();
    if (!rows.length) {
      this.showStatus(this.cuppingMode === "semi_blind" ? "半盲测需要先录入至少一个样品。" : "请先录入至少一个样品。", true);
      return undefined;
    }
    const invalid = rows.find((row) => validateSampleInput({ label: row.querySelector<HTMLInputElement>(".batch-setup__sample-label")?.value ?? "", metadata: this.metadata.get(row) ?? {} }).state === "invalid");
    if (invalid) { this.showStatus("请先修正样品名称或存在冲突的字段。", true); this.openReview(invalid); return undefined; }
    const pending = rows.filter((row) => this.state.get(row)?.confirmed !== true);
    if (pending.length) { this.showStatus(`仍有 ${pending.length} 个样品未确认。`, true); this.openReview(pending[0]); return undefined; }
    const samples = this.sampleDrafts();
    if (!samples.length || samples.length !== rows.length) { this.showStatus("所有已录入样品都必须确认有效名称；豆子资料字段允许留空。", true); return undefined; }
    const metadata = this.validateSessionMetadata();
    if (!metadata) return undefined;
    return { title: metadata.eventName || this.titleInput.value.trim() || undefined, metadata, samples };
  }

  private async createSession(group: ConfirmedImportSession, samples: readonly SampleSetupDraft[]): Promise<void> {
    this.root.toggleAttribute("aria-busy", true);
    try {
      const result = await this.service.create({
        sessionId: this.options.createSessionId(),
        title: group.title,
        metadata: group.metadata,
        samples,
        now: this.options.now(),
        sampleIdFactory: (index) => this.options.createSampleId(index)
      });
      await this.options.clearDraft?.();
      this.showStatus("");
      await this.options.onCreated(result.session.sessionId);
    } catch (error) {
      this.showStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      this.root.toggleAttribute("aria-busy", false);
    }
  }

  private openCountDialog(mode: "blind" | "semi_blind", group: ConfirmedImportSession): void {
    this.root.querySelector(".cupping-count-dialog")?.remove();
    const importedCount = mode === "semi_blind" ? group.samples.length : 0;
    const hiddenDraftRows = mode === "blind" ? this.rows().length : 0;
    const overlay = element("div", "cupping-count-dialog");
    const panel = element("section", "cupping-count-dialog__panel");
    const note = mode === "blind"
      ? `${hiddenDraftRows ? `当前暂存的 ${hiddenDraftRows} 个录入项不会带入本次盲测。` : ""}填写数量后，系统按数量建立空标签 Sample 与独立杯测进程。`
      : `已录入 ${importedCount} 个样品。杯测数量可以大于已录入数量，不足部分会建立空标签进程；数量不能小于已录入数量。`;
    panel.append(
      element("h2", "cupping-count-dialog__title", mode === "blind" ? "建立盲测" : "建立半盲测"),
      element("p", "cupping-count-dialog__note", note)
    );
    const field = element("label", "cupping-count-dialog__label");
    field.append(element("span", "", "杯测数量"));
    const input = element("input", "cupping-count-dialog__input");
    input.type = "number";
    input.min = String(mode === "semi_blind" ? Math.max(1, importedCount) : 1);
    input.max = "50";
    input.step = "1";
    input.inputMode = "numeric";
    input.value = String(mode === "semi_blind" ? Math.max(1, importedCount) : 6);
    field.append(input);
    const error = element("p", "cupping-count-dialog__error");
    const actions = element("div", "cupping-count-dialog__actions");
    actions.append(
      button("cupping-count-dialog__cancel", "取消", () => overlay.remove()),
      button("cupping-count-dialog__confirm", "开始杯测", () => void this.confirmCount(mode, group, Number(input.value), overlay, error))
    );
    panel.append(field, error, actions);
    overlay.append(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
    this.root.append(overlay);
    input.focus();
    input.select();
  }

  private async confirmCount(
    mode: "blind" | "semi_blind",
    group: ConfirmedImportSession,
    count: number,
    overlay: HTMLElement,
    error: HTMLElement
  ): Promise<void> {
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      error.textContent = "杯测数量必须是 1–50 的整数。";
      return;
    }
    if (mode === "semi_blind" && count < group.samples.length) {
      error.textContent = `已录入 ${group.samples.length} 个样品，杯测数量不能小于已录入数量。请先删除不参与样品，或提高杯测数量。`;
      return;
    }
    const samples = mode === "blind"
      ? [...buildEmptySampleDrafts(count)]
      : [
          ...group.samples,
          ...(count > group.samples.length ? buildEmptySampleDrafts(count - group.samples.length) : [])
        ];
    overlay.remove();
    await this.createSession(group, samples);
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

    if (this.cuppingMode === "blind") {
      const metadata = this.validateSessionMetadata();
      if (!metadata) return;
      const group: ConfirmedImportSession = {
        title: metadata.eventName || this.titleInput.value.trim() || undefined,
        metadata,
        samples: []
      };
      this.openCountDialog("blind", group);
      return;
    }

    const group = this.validateCurrentGroup();
    if (!group) return;
    if (this.cuppingMode === "semi_blind") {
      this.openCountDialog("semi_blind", group);
      return;
    }
    await this.createSession(group, group.samples);
  }

  private showStatus(text: string, error = false): void { this.statusRoot.textContent = text; this.statusRoot.classList.toggle("is-error", error); this.statusRoot.hidden = text.length === 0; }
}
