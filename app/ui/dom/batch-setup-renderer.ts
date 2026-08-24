import type { CuppingSetupService } from "../../core/cupping-setup-service";
import { button, clearElement, element } from "./dom-helpers";

export interface BatchSetupRendererOptions {
  now(): string;
  createSessionId(): string;
  createSampleId(index: number): string;
  onCreated(sessionId: string): void | Promise<void>;
}

export class BatchSetupRenderer {
  private readonly rowsRoot = element("div", "batch-setup__rows");
  private readonly statusRoot = element("div", "batch-setup__status");
  private readonly titleInput = element("input", "batch-setup__title");

  constructor(
    private readonly root: HTMLElement,
    private readonly service: CuppingSetupService,
    private readonly options: BatchSetupRendererOptions
  ) {
    this.titleInput.type = "text";
    this.titleInput.placeholder = "杯测名称（可选）";
  }

  render(): void {
    clearElement(this.root);
    this.root.classList.add("batch-setup");
    const header = element("header", "batch-setup__header");
    header.append(
      element("h1", "batch-setup__heading", "新建杯测"),
      element("p", "batch-setup__hint", "批量建立样品后自动编号，可在杯测页面继续拖动排序。")
    );

    const add = button("batch-setup__add", "＋ 添加样品", () => this.addRow());
    const start = button("batch-setup__start", "开始杯测", () => this.submit());
    this.statusRoot.hidden = true;
    this.root.append(header, this.titleInput, this.rowsRoot, add, this.statusRoot, start);
    this.addRow();
    this.addRow();
    this.addRow();
  }

  private addRow(label = ""): void {
    const row = element("div", "batch-setup__row");
    const input = element("input", "batch-setup__sample-label");
    input.type = "text";
    input.placeholder = `样品 ${this.rowsRoot.children.length + 1}`;
    input.value = label;
    const remove = button("batch-setup__remove", "删除", () => {
      row.remove();
      this.renumberPlaceholders();
    });
    row.append(input, remove);
    this.rowsRoot.append(row);
  }

  private renumberPlaceholders(): void {
    [...this.rowsRoot.querySelectorAll<HTMLInputElement>(".batch-setup__sample-label")]
      .forEach((input, index) => { input.placeholder = `样品 ${index + 1}`; });
  }

  private async submit(): Promise<void> {
    const inputs = [...this.rowsRoot.querySelectorAll<HTMLInputElement>(".batch-setup__sample-label")];
    const samples = inputs.map((input) => ({ label: input.value.trim() || undefined }));
    if (samples.length === 0) {
      this.showStatus("至少需要一个样品", true);
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
