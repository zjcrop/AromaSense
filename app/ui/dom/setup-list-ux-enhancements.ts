import { BatchSetupRenderer as ReviewBatchSetupRenderer } from "./batch-setup-review-renderer";

interface RuntimeRowState {
  confirmed: boolean;
  requiresReview?: boolean;
  status?: string;
}

interface RuntimeBatchSetup {
  rows(): HTMLElement[];
  state: WeakMap<HTMLElement, RuntimeRowState>;
}

const INSTALL_KEY = "__aromasenseAutoAcceptListUxInstalled";

function cleanStatusText(value: string): string {
  return value
    .replace(/导入待确认/gu, "导入完成")
    .replace(/(?:已确认|待确认)\s*(?:·\s*)?/gu, "")
    .replace(/先逐一确认。?/gu, "可直接开始杯测；如需修正请点击标题。")
    .replace(/开始逐一确认。?/gu, "可直接开始杯测；如需修正请点击标题。")
    .replace(/个样品已确认/gu, "个样品")
    .replace(/已完成\s*\d+\s*个样品确认。?/gu, "样品列表已更新。")
    .replace(/\s+·\s*$/gu, "")
    .trim();
}

function normalizeRow(row: HTMLElement): void {
  row.classList.remove("is-pending-confirmation", "requires-review");
  row.classList.add("is-auto-accepted");

  const manualMark = row.querySelector<HTMLElement>(".batch-setup__manual-mark");
  if (manualMark) {
    manualMark.remove();
    row.classList.add("batch-setup__row--without-preview");
  }

  row.querySelector<HTMLElement>("[data-review]")?.remove();
  const label = row.querySelector<HTMLInputElement>(".batch-setup__sample-label");
  if (label) {
    label.title = "点击标题编辑样品信息";
    label.setAttribute("aria-label", `${label.value || label.placeholder || "样品"}，点击编辑`);
  }

  const status = row.querySelector<HTMLElement>(".batch-setup__recognition-status");
  if (status) {
    const next = cleanStatusText(status.textContent ?? "");
    if (next) {
      status.textContent = next;
      status.classList.remove("is-confirmed", "is-review");
    } else {
      status.remove();
    }
  }
}

function normalizeVisibleRows(root: ParentNode = document): void {
  for (const row of root.querySelectorAll<HTMLElement>(".batch-setup__row")) normalizeRow(row);
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-setup-list-ux]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseSetupListUx = "true";
  style.textContent = `
    .batch-setup__row.batch-setup__row--without-preview{
      grid-template-columns:minmax(0,1fr) auto!important;
    }
    .batch-setup__row.is-auto-accepted{
      border-color:rgba(185,153,90,.20)!important;
      background:#1b1b1b!important;
      box-shadow:none!important;
    }
    .batch-setup__row-actions{
      align-self:start!important;
    }
    .batch-setup__row-actions .batch-setup__remove{
      min-width:72px!important;
      min-height:38px!important;
      padding:8px 15px!important;
      border:0!important;
      border-radius:9px!important;
      background:#d6ad63!important;
      color:#111!important;
      font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;
      font-size:15px!important;
      line-height:1!important;
      font-weight:850!important;
      box-shadow:none!important;
      cursor:pointer!important;
    }
    .batch-setup__row-actions .batch-setup__remove:hover,
    .batch-setup__row-actions .batch-setup__remove:focus-visible{
      background:#e0bd78!important;
      outline:2px solid rgba(214,173,99,.24)!important;
      outline-offset:2px!important;
    }
    .batch-setup__sample-label[readonly]{
      cursor:pointer!important;
    }
    .is-rail-compact .cupping-rail-footer__actions,
    .is-rail-compact .cupping-progress-legend{
      display:none!important;
    }
    @media(max-width:520px){
      .batch-setup__row{grid-template-columns:68px minmax(0,1fr) auto!important;gap:8px!important}
      .batch-setup__row.batch-setup__row--without-preview{grid-template-columns:minmax(0,1fr) auto!important}
      .batch-setup__row-actions .batch-setup__remove{min-width:66px!important;font-size:14px!important}
    }
  `;
  document.head.append(style);
}

function installPrototypeBridge(): void {
  const prototype = ReviewBatchSetupRenderer.prototype as unknown as Record<string, unknown>;
  if (prototype[INSTALL_KEY]) return;
  prototype[INSTALL_KEY] = true;

  const runtimePrototype = prototype as unknown as {
    addRow: (label: string, metadata: Record<string, unknown>, state: RuntimeRowState) => HTMLElement;
    refreshRow: (row: HTMLElement) => void;
    validateCurrentGroup: (...args: unknown[]) => unknown;
    showStatus: (text: string, error?: boolean) => void;
  };

  const originalAddRow = runtimePrototype.addRow;
  runtimePrototype.addRow = function (this: RuntimeBatchSetup, label, metadata, state): HTMLElement {
    const row = originalAddRow.call(this, label, metadata, { ...state, confirmed: true });
    normalizeRow(row);
    return row;
  };

  const originalRefreshRow = runtimePrototype.refreshRow;
  runtimePrototype.refreshRow = function (this: RuntimeBatchSetup, row): void {
    const state = this.state.get(row);
    if (state) state.confirmed = true;
    originalRefreshRow.call(this, row);
    normalizeRow(row);
  };

  const originalValidateCurrentGroup = runtimePrototype.validateCurrentGroup;
  runtimePrototype.validateCurrentGroup = function (this: RuntimeBatchSetup, ...args: unknown[]): unknown {
    for (const row of this.rows()) {
      const state = this.state.get(row);
      if (state) state.confirmed = true;
    }
    return originalValidateCurrentGroup.apply(this, args);
  };

  const originalShowStatus = runtimePrototype.showStatus;
  runtimePrototype.showStatus = function (this: RuntimeBatchSetup, text: string, error = false): void {
    const normalized = error ? text : cleanStatusText(text);
    originalShowStatus.call(this, normalized, error);
  };
}

function renameRuntimeListEditor(root: ParentNode = document): void {
  for (const control of root.querySelectorAll<HTMLButtonElement>("[data-runtime-sample-manager]")) {
    if (control.textContent?.trim() !== "列表编辑") control.textContent = "列表编辑";
    control.title = "保存当前页面状态后，添加、删除或修改本次杯测列表";
    control.setAttribute("aria-label", "列表编辑");
  }
  for (const title of root.querySelectorAll<HTMLElement>(".free-cupping-manager__title")) {
    if (title.textContent?.includes("豆子管理")) title.textContent = title.textContent.replace("豆子管理", "列表编辑");
  }
}

function scan(): void {
  installStyles();
  normalizeVisibleRows();
  renameRuntimeListEditor();
}

installPrototypeBridge();
scan();
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
