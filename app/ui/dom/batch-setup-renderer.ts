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

const CUPPING_TARGET_LABELS: Readonly<Record<CuppingTargetValue, string>> = {
  open: "公开杯测",
  blind: "盲测",
  semi_blind: "半盲测"
};

function isCuppingTargetValue(value: string | undefined): value is CuppingTargetValue {
  return CUPPING_TARGET_VALUES.includes(value as CuppingTargetValue);
}

function installInlineFieldStyles(): void {
  if (document.head.querySelector("style[data-aromasense-inline-session-fields]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseInlineSessionFields = "true";
  style.textContent = `
    .batch-setup__session-meta-input::placeholder{color:#918d86;opacity:1}
    .batch-setup__target-direct{
      position:relative;z-index:8;isolation:isolate;
      display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
      width:100%;min-height:42px;box-sizing:border-box;
      border-bottom:1px solid rgba(214,173,99,.25);
      pointer-events:auto!important;touch-action:manipulation;
    }
    .batch-setup__target-choice{
      position:relative;z-index:9;appearance:none;-webkit-appearance:none;
      min-width:0;min-height:42px;margin:0;padding:7px 6px;
      border:0;background:transparent;color:#918d86;
      font:inherit;font-size:12px;cursor:pointer;
      pointer-events:auto!important;touch-action:manipulation;
    }
    .batch-setup__target-choice+ .batch-setup__target-choice{border-left:1px solid rgba(214,173,99,.10)}
    .batch-setup__target-choice.is-selected,
    .batch-setup__target-choice[aria-pressed="true"]{
      color:#f4f1eb;font-weight:800;background:rgba(214,173,99,.08)
    }
    .batch-setup__target-choice:focus-visible{outline:1px solid rgba(214,173,99,.65);outline-offset:-1px}
  `;
  document.head.append(style);
}

interface BaseModeSetter {
  setCuppingMode(mode: CuppingTargetValue, save?: boolean): void;
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
    this.installDirectCuppingTarget();
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

      // Do not keep interactive descendants inside the field's original label.
      // Android WebView can synthesize label activation and interfere with taps.
      const wrapper = document.createElement("div");
      wrapper.className = field.className;
      wrapper.dataset.sessionField = label;
      while (field.firstChild) wrapper.append(field.firstChild);
      field.replaceWith(wrapper);
    }
  }

  private setCanonicalCuppingMode(mode: CuppingTargetValue): void {
    // TypeScript private methods are normal prototype methods at runtime. Calling
    // the canonical setter directly avoids the old hidden-button .click() bridge
    // while keeping one source of truth for mode UI, validation and draft save.
    (this.base as unknown as BaseModeSetter).setCuppingMode(mode, true);
  }

  private installDirectCuppingTarget(): void {
    const targetField = this.root.querySelector<HTMLElement>('[data-session-field="杯测目标"]');
    const shell = targetField?.querySelector<HTMLElement>(".batch-setup__target-shell");
    const trigger = targetField?.querySelector<HTMLButtonElement>(".batch-setup__target-button");
    const menu = targetField?.querySelector<HTMLElement>(".batch-setup__target-menu");
    if (!targetField || !shell || !trigger || !menu) return;

    // A popup/dropdown is deliberately not used here. Repeated failures on
    // Android WebView showed that the popup activation path itself is not
    // reliable in this screen. Three direct choices have no open/close state.
    const group = document.createElement("div");
    group.className = "batch-setup__target-direct";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "杯测目标");

    const choices = new Map<CuppingTargetValue, HTMLButtonElement>();
    for (const mode of CUPPING_TARGET_VALUES) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "batch-setup__target-choice";
      choice.dataset.cuppingTarget = mode;
      choice.textContent = CUPPING_TARGET_LABELS[mode];
      choice.setAttribute("aria-pressed", "false");
      choice.addEventListener("pointerdown", (event) => {
        // Prevent focus/label synthesis from redirecting the activation. The
        // subsequent click still fires normally on the button itself.
        event.stopPropagation();
      });
      choice.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setCanonicalCuppingMode(mode);
        this.syncDirectCuppingTarget(menu, choices);
      });
      choices.set(mode, choice);
      group.append(choice);
    }

    // The legacy popup is retained only because the base renderer still owns
    // its state. It is completely removed from hit testing and accessibility.
    trigger.hidden = true;
    trigger.tabIndex = -1;
    trigger.setAttribute("aria-hidden", "true");
    trigger.style.display = "none";
    trigger.style.pointerEvents = "none";
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
    menu.style.display = "none";
    menu.style.pointerEvents = "none";

    shell.prepend(group);
    this.syncDirectCuppingTarget(menu, choices);

    // Import/reset/draft restore can change the base mode programmatically.
    // Observe its canonical selected state so the visible direct choices follow.
    this.targetObserver = new MutationObserver(() => this.syncDirectCuppingTarget(menu, choices));
    this.targetObserver.observe(menu, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected", "class"]
    });
  }

  private syncDirectCuppingTarget(
    menu: HTMLElement,
    choices: ReadonlyMap<CuppingTargetValue, HTMLButtonElement>
  ): void {
    const selected = [...menu.querySelectorAll<HTMLButtonElement>("[data-cupping-mode]")]
      .find((option) => option.getAttribute("aria-selected") === "true" || option.classList.contains("is-selected"));
    const value = selected?.dataset.cuppingMode;
    if (!isCuppingTargetValue(value)) return;
    for (const [mode, choice] of choices) {
      const active = mode === value;
      choice.classList.toggle("is-selected", active);
      choice.setAttribute("aria-pressed", String(active));
    }
  }
}
