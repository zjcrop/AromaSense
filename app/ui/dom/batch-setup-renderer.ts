import type { CuppingSetupService } from "../../core/cupping-setup-service";
import type { RecognizedPage, RecognizedSample, SampleRecognitionService } from "../../core/sample-recognition-service";
import { button, clearElement, element } from "./dom-helpers";

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
  recentSessions?: readonly RecentSessionItem[];
  syncLabel?: string;
}

const RECOGNITION_FIELDS: readonly [string, string][] = [
  ["country", "国家"],
  ["origin", "产地"],
  ["region", "产区"],
  ["farm", "庄园"],
  ["station", "处理站"],
  ["producer", "生产者"],
  ["cooperative", "合作社"],
  ["variety", "品种"],
  ["species", "种属"],
  ["process", "处理法"],
  ["altitude", "海拔"],
  ["roastDate", "烘焙日期"],
  ["harvest", "产季"],
  ["roaster", "烘焙商"],
  ["flavorNotes", "风味"]
];

interface ReviewCandidateLike {
  normalizedValue?: string;
  value?: string;
  score?: number;
}

interface ReviewDecisionLike {
  field?: string;
  value?: string;
  confidence?: number;
  candidates?: ReviewCandidateLike[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function fieldStorageKey(field: string): string {
  return field === "flavor" ? "flavorNotes" : field;
}

export class BatchSetupRenderer {
  private readonly rowsRoot = element("div", "batch-setup__rows");
  private readonly statusRoot = element("div", "batch-setup__status");
  private readonly titleInput = element("input", "batch-setup__title");
  private readonly rowMetadata = new WeakMap<HTMLElement, Record<string, unknown>>();
  private readonly previewUrls = new Set<string>();

  constructor(
    private readonly root: HTMLElement,
    private readonly service: CuppingSetupService,
    private readonly recognizer: SampleRecognitionService,
    private readonly options: BatchSetupRendererOptions
  ) {
    this.titleInput.type = "text";
    this.titleInput.placeholder = "杯测名称（可选）";
  }

  render(): void {
    clearElement(this.root);
    this.root.classList.add("batch-setup");
    const header = element("header", "batch-setup__header");
    const headerCopy = element("div", "batch-setup__header-copy");
    headerCopy.append(
      element("h1", "batch-setup__heading", "AromaSense · 香迹"),
      element("p", "batch-setup__hint", "批量拍照或相册识别样品；一张清单可拆分为多个样品。结构化字段确认后再进入杯测。")
    );
    const account = button("batch-setup__account", this.options.syncLabel ?? "账户 / 同步", () => this.options.onOpenAccount?.());
    header.append(headerCopy, account);

    const captureActions = element("section", "batch-setup__capture-actions");
    const camera = button("batch-setup__capture", "拍照录入", () => cameraInput.click());
    const gallery = button("batch-setup__capture", "批量相册识别", () => galleryInput.click());
    const add = button("batch-setup__add", "＋ 手工添加样品", () => this.addRow());
    captureActions.append(camera, gallery, add);

    const cameraInput = element("input", "batch-setup__file-input");
    cameraInput.type = "file";
    cameraInput.accept = "image/*";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.hidden = true;
    cameraInput.addEventListener("change", () => {
      const files = [...(cameraInput.files ?? [])];
      cameraInput.value = "";
      void this.addPhotoFiles(files);
    });

    const galleryInput = element("input", "batch-setup__file-input");
    galleryInput.type = "file";
    galleryInput.accept = "image/*";
    galleryInput.multiple = true;
    galleryInput.hidden = true;
    galleryInput.addEventListener("change", () => {
      const files = [...(galleryInput.files ?? [])];
      galleryInput.value = "";
      void this.addPhotoFiles(files);
    });

    const recent = this.renderRecentSessions();
    this.rowsRoot.append(element("p", "batch-setup__empty-hint", "尚未添加样品。可拍照、批量选择图片，或手工添加。"));
    const start = button("batch-setup__start", "开始杯测", () => this.submit());
    this.statusRoot.hidden = true;
    this.root.append(header, this.titleInput, captureActions, cameraInput, galleryInput, this.rowsRoot, this.statusRoot, start);
    if (recent) this.root.append(recent);
  }

  private renderRecentSessions(): HTMLElement | undefined {
    const sessions = this.options.recentSessions?.filter((item) => item.status === "draft" || item.status === "active") ?? [];
    if (!sessions.length || !this.options.onResume) return undefined;
    const section = element("section", "batch-setup__recent");
    section.append(element("h2", "batch-setup__recent-title", "继续未完成杯测"));
    for (const session of sessions.slice(0, 5)) {
      const row = element("button", "batch-setup__recent-item");
      row.type = "button";
      const name = session.title?.trim() || "未命名杯测";
      row.append(
        element("strong", "batch-setup__recent-name", name),
        element("span", "batch-setup__recent-meta", `${session.sampleCount} 个样品 · ${session.status === "active" ? "进行中" : "未开始"}`)
      );
      row.addEventListener("click", () => void this.options.onResume?.(session.sessionId));
      section.append(row);
    }
    return section;
  }

  private addRow(
    label = "",
    metadata: Record<string, unknown> = {},
    previewUrl?: string,
    recognitionStatus?: string,
    requiresReview = false
  ): HTMLElement {
    this.rowsRoot.querySelector(".batch-setup__empty-hint")?.remove();
    const row = element("article", `batch-setup__row${requiresReview ? " requires-review" : ""}`);
    this.rowMetadata.set(row, { ...metadata });

    if (previewUrl) {
      const image = element("img", "batch-setup__preview");
      image.src = previewUrl;
      image.alt = "样品来源图片预览";
      row.append(image);
    } else {
      row.classList.add("is-manual");
    }

    const main = element("div", "batch-setup__row-main");
    const input = element("input", "batch-setup__sample-label");
    input.type = "text";
    input.placeholder = `样品 ${this.rowsRoot.querySelectorAll(".batch-setup__row").length + 1}`;
    input.value = label;
    main.append(input);
    if (recognitionStatus) main.append(element("small", `batch-setup__recognition-status${requiresReview ? " is-review" : ""}`, recognitionStatus));
    this.renderStructuredFields(main, row);

    const remove = button("batch-setup__remove", "删除", () => {
      const preview = row.querySelector<HTMLImageElement>(".batch-setup__preview")?.src;
      if (preview?.startsWith("blob:")) {
        URL.revokeObjectURL(preview);
        this.previewUrls.delete(preview);
      }
      row.remove();
      this.renumberPlaceholders();
      this.ensureEmptyHint();
    });
    row.append(main, remove);
    this.rowsRoot.append(row);
    return row;
  }

  private renderStructuredFields(main: HTMLElement, row: HTMLElement): void {
    const metadata = this.rowMetadata.get(row) ?? {};
    const visible = RECOGNITION_FIELDS.filter(([key]) => typeof metadata[key] === "string" && String(metadata[key]).trim());
    const recognition = record(metadata.recognition);
    const review = Array.isArray(recognition?.review) ? recognition.review as ReviewDecisionLike[] : [];
    if (!visible.length && !review.length) return;

    const panel = element("div", "batch-setup__recognized-fields");
    for (const [key, label] of visible) {
      const field = element("label", "batch-setup__recognized-field");
      const caption = element("span", "batch-setup__recognized-label", label);
      const input = element("input", "batch-setup__recognized-input");
      input.type = "text";
      input.value = String(metadata[key] ?? "");
      input.addEventListener("change", () => {
        const current = this.rowMetadata.get(row) ?? {};
        this.rowMetadata.set(row, { ...current, [key]: input.value.trim() });
      });
      field.append(caption, input);
      panel.append(field);
    }

    for (const decision of review) {
      const fieldKey = String(decision.field ?? "");
      if (!fieldKey) continue;
      const storageKey = fieldStorageKey(fieldKey);
      const label = RECOGNITION_FIELDS.find(([key]) => key === storageKey)?.[1] ?? fieldKey;
      const reviewField = element("label", "batch-setup__recognized-field is-review");
      const caption = element("span", "batch-setup__recognized-label", `${label} · 待确认`);
      const select = element("select", "batch-setup__recognized-input");
      const blank = element("option", "", "不填写");
      blank.value = "";
      select.append(blank);
      const candidates = Array.isArray(decision.candidates) ? decision.candidates : [];
      const values = [...new Set(candidates.map((candidate) => String(candidate.normalizedValue ?? candidate.value ?? "").trim()).filter(Boolean))];
      for (const candidate of values) {
        const option = element("option", "", candidate);
        option.value = candidate;
        if (candidate === decision.value) option.selected = true;
        select.append(option);
      }
      select.addEventListener("change", () => {
        const current = this.rowMetadata.get(row) ?? {};
        const confirmed = { ...(record(record(current.recognition)?.userConfirmedFields) ?? {}) };
        if (select.value) confirmed[storageKey] = select.value;
        else delete confirmed[storageKey];
        const nextRecognition = { ...(record(current.recognition) ?? {}), userConfirmedFields: confirmed };
        this.rowMetadata.set(row, { ...current, [storageKey]: select.value || undefined, recognition: nextRecognition });
      });
      reviewField.append(caption, select);
      panel.append(reviewField);
    }
    main.append(panel);
  }

  private ensureEmptyHint(): void {
    if (this.rowsRoot.querySelector(".batch-setup__row") || this.rowsRoot.querySelector(".batch-setup__empty-hint")) return;
    this.rowsRoot.append(element("p", "batch-setup__empty-hint", "尚未添加样品。可拍照、批量选择图片，或手工添加。"));
  }

  private addRecognizedPage(file: File, page: RecognizedPage): number {
    page.samples.forEach((sample: RecognizedSample, sampleIndex) => {
      const previewUrl = URL.createObjectURL(file);
      this.previewUrls.add(previewUrl);
      const statusParts = [
        `${page.engine}`,
        page.samples.length > 1 ? `同图样品 ${sampleIndex + 1}/${page.samples.length}` : "单样品",
        `版面 ${page.layoutType}`,
        sample.requiresReview || page.requiresSegmentationReview ? "需要确认" : "字段已通过自动校验"
      ];
      this.addRow(sample.label, sample.metadata, previewUrl, statusParts.join(" · "), sample.requiresReview || page.requiresSegmentationReview);
    });
    return page.samples.length;
  }

  private async addPhotoFiles(files: readonly File[]): Promise<void> {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      this.showStatus("没有选择可识别的图片", true);
      return;
    }

    this.root.toggleAttribute("aria-busy", true);
    this.showStatus(`正在按顺序分析 ${images.length} 张图片：先恢复版面，再分割样品并甄别字段。`);
    try {
      const results = await this.recognizer.recognizeBatch(images, (progress) => {
        this.showStatus(`识别 ${progress.index}/${progress.total}：${progress.fileName}${progress.message ? ` · ${progress.message}` : ""}`,
          progress.status === "failed");
      });
      let sampleCount = 0;
      results.forEach((result, index) => {
        if (result instanceof Error) {
          const previewUrl = URL.createObjectURL(images[index]);
          this.previewUrls.add(previewUrl);
          this.addRow(
            "",
            { recognition: { source: "photo", fileName: images[index].name, status: "failed", error: result.message } },
            previewUrl,
            `自动识别失败：${result.message} · 请手工填写`,
            true
          );
          return;
        }
        sampleCount += this.addRecognizedPage(images[index], result);
      });
      this.showStatus(`已分析 ${images.length} 张图片，得到 ${sampleCount} 个候选样品。请逐项核对，橙色提示项需要人工确认。`);
    } catch (error) {
      this.showStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      this.root.toggleAttribute("aria-busy", false);
      this.renumberPlaceholders();
    }
  }

  private renumberPlaceholders(): void {
    [...this.rowsRoot.querySelectorAll<HTMLInputElement>(".batch-setup__sample-label")]
      .forEach((input, index) => { input.placeholder = `样品 ${index + 1}`; });
  }

  private async submit(): Promise<void> {
    const rows = [...this.rowsRoot.querySelectorAll<HTMLElement>(".batch-setup__row")];
    const samples = rows.flatMap((row) => {
      const input = row.querySelector<HTMLInputElement>(".batch-setup__sample-label");
      const label = input?.value.trim() ?? "";
      if (!label || /^待确认样品\s+\d+$/u.test(label)) return [];
      return [{ label, metadata: { ...(this.rowMetadata.get(row) ?? {}) } }];
    });
    if (samples.length === 0) {
      this.showStatus("至少需要一个已确认名称的有效样品；“待确认样品”必须先核对并命名。", true);
      return;
    }
    const unresolved = rows.filter((row) => {
      const label = row.querySelector<HTMLInputElement>(".batch-setup__sample-label")?.value.trim() ?? "";
      return label && /^待确认样品\s+\d+$/u.test(label);
    }).length;
    if (unresolved > 0) {
      this.showStatus(`仍有 ${unresolved} 个样品名称未确认，请先修正或删除后再开始杯测。`, true);
      return;
    }

    this.root.toggleAttribute("aria-busy", true);
    try {
      const sessionId = this.options.createSessionId();
      const result = await this.service.create({
        sessionId,
        title: this.titleInput.value.trim() || undefined,
        samples,
        now: this.options.now(),
        sampleIdFactory: (index) => this.options.createSampleId(index)
      });
      this.showStatus("");
      await this.options.onCreated(result.session.sessionId);
    } catch (error) {
      this.showStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      this.root.toggleAttribute("aria-busy", false);
    }
  }

  private showStatus(text: string, error = false): void {
    this.statusRoot.textContent = text;
    this.statusRoot.classList.toggle("is-error", error);
    this.statusRoot.hidden = text.length === 0;
  }
}
