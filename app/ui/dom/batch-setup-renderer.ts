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

const CUPPING_TARGET_VALUES = ["open", "blind", "semi_blind"] as const;
type CuppingTargetValue = typeof CUPPING_TARGET_VALUES[number];

function isCuppingTargetValue(value: string | undefined): value is CuppingTargetValue {
  return CUPPING_TARGET_VALUES.includes(value as CuppingTargetValue);
}

function installInlineFieldStyles(): void {
  if (document.head.querySelector("style[data-aromasense-inline-session-fields]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseInlineSessionFields = "true";
  style.textContent = `
    .batch-setup__session-meta-input::placeholder{color:#918d86;opacity:1}
    .batch-setup__target-native{
      width:100%;min-height:42px;box-sizing:border-box;
      border:0;border-bottom:1px solid rgba(214,173,99,.25);border-radius:0;
      outline:none;background:#181818;color:#f4f1eb;padding:7px 28px 7px 0;
      font:inherit;cursor:pointer;appearance:auto;-webkit-appearance:menulist;
    }
    .batch-setup__target-native:focus{border-bottom-color:#d6ad63}
    .batch-setup__target-native option{background:#fff;color:#111}
  `;
  document.head.append(style);
}

export class BatchSetupRenderer {
  private readonly base: BaseBatchSetupRenderer;
  private targetObserver?: MutationObserver;

  constructor(
    private readonly root: HTMLElement,
    service: CuppingSetupService,
    recognizer: SampleRecognitionService,
    options: BatchSetupRendererOptions
  ) {
    installInlineFieldStyles();
    this.base = new BaseBatchSetupRenderer(root, service, recognizer, options);
  }

  async render(): Promise<void> {
    this.targetObserver?.disconnect();
    this.targetObserver = undefined;
    await this.base.render();
    this.flattenSessionMetadataFields();
    this.installNativeCuppingTarget();
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

      // Interactive controls must not remain nested in <label>; WebView can
      // synthesize a second activation for descendants of a label element.
      const wrapper = document.createElement("div");
      wrapper.className = field.className;
      wrapper.dataset.sessionField = label;
      while (field.firstChild) wrapper.append(field.firstChild);
      field.replaceWith(wrapper);
    }
  }

  private installNativeCuppingTarget(): void {
    const targetField = this.root.querySelector<HTMLElement>('[data-session-field="杯测目标"]');
    const shell = targetField?.querySelector<HTMLElement>(".batch-setup__target-shell");
    const trigger = targetField?.querySelector<HTMLButtonElement>(".batch-setup__target-button");
    const menu = targetField?.querySelector<HTMLElement>(".batch-setup__target-menu");
    if (!targetField || !shell || !trigger || !menu) return;

    const select = document.createElement("select");
    select.className = "batch-setup__target-native";
    select.setAttribute("aria-label", "杯测目标");
    select.title = "杯测目标";

    for (const mode of CUPPING_TARGET_VALUES) {
      const source = menu.querySelector<HTMLButtonElement>(`[data-cupping-mode="${mode}"]`);
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = source?.textContent?.trim() || (mode === "open" ? "公开杯测" : mode === "blind" ? "盲测" : "半盲测");
      select.append(option);
    }

    const syncFromBase = (): void => {
      const selected = [...menu.querySelectorAll<HTMLButtonElement>("[data-cupping-mode]")]
        .find((option) => option.getAttribute("aria-selected") === "true" || option.classList.contains("is-selected"));
      const value = selected?.dataset.cuppingMode;
      if (isCuppingTargetValue(value) && select.value !== value) select.value = value;
    };

    select.addEventListener("change", () => {
      const value = select.value;
      if (!isCuppingTargetValue(value)) return;
      const source = menu.querySelector<HTMLButtonElement>(`[data-cupping-mode="${value}"]`);
      // Reuse the base renderer's canonical setter through its existing option
      // callback so mode-specific UI, draft persistence and validation remain
      // on the same code path as before.
      source?.click();
      syncFromBase();
    });

    // Retain the base controls only as an internal state bridge. They are no
    // longer part of hit testing or keyboard navigation, removing the custom
    // document-click menu path that proved unreliable in Android WebView.
    trigger.hidden = true;
    trigger.tabIndex = -1;
    trigger.setAttribute("aria-hidden", "true");
    trigger.style.display = "none";
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
    menu.style.display = "none";

    shell.prepend(select);
    syncFromBase();

    this.targetObserver = new MutationObserver(syncFromBase);
    this.targetObserver.observe(menu, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected", "class"]
    });
  }
}
