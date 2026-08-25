import type { CuppingSetupService } from "../../core/cupping-setup-service";
import type { SampleRecognitionService } from "../../core/sample-recognition-service";
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
      element("p", "batch-setup__hint", "批量拍照或相册识别样品，确认名称后自动编号；也可直接手工建立。")
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
    const emptyHint = element("p", "batch-setup__empty-hint", "尚未添加样品。可拍照、批量选择图片，或手工添加。 ");
    this.rowsRoot.append(emptyHint);
    const start = button("batch-setup__start", "开始杯测", () => this.submit());
    this.statusRoot.hidden = true;
    this.root.append(
      header,
      this.titleInput,
      captureActions,
      cameraInput,
      galleryInput,
      this.rowsRoot,
      this.statusRoot,
      start
    );
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
    recognitionStatus?: string
  ): HTMLElement {
    this.rowsRoot.querySelector(".batch-setup__empty-hint")?.remove();
    const row = element("article", "batch-setup__row");
    this.rowMetadata.set(row, { ...metadata });

    if (previewUrl) {
      const image = element("img", "batch-setup__preview");
      image.src = previewUrl;
      image.alt = "样品照片预览";
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
    if (recognitionStatus) main.append(element("small", "batch-setup__recognition-status", recognitionStatus));

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

  private ensureEmptyHint(): void {
    if (this.rowsRoot.querySelector(".batch-setup__row") || this.rowsRoot.querySelector(".batch-setup__empty-hint")) return;
    this.rowsRoot.append(element("p", "batch-setup__empty-hint", "尚未添加样品。可拍照、批量选择图片，或手工添加。"));
  }

  private async addPhotoFiles(files: readonly File[]): Promise<void> {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      this.showStatus("没有选择可识别的图片", true);
      return;
    }

    const rows = images.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      this.previewUrls.add(previewUrl);
      return this.addRow(
        "",
        { recognition: { source: "photo", fileName: file.name, status: "processing" } },
        previewUrl,
        "等待识别…"
      );
    });

    this.root.toggleAttribute("aria-busy", true);
    this.showStatus(`正在按顺序识别 ${images.length} 张图片；识别结果需确认后才建立样品。`);
    try {
      const results = await this.recognizer.recognizeBatch(images, (progress) => {
        this.showStatus(`识别 ${progress.index}/${progress.total}：${progress.fileName}${progress.status === "failed" ? ` · ${progress.message ?? "失败"}` : ""}`,
          progress.status === "failed");
      });
      results.forEach((result, index) => {
        const row = rows[index];
        const status = row.querySelector<HTMLElement>(".batch-setup__recognition-status");
        const input = row.querySelector<HTMLInputElement>(".batch-setup__sample-label");
        if (result instanceof Error) {
          if (status) status.textContent = `自动识别失败：${result.message} · 请手工填写`;
          const current = this.rowMetadata.get(row) ?? {};
          this.rowMetadata.set(row, {
            ...current,
            recognition: { source: "photo", fileName: images[index].name, status: "failed", error: result.message }
          });
          return;
        }
        if (input) input.value = result.label;
        if (status) status.textContent = `${result.engine} · 已识别，请核对`;
        this.rowMetadata.set(row, result.metadata);
      });
      this.showStatus(`已处理 ${images.length} 张图片。请核对结构化识别结果后再开始杯测。`);
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
      if (!label) return [];
      return [{
        label,
        metadata: { ...(this.rowMetadata.get(row) ?? {}) }
      }];
    });
    if (samples.length === 0) {
      this.showStatus("至少需要一个已确认名称的有效样品", true);
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
