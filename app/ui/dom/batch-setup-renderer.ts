import type { CuppingSetupService } from "../../core/cupping-setup-service";
import type { SampleRecognitionService } from "../../core/sample-recognition-service";
import {
  CUPPING_MODES,
  cuppingModeLabel,
  normalizeCuppingMode,
  type CuppingMode
} from "../../core/session-metadata";
import {
  BatchSetupRenderer as HomeBatchSetupRenderer,
  type BatchSetupRendererOptions,
  type RecentSessionItem
} from "./batch-setup-home-renderer";
import { ensureLongOperationProgress } from "./long-operation-progress";

export type { BatchSetupRendererOptions, RecentSessionItem };

interface BaseModeHost {
  cuppingMode: CuppingMode;
  setCuppingMode(mode: CuppingMode, save?: boolean): void;
}

interface HomeRendererInternals {
  base: BaseModeHost;
}

function installModeSelectStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cupping-type-select]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCuppingTypeSelect = "true";
  style.textContent = `
    .batch-setup__target-direct{display:none!important}
    .batch-setup__target-help{display:none!important}
    .batch-setup__cupping-type{display:block;width:100%;padding:2px 0 0}
    .batch-setup__cupping-type-select{
      width:100%;min-height:45px;box-sizing:border-box;margin:0;padding:8px 28px;
      border:0;border-bottom:1px solid rgba(214,173,99,.24);border-radius:0;
      background:#151515;color:#f4f1eb;font:inherit;font-size:15px;outline:none;cursor:pointer;
      text-align:center;text-align-last:center;
    }
    .batch-setup__cupping-type-select:focus{border-bottom-color:#d6ad63}
    .batch-setup__cupping-type-select option{background:#171717;color:#f4f1eb;text-align:center}
  `;
  document.head.append(style);
}

export class BatchSetupRenderer {
  private readonly home: HomeBatchSetupRenderer;
  private modeObserver?: MutationObserver;

  constructor(
    private readonly root: HTMLElement,
    service: CuppingSetupService,
    recognizer: SampleRecognitionService,
    options: BatchSetupRendererOptions
  ) {
    installModeSelectStyles();
    ensureLongOperationProgress(root);
    this.home = new HomeBatchSetupRenderer(root, service, recognizer, options);
  }

  async render(): Promise<void> {
    this.modeObserver?.disconnect();
    this.modeObserver = undefined;
    await this.home.render();
    this.installCuppingTypeSelect();
    this.installOptionalOrganizerDefault();
  }

  private modeHost(): BaseModeHost {
    return (this.home as unknown as HomeRendererInternals).base;
  }

  private installOptionalOrganizerDefault(): void {
    const field = this.root.querySelector<HTMLElement>('[data-session-field="组织方"]');
    const input = field?.querySelector<HTMLInputElement>(".batch-setup__session-meta-input");
    const start = this.root.querySelector<HTMLButtonElement>(".batch-setup__start");
    if (!input) return;
    input.required = false;
    input.removeAttribute("aria-required");
    input.placeholder = "组织方（不填默认为自己）";
    input.title = "组织方（可选；不填默认为自己）";
    const applyDefault = (): void => {
      if (!input.value.trim()) input.value = "自己";
    };
    if (start && start.dataset.organizerDefaultGuard !== "true") {
      start.dataset.organizerDefaultGuard = "true";
      start.addEventListener("click", applyDefault, { capture: true });
      start.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") applyDefault();
      }, { capture: true });
    }
  }

  private installCuppingTypeSelect(): void {
    const targetField = this.root.querySelector<HTMLElement>('[data-session-field="杯测目标"]')
      ?? this.root.querySelector<HTMLElement>('[data-session-field="杯测类型"]');
    const shell = targetField?.querySelector<HTMLElement>(".batch-setup__target-shell");
    if (!targetField || !shell) return;

    targetField.dataset.sessionField = "杯测类型";
    shell.querySelector(".batch-setup__cupping-type")?.remove();
    shell.querySelector<HTMLElement>(".batch-setup__target-help")?.remove();
    shell.querySelector<HTMLElement>(".batch-setup__target-direct")?.remove();

    const host = this.modeHost();
    if (host.cuppingMode === "open") host.setCuppingMode("formal", false);

    const wrapper = document.createElement("label");
    wrapper.className = "batch-setup__cupping-type";
    const select = document.createElement("select");
    select.className = "batch-setup__cupping-type-select";
    select.dataset.cuppingType = "true";
    select.setAttribute("aria-label", "杯测类型");
    for (const mode of CUPPING_MODES) select.append(new Option(cuppingModeLabel(mode), mode));

    const syncFromHost = (): void => {
      if (host.cuppingMode === "open") host.setCuppingMode("formal", false);
      const mode = normalizeCuppingMode(host.cuppingMode);
      if (select.value !== mode) select.value = mode;
    };
    syncFromHost();
    select.addEventListener("change", () => {
      const mode = normalizeCuppingMode(select.value);
      host.setCuppingMode(mode, true);
      select.value = mode;
    });
    wrapper.append(select);
    shell.prepend(wrapper);

    this.modeObserver = new MutationObserver(() => syncFromHost());
    this.modeObserver.observe(shell, { childList: true, subtree: true, characterData: true, attributes: true });
  }
}
