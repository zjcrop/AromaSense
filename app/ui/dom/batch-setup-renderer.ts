import type { CuppingSetupService } from "../../core/cupping-setup-service";
import type { SampleRecognitionService } from "../../core/sample-recognition-service";
import {
  BatchSetupRenderer as BaseBatchSetupRenderer,
  type BatchSetupRendererOptions,
  type RecentSessionItem
} from "./batch-setup-review-renderer";

export type { BatchSetupRendererOptions, RecentSessionItem };

const PLACEHOLDERS: Readonly<Record<string, string>> = {
  日期: "日期",
  时间: "时间",
  组织方: "组织方 *",
  参与对象: "参与对象",
  杯测会名称: "杯测会名称"
};

export class BatchSetupRenderer {
  private readonly base: BaseBatchSetupRenderer;

  constructor(
    private readonly root: HTMLElement,
    service: CuppingSetupService,
    recognizer: SampleRecognitionService,
    options: BatchSetupRendererOptions
  ) {
    this.base = new BaseBatchSetupRenderer(root, service, recognizer, options);
  }

  async render(): Promise<void> {
    await this.base.render();
    this.flattenSessionMetadataFields();
    this.fixCuppingTargetMenu();
  }

  private flattenSessionMetadataFields(): void {
    for (const field of [...this.root.querySelectorAll<HTMLLabelElement>(".batch-setup__session-meta-field")]) {
      const caption = field.querySelector<HTMLElement>(".batch-setup__session-meta-label");
      const label = caption?.textContent?.replace(" *", "").trim() ?? "";
      const input = field.querySelector<HTMLInputElement>(".batch-setup__session-meta-input");

      if (input && PLACEHOLDERS[label]) {
        input.placeholder = PLACEHOLDERS[label];
        input.setAttribute("aria-label", label);
        input.title = label;
      }

      caption?.remove();

      // A button nested in <label> can receive synthetic label activation on
      // WebView/browser engines. Convert the visual field wrapper to a neutral
      // div once every control has its own accessible name.
      const wrapper = document.createElement("div");
      wrapper.className = field.className;
      wrapper.dataset.sessionField = label;
      while (field.firstChild) wrapper.append(field.firstChild);
      field.replaceWith(wrapper);
    }
  }

  private fixCuppingTargetMenu(): void {
    const targetField = this.root.querySelector<HTMLElement>('[data-session-field="杯测目标"]');
    const trigger = targetField?.querySelector<HTMLButtonElement>(".batch-setup__target-button");
    const menu = targetField?.querySelector<HTMLElement>(".batch-setup__target-menu");
    if (!targetField || !trigger || !menu) return;

    const syncTriggerCopy = (): void => {
      const selected = menu.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      const value = selected?.textContent?.trim() || trigger.textContent?.replace(/^杯测目标\s*·\s*/u, "").trim() || "公开杯测";
      trigger.textContent = `杯测目标 · ${value}`;
      trigger.setAttribute("aria-label", `杯测目标，当前${value}`);
    };

    // Stop the base renderer's document-level one-shot close listener from
    // seeing the same activation that opens the menu.
    trigger.addEventListener("click", (event) => event.stopPropagation(), { capture: true });
    menu.addEventListener("click", (event) => event.stopPropagation());

    for (const option of menu.querySelectorAll<HTMLButtonElement>(".batch-setup__target-option")) {
      option.addEventListener("click", () => queueMicrotask(syncTriggerCopy));
    }

    syncTriggerCopy();
  }
}
