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
    .batch-setup__cupping-type{display:grid;gap:6px;width:100%;padding:2px 0 0}
    .batch-setup__cupping-type-label{color:#918d86;font-size:11px;letter-spacing:.06em}
    .batch-setup__cupping-type-select{
      width:100%;min-height:45px;box-sizing:border-box;margin:0;padding:8px 28px 8px 2px;
      border:0;border-bottom:1px solid rgba(214,173,99,.24);border-radius:0;
      background:#151515;color:#f4f1eb;font:inherit;font-size:15px;outline:none;cursor:pointer;
    }
    .batch-setup__cupping-type-select:focus{border-bottom-color:#d6ad63}
    .batch-setup__cupping-type-select option{background:#171717;color:#f4f1eb}
  `;
  document.head.append(style);
}

/**
 * Thin compatibility layer over the existing home renderer. The old home UI is
 * preserved intact; only its three direct mode buttons are replaced by the new
 * four-mode `杯测类型` select. The nested base renderer remains the single
 * source of truth for draft persistence and blind/semi-blind flow switching.
 */
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
  }

  private modeHost(): BaseModeHost {
    return (this.home as unknown as HomeRendererInternals).base;
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
    // The preserved legacy renderer initializes a fresh form as `open`; the new product default is free.
    if (host.cuppingMode === "open") host.setCuppingMode("free", false);

    const wrapper = document.createElement("label");
    wrapper.className = "batch-setup__cupping-type";
    const caption = document.createElement("span");
    caption.className = "batch-setup__cupping-type-label";
    caption.textContent = "杯测类型";
    const select = document.createElement("select");
    select.className = "batch-setup__cupping-type-select";
    select.dataset.cuppingType = "true";
    select.setAttribute("aria-label", "杯测类型");
    for (const mode of CUPPING_MODES) select.append(new Option(cuppingModeLabel(mode), mode));

    const syncFromHost = (): void => {
      // If legacy import/reset code later writes `open`, it represents historical timed behavior.
      if (host.cuppingMode === "open") host.setCuppingMode("timed", false);
      const mode = normalizeCuppingMode(host.cuppingMode);
      if (select.value !== mode) select.value = mode;
    };
    syncFromHost();
    select.addEventListener("change", () => {
      const mode = normalizeCuppingMode(select.value);
      host.setCuppingMode(mode, true);
      select.value = mode;
    });
    wrapper.append(caption, select);
    shell.prepend(wrapper);

    this.modeObserver = new MutationObserver(() => syncFromHost());
    this.modeObserver.observe(shell, { childList: true, subtree: true, characterData: true, attributes: true });
  }
}
