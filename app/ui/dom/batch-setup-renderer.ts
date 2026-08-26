import { buildBlindPlaceholderSampleDrafts, cuppingTargetChoiceFromMetadata, resolveCuppingTarget, type CuppingTargetChoice } from "../../core/cupping-target";
import type { CuppingSetupService } from "../../core/cupping-setup-service";
import { normalizeSessionMetadata, type CuppingSessionMetadata } from "../../core/session-metadata";
import type { SampleRecognitionService } from "../../core/sample-recognition-service";
import { BatchSetupRenderer as BaseBatchSetupRenderer, type BatchSetupRendererOptions, type RecentSessionItem } from "./batch-setup-review-renderer";
import { button, element } from "./dom-helpers";

export type { BatchSetupRendererOptions, RecentSessionItem };

const TARGET_OPTIONS: readonly [CuppingTargetChoice, string][] = [
  ["blind", "盲测"],
  ["semi_blind", "半盲"],
  ["custom", "自定义"]
];

function installTargetStyles(): void {
  if (document.head.querySelector("style[data-aromasense-target-menu]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseTargetMenu = "true";
  style.textContent = `
    .batch-setup__target-shell{position:relative;display:grid;gap:6px}
    .batch-setup__target-button{width:100%;min-height:42px;border:1px solid rgba(185,153,90,.34);border-radius:9px;padding:8px 10px;background:#242424;color:#f4efe4;text-align:left;font:inherit}
    .batch-setup__target-button::after{content:'⌄';float:right;color:#b9995a}
    .batch-setup__target-menu{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:1300;overflow:hidden;border:1px solid #777;border-radius:9px;background:#fff;box-shadow:0 12px 30px rgba(0,0,0,.42)}
    .batch-setup__target-option{display:block;width:100%;min-height:40px;border:0;border-bottom:1px solid #ddd;padding:8px 11px;background:#fff;color:#111;text-align:left;font:inherit;cursor:pointer}
    .batch-setup__target-option:last-child{border-bottom:0}
    .batch-setup__target-option:hover,.batch-setup__target-option:focus-visible,.batch-setup__target-option.is-selected{background:#3b3b3b;color:#fff;outline:none}
    .batch-setup__target-custom{width:100%;min-height:42px;border:1px solid rgba(185,153,90,.34);border-radius:9px;padding:8px 10px;background:#242424;color:#f4efe4;font:inherit}
    .batch-setup__target-help{color:#928d84;font-size:10px;line-height:1.45}
    .batch-setup select{background:#fff;color:#111}
    .batch-setup select option{background:#fff;color:#111}
    .batch-setup select option:hover,.batch-setup select option:checked{background:#3b3b3b;color:#fff}
    .blind-count-dialog{position:fixed;inset:0;z-index:1600;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72);backdrop-filter:blur(5px)}
    .blind-count-dialog__panel{width:min(420px,100%);border:1px solid rgba(185,153,90,.36);border-radius:14px;padding:18px;background:#181818;color:#f4efe4;box-shadow:0 18px 48px rgba(0,0,0,.55)}
    .blind-count-dialog__title{margin:0 0 8px;font-size:18px}
    .blind-count-dialog__note{margin:0 0 14px;color:#aaa39a;font-size:12px;line-height:1.5}
    .blind-count-dialog__label{display:grid;gap:6px;color:#c6b58b;font-size:12px}
    .blind-count-dialog__select{width:100%;min-height:44px;border:1px solid rgba(185,153,90,.42);border-radius:9px;padding:8px 10px;background:#fff;color:#111;font:inherit}
    .blind-count-dialog__select option{background:#fff;color:#111}
    .blind-count-dialog__select option:hover,.blind-count-dialog__select option:checked{background:#3b3b3b;color:#fff}
    .blind-count-dialog__error{min-height:18px;margin:8px 0 0;color:#ef9e9e;font-size:11px}
    .blind-count-dialog__actions{display:grid;grid-template-columns:.7fr 1fr;gap:8px;margin-top:14px}
    .blind-count-dialog__cancel,.blind-count-dialog__confirm{min-height:42px;border-radius:9px;font-weight:700}
    .blind-count-dialog__cancel{border:1px solid rgba(185,153,90,.32);background:#222;color:#c9c0ae}
    .blind-count-dialog__confirm{border:1px solid #b9995a;background:#b9995a;color:#111}
  `;
  document.head.append(style);
}

function optionLabel(choice: CuppingTargetChoice): string {
  return TARGET_OPTIONS.find(([id]) => id === choice)?.[1] ?? "自定义";
}

export class BatchSetupRenderer {
  private readonly base: BaseBatchSetupRenderer;
  private targetChoice: CuppingTargetChoice = "custom";
  private originalTargetInput?: HTMLInputElement;
  private originalBlindSelect?: HTMLSelectElement;
  private customTargetInput?: HTMLInputElement;
  private targetButton?: HTMLButtonElement;
  private targetMenu?: HTMLElement;
  private bypassBlindStart = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly service: CuppingSetupService,
    recognizer: SampleRecognitionService,
    private readonly options: BatchSetupRendererOptions
  ) {
    this.base = new BaseBatchSetupRenderer(root, service, recognizer, options);
  }

  async render(): Promise<void> {
    installTargetStyles();
    await this.base.render();
    this.enhanceTargetField();
    this.interceptBlindStart();
  }

  private fieldByCaption(caption: string): HTMLLabelElement | undefined {
    return [...this.root.querySelectorAll<HTMLLabelElement>(".batch-setup__session-meta-field")]
      .find((field) => field.querySelector(".batch-setup__session-meta-label")?.textContent?.replace(" *", "").trim() === caption);
  }

  private valueByCaption(caption: string): string | undefined {
    const control = this.fieldByCaption(caption)?.querySelector<HTMLInputElement | HTMLSelectElement>("input,select");
    const value = control?.value.trim();
    return value || undefined;
  }

  private enhanceTargetField(): void {
    const targetField = this.fieldByCaption("测试目标");
    const blindField = this.fieldByCaption("盲测模式");
    const targetInput = targetField?.querySelector<HTMLInputElement>("input");
    const blindSelect = blindField?.querySelector<HTMLSelectElement>("select");
    if (!targetField || !targetInput || !blindField || !blindSelect) return;

    this.originalTargetInput = targetInput;
    this.originalBlindSelect = blindSelect;
    this.targetChoice = cuppingTargetChoiceFromMetadata({ blindMode: blindSelect.value as CuppingSessionMetadata["blindMode"] });

    targetInput.hidden = true;
    blindField.hidden = true;

    const caption = element("span", "batch-setup__session-meta-label", "测试目标");
    const shell = element("div", "batch-setup__target-shell");
    const selectButton = button("batch-setup__target-button", optionLabel(this.targetChoice), () => this.toggleTargetMenu());
    selectButton.type = "button";
    selectButton.setAttribute("aria-haspopup", "listbox");
    selectButton.setAttribute("aria-expanded", "false");
    this.targetButton = selectButton;

    const menu = element("div", "batch-setup__target-menu");
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    for (const [choice, label] of TARGET_OPTIONS) {
      const item = button(`batch-setup__target-option${choice === this.targetChoice ? " is-selected" : ""}`, label, () => this.selectTarget(choice));
      item.type = "button";
      item.dataset.targetChoice = choice;
      item.setAttribute("role", "option");
      menu.append(item);
    }
    this.targetMenu = menu;

    const custom = element("input", "batch-setup__target-custom");
    custom.type = "text";
    custom.placeholder = "填写自定义杯测目标（空缺可后续补充）";
    custom.value = this.targetChoice === "custom" ? targetInput.value : "";
    custom.hidden = this.targetChoice !== "custom";
    custom.addEventListener("change", () => this.applyTargetToBase());
    this.customTargetInput = custom;

    const help = element("small", "batch-setup__target-help", "盲测：可直接按数量生成匿名样品；半盲/自定义：保留现有拍照、批量识别和手工录入流程，空缺字段允许保留。 ");
    shell.append(selectButton, menu, custom, help, targetInput);
    targetField.replaceChildren(caption, shell);
    this.applyTargetToBase(false);
  }

  private toggleTargetMenu(): void {
    if (!this.targetMenu || !this.targetButton) return;
    const opening = this.targetMenu.hidden;
    this.targetMenu.hidden = !opening;
    this.targetButton.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) {
      queueMicrotask(() => document.addEventListener("click", () => {
        if (this.targetMenu) this.targetMenu.hidden = true;
        this.targetButton?.setAttribute("aria-expanded", "false");
      }, { once: true }));
    }
  }

  private selectTarget(choice: CuppingTargetChoice): void {
    this.targetChoice = choice;
    if (this.targetButton) this.targetButton.textContent = optionLabel(choice);
    if (this.targetMenu) {
      for (const item of this.targetMenu.querySelectorAll<HTMLButtonElement>("[data-target-choice]")) {
        item.classList.toggle("is-selected", item.dataset.targetChoice === choice);
      }
      this.targetMenu.hidden = true;
    }
    if (this.customTargetInput) this.customTargetInput.hidden = choice !== "custom";
    this.applyTargetToBase();
  }

  private applyTargetToBase(dispatch = true): void {
    if (!this.originalTargetInput || !this.originalBlindSelect) return;
    const resolved = resolveCuppingTarget(this.targetChoice, this.customTargetInput?.value);
    this.originalTargetInput.value = resolved.target ?? "";
    this.originalBlindSelect.value = resolved.blindMode;
    if (dispatch) {
      this.originalTargetInput.dispatchEvent(new Event("change", { bubbles: true }));
      this.originalBlindSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  private interceptBlindStart(): void {
    const start = this.root.querySelector<HTMLButtonElement>(".batch-setup__start");
    if (!start) return;
    start.addEventListener("click", (event) => {
      if (this.bypassBlindStart || this.targetChoice !== "blind") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.openBlindCountDialog(start);
    }, true);
  }

  private openBlindCountDialog(originalStart: HTMLButtonElement): void {
    this.root.querySelector(".blind-count-dialog")?.remove();
    const existingCount = this.root.querySelectorAll(".batch-setup__row").length;
    const overlay = element("div", "blind-count-dialog");
    const panel = element("section", "blind-count-dialog__panel");
    panel.append(
      element("h2", "blind-count-dialog__title", "选择盲测样品数量"),
      element("p", "blind-count-dialog__note", existingCount
        ? `当前已录入 ${existingCount} 个样品。数量必须与已录入样品一致，以保留其真实资料并在杯测过程中隐藏。`
        : "无需先导入豆卡。确认数量后将生成同等数量的匿名杯测进程；真实样品资料为空时不影响感官记录。")
    );
    const field = element("label", "blind-count-dialog__label");
    field.append(element("span", "", "样品数量"));
    const select = element("select", "blind-count-dialog__select");
    for (let count = 1; count <= 50; count += 1) {
      const option = element("option", "", `${count} 个`);
      option.value = String(count);
      if (count === (existingCount || 6)) option.selected = true;
      select.append(option);
    }
    field.append(select);
    const error = element("p", "blind-count-dialog__error");
    const actions = element("div", "blind-count-dialog__actions");
    actions.append(
      button("blind-count-dialog__cancel", "取消", () => overlay.remove()),
      button("blind-count-dialog__confirm", "生成并开始", () => void this.confirmBlindCount(Number(select.value), existingCount, originalStart, overlay, error))
    );
    panel.append(field, error, actions);
    overlay.append(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
    this.root.append(overlay);
  }

  private async confirmBlindCount(
    count: number,
    existingCount: number,
    originalStart: HTMLButtonElement,
    overlay: HTMLElement,
    error: HTMLElement
  ): Promise<void> {
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      error.textContent = "请选择 1–50 个样品。";
      return;
    }
    if (existingCount) {
      if (count !== existingCount) {
        error.textContent = `已录入 ${existingCount} 个样品，盲测数量必须保持一致。`;
        return;
      }
      overlay.remove();
      this.bypassBlindStart = true;
      try { originalStart.click(); }
      finally { this.bypassBlindStart = false; }
      return;
    }

    let metadata: CuppingSessionMetadata;
    try {
      const target = resolveCuppingTarget("blind");
      metadata = normalizeSessionMetadata({
        date: this.valueByCaption("日期"),
        time: this.valueByCaption("时间"),
        organizer: this.valueByCaption("组织方"),
        participants: this.valueByCaption("参与对象"),
        target: target.target,
        eventName: this.valueByCaption("杯测会名称"),
        blindMode: target.blindMode
      });
    } catch {
      error.textContent = "日期、时间和组织方为必填项。";
      return;
    }

    error.textContent = "";
    originalStart.disabled = true;
    try {
      const samples = buildBlindPlaceholderSampleDrafts(count);
      const result = await this.service.create({
        sessionId: this.options.createSessionId(),
        title: metadata.eventName,
        metadata,
        samples,
        now: this.options.now(),
        sampleIdFactory: (index) => this.options.createSampleId(index)
      });
      await this.options.clearDraft?.();
      overlay.remove();
      await this.options.onCreated(result.session.sessionId);
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      originalStart.disabled = false;
    }
  }
}
