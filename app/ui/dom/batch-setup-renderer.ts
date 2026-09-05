import type { CuppingSetupService } from "../../core/cupping-setup-service";
import type { SampleRecognitionService } from "../../core/sample-recognition-service";
import {
  BatchSetupRenderer as BaseBatchSetupRenderer,
  type BatchSetupRendererOptions as BaseBatchSetupRendererOptions,
  type RecentSessionItem
} from "./batch-setup-review-renderer";
import { SegmentationReviewRecognitionService } from "./segmentation-review-recognizer";

export interface BatchSetupRendererOptions extends BaseBatchSetupRendererOptions {
  onOpenRecent?(sessionId: string, readOnly: boolean): void | Promise<void>;
}

export type { RecentSessionItem };

const PLACEHOLDERS: Readonly<Record<string, string>> = {
  日期: "日期",
  时间: "时间",
  组织方: "组织方 *",
  参与对象: "参与对象",
  杯测会名称: "杯测会名称"
};

const CUPPING_TARGET_VALUES = ["open", "blind", "semi_blind"] as const;
type CuppingTargetValue = typeof CUPPING_TARGET_VALUES[number];
type RecordScope = "unfinished" | "completed";

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
    .batch-setup__target-choice+.batch-setup__target-choice{border-left:1px solid rgba(214,173,99,.10)}
    .batch-setup__target-choice.is-selected,
    .batch-setup__target-choice[aria-pressed="true"]{
      color:#f4f1eb;font-weight:800;background:rgba(214,173,99,.08)
    }
    .batch-setup__target-choice:focus-visible{outline:1px solid rgba(214,173,99,.65);outline-offset:-1px}
  `;
  document.head.append(style);
}

function installHomeStyles(): void {
  document.head.querySelector("style[data-aromasense-home-chrome]")?.remove();
  const style = document.createElement("style");
  style.dataset.aromasenseHomeChrome = "true";
  style.textContent = `
    .batch-setup{max-width:760px!important;padding-top:28px!important}
    .batch-setup__header{
      display:grid!important;justify-items:center!important;align-items:center!important;
      gap:13px!important;margin:0 0 30px!important;padding:8px 0 2px!important;text-align:center!important;
    }
    .batch-setup__header-copy{width:auto!important;justify-self:center!important;text-align:center!important}
    .batch-setup__brand{display:grid;gap:8px;justify-items:center}
    .batch-setup__brand-zh{
      order:1;margin:0;color:#d6ad63;font-family:"Noto Serif SC","Songti SC",STSong,serif;
      font-size:34px;line-height:1.08;font-weight:580;letter-spacing:.30em;text-indent:.30em;
    }
    .batch-setup__brand-en{order:2;margin:0;color:#f4f1eb;font-size:17px;line-height:1;font-weight:640;letter-spacing:.09em}
    .batch-setup__header-actions{display:flex!important;align-items:center!important;justify-content:center!important;gap:26px!important;min-width:0!important}
    .batch-setup__header-actions button{
      min-width:0!important;min-height:26px!important;margin:0!important;padding:3px 1px!important;
      border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;
      color:#969087!important;font-size:11px!important;font-weight:560!important;letter-spacing:.08em!important;white-space:nowrap!important;
    }
    .batch-setup__header-actions button:hover,.batch-setup__header-actions button:focus-visible{color:#d6ad63!important;outline:none}
    .batch-setup__home-section{margin:0 0 30px}
    .batch-setup__home-section-title,.batch-setup__session-meta-title{
      margin:0 0 16px!important;color:#d6ad63!important;text-align:center!important;
      font-family:"Noto Serif SC","Songti SC",STSong,serif!important;font-size:16px!important;
      line-height:1.2!important;font-weight:560!important;letter-spacing:.16em!important;
    }
    .batch-setup__session-meta{margin:0 0 30px!important;padding:0!important;border:0!important;background:transparent!important}
    .batch-setup__session-meta-grid{gap:13px 18px!important}
    .batch-setup__session-meta-field[data-session-field="日期"],
    .batch-setup__session-meta-field[data-session-field="时间"],
    .batch-setup__session-meta-field[data-session-field="组织方"],
    .batch-setup__session-meta-field[data-session-field="参与对象"]{font-size:15px!important}
    .batch-setup__session-meta-input{
      min-height:45px!important;font-size:15px!important;border-radius:0!important;
      border-width:0 0 1px!important;border-color:rgba(214,173,99,.24)!important;
      background:transparent!important;padding:8px 2px!important;
    }
    .batch-setup__samples-section{margin:0 0 28px}
    .batch-setup__capture-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;margin:0 0 14px!important}
    .batch-setup__capture-actions .batch-setup__home-capture-action{
      min-height:44px!important;margin:0!important;padding:8px 10px!important;
      border:1px solid rgba(185,153,90,.28)!important;border-radius:8px!important;
      background:#1b1b1b!important;color:#c9bea4!important;box-shadow:none!important;
      font:inherit!important;font-size:13px!important;font-weight:650!important;letter-spacing:.04em!important;
    }
    .batch-setup__capture-actions .batch-setup__home-capture-action:hover,
    .batch-setup__capture-actions .batch-setup__home-capture-action:focus-visible{
      border-color:#b9995a!important;background:#202020!important;color:#e1cfaa!important;outline:none!important;
    }
    .batch-setup__rows{margin-top:4px}
    .batch-setup__footer-section{display:grid;gap:10px;margin:10px 0 0;padding:22px 0 0;border-top:1px solid rgba(255,255,255,.065)}
    .batch-setup__footer-section .batch-setup__start{
      margin:0!important;min-height:68px!important;border-radius:11px!important;
      font-size:23px!important;line-height:1.1!important;font-weight:850!important;letter-spacing:.10em!important;
      box-shadow:0 8px 24px rgba(185,153,90,.14)!important;
    }
    .batch-setup__records-footer{
      width:100%;min-height:46px;border:1px solid rgba(185,153,90,.34);border-radius:9px;
      background:#1b1b1b;color:#c9bea4;font:inherit;font-size:14px;font-weight:680;letter-spacing:.12em;
    }
    .batch-setup__records-footer:hover,.batch-setup__records-footer:focus-visible{border-color:#b9995a;color:#e1cfaa;outline:none}
    .batch-setup__records-menu{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;
      margin:-2px 0 0;padding:10px;border:1px solid rgba(185,153,90,.18);border-radius:10px;background:#171717;
    }
    .batch-setup__records-menu[hidden]{display:none!important}
    .batch-setup__records-scope{
      min-height:44px;margin:0;padding:8px 10px;border:1px solid rgba(185,153,90,.28);border-radius:8px;
      background:#1b1b1b;color:#c9bea4;font:inherit;font-size:13px;font-weight:650;letter-spacing:.04em;
    }
    .batch-setup__records-scope:hover,.batch-setup__records-scope:focus-visible{border-color:#b9995a;background:#202020;color:#e1cfaa;outline:none}
    .batch-setup__file-input{display:none!important}
    @media(max-width:620px){
      .batch-setup{padding-top:20px!important}
      .batch-setup__header{margin-bottom:26px!important}
      .batch-setup__brand-zh{font-size:29px}
      .batch-setup__brand-en{font-size:15px}
      .batch-setup__session-meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:11px 12px!important}
      .batch-setup__capture-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      .batch-setup__footer-section .batch-setup__start{min-height:64px!important;font-size:21px!important}
    }
    @media(max-width:390px){
      .batch-setup__brand-zh{font-size:27px}
      .batch-setup__brand-en{font-size:14px}
      .batch-setup__header-actions{gap:22px!important}
      .batch-setup__session-meta-grid{grid-template-columns:1fr!important}
    }
  `;
  document.head.append(style);
}

interface BaseModeSetter {
  setCuppingMode(mode: CuppingTargetValue, save?: boolean): void;
}

export class BatchSetupRenderer {
  private readonly base: BaseBatchSetupRenderer;
  private targetObserver?: MutationObserver;
  private recordsButton?: HTMLButtonElement;
  private recordsMenu?: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    service: CuppingSetupService,
    recognizer: SampleRecognitionService,
    private readonly options: BatchSetupRendererOptions
  ) {
    installInlineFieldStyles();
    installHomeStyles();
    this.base = new BaseBatchSetupRenderer(root, service, new SegmentationReviewRecognitionService(recognizer, root), options);
  }

  async render(): Promise<void> {
    this.targetObserver?.disconnect();
    this.targetObserver = undefined;
    this.recordsMenu = undefined;
    await this.base.render();
    this.flattenSessionMetadataFields();
    this.installDirectCuppingTarget();
    this.rebuildHomeHeaderAndActions();
    this.rebuildHomeLayout();
  }

  private rebuildHomeHeaderAndActions(): void {
    const header = this.root.querySelector<HTMLElement>(".batch-setup__header");
    const copy = header?.querySelector<HTMLElement>(".batch-setup__header-copy");
    const actions = header?.querySelector<HTMLElement>(".batch-setup__header-actions");
    const captureActions = this.root.querySelector<HTMLElement>(".batch-setup__capture-actions");
    if (!header || !copy || !actions || !captureActions) return;

    copy.replaceChildren();
    const brand = document.createElement("div");
    brand.className = "batch-setup__brand";
    brand.setAttribute("aria-label", "香迹 AromaSense");
    brand.append(
      Object.assign(document.createElement("h1"), { className: "batch-setup__brand-zh", textContent: "香迹" }),
      Object.assign(document.createElement("div"), { className: "batch-setup__brand-en", textContent: "AromaSense" })
    );
    copy.append(brand);

    const headerButtons = [...actions.querySelectorAll<HTMLButtonElement>("button")];
    const account = headerButtons[0];
    const importButton = headerButtons[1];
    const records = headerButtons[2];
    actions.replaceChildren();
    if (account) {
      account.textContent = "账户";
      actions.append(account);
    }

    if (records) {
      const recordToggle = records.cloneNode(true) as HTMLButtonElement;
      recordToggle.textContent = "记录";
      recordToggle.className = "batch-setup__records-footer";
      recordToggle.dataset.homeAction = "records";
      recordToggle.setAttribute("aria-expanded", "false");
      recordToggle.setAttribute("aria-controls", "batch-setup-records-menu");
      recordToggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleRecordsMenu();
      });
      this.recordsButton = recordToggle;
    } else {
      this.recordsButton = undefined;
    }

    const original = [...captureActions.querySelectorAll<HTMLButtonElement>("button")];
    const photo = original.find((button) => button.textContent?.trim() === "拍摄录入");
    const batch = original.find((button) => button.textContent?.trim() === "批量识别");
    const manual = original.find((button) => button.textContent?.trim() === "手工录入");
    const clear = original.find((button) => button.textContent?.trim() === "清空样品" || button.textContent?.trim() === "清空列表");
    photo?.remove();

    if (batch) batch.dataset.homeAction = "batch-recognition";
    if (manual) manual.dataset.homeAction = "manual-entry";
    if (clear) {
      clear.textContent = "清空列表";
      clear.dataset.homeAction = "clear-list";
    }
    if (importButton) {
      importButton.textContent = "导入数据";
      importButton.dataset.homeAction = "import-data";
    }

    const homeActions = [batch, manual, clear, importButton].filter((button): button is HTMLButtonElement => Boolean(button));
    for (const action of homeActions) action.className = "batch-setup__capture batch-setup__home-capture-action";
    captureActions.replaceChildren(...homeActions);
  }

  private sectionTitle(text: string): HTMLElement {
    const title = document.createElement("h2");
    title.className = "batch-setup__home-section-title";
    title.textContent = text;
    return title;
  }

  private buildRecordsMenu(): HTMLElement {
    const menu = document.createElement("nav");
    menu.id = "batch-setup-records-menu";
    menu.className = "batch-setup__records-menu";
    menu.dataset.homeRecordsMenu = "true";
    menu.setAttribute("aria-label", "记录分类");
    menu.hidden = true;

    const addScope = (scope: RecordScope, label: string): void => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "batch-setup__records-scope";
      action.dataset.homeRecordScope = scope;
      action.textContent = label;
      action.addEventListener("click", () => void this.openRecordScope(scope));
      menu.append(action);
    };

    addScope("unfinished", "未完成记录");
    addScope("completed", "已完成记录");
    return menu;
  }

  private toggleRecordsMenu(): void {
    if (!this.recordsButton || !this.recordsMenu) return;
    const opening = this.recordsMenu.hidden;
    this.recordsMenu.hidden = !opening;
    this.recordsButton.setAttribute("aria-expanded", String(opening));
  }

  private async openRecordScope(scope: RecordScope): Promise<void> {
    if (this.recordsMenu) this.recordsMenu.hidden = true;
    this.recordsButton?.setAttribute("aria-expanded", "false");
    await this.options.onOpenRecords?.();
    const tab = document.querySelector<HTMLButtonElement>(`.home-modal [data-record-scope-tab="${scope}"]`);
    if (tab && tab.getAttribute("aria-pressed") !== "true") tab.click();
  }

  private rebuildHomeLayout(): void {
    this.root.querySelector(".batch-setup__recent")?.remove();
    this.root.querySelector(".batch-setup__history")?.remove();

    const header = this.root.querySelector<HTMLElement>(".batch-setup__header");
    const metadata = this.root.querySelector<HTMLElement>(".batch-setup__session-meta");
    const captureActions = this.root.querySelector<HTMLElement>(".batch-setup__capture-actions");
    const blindNote = this.root.querySelector<HTMLElement>(".batch-setup__blind-entry-note");
    const rows = this.root.querySelector<HTMLElement>(".batch-setup__rows");
    const status = this.root.querySelector<HTMLElement>(".batch-setup__status");
    const start = this.root.querySelector<HTMLButtonElement>(".batch-setup__start");
    if (!header || !metadata || !captureActions || !blindNote || !rows || !status || !start) return;

    metadata.classList.add("batch-setup__home-section");
    const metadataTitle = metadata.querySelector<HTMLElement>(".batch-setup__session-meta-title");
    if (metadataTitle) metadataTitle.textContent = "杯测信息";

    const samples = document.createElement("section");
    samples.className = "batch-setup__home-section batch-setup__samples-section";
    samples.setAttribute("aria-labelledby", "batch-setup-samples-title");
    const samplesTitle = this.sectionTitle("杯测列表");
    samplesTitle.id = "batch-setup-samples-title";
    samples.append(samplesTitle, captureActions, blindNote, rows, status);

    start.dataset.homeAction = "start-cupping";
    const footer = document.createElement("section");
    footer.className = "batch-setup__footer-section";
    footer.setAttribute("aria-label", "开始杯测与记录");
    footer.append(start);
    if (this.recordsButton) {
      this.recordsMenu = this.buildRecordsMenu();
      footer.append(this.recordsButton, this.recordsMenu);
    }

    const hiddenInputs = [...this.root.querySelectorAll<HTMLInputElement>(".batch-setup__file-input")];
    this.root.replaceChildren(header, metadata, samples, ...hiddenInputs, footer);
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

      const wrapper = document.createElement("div");
      wrapper.className = field.className;
      wrapper.dataset.sessionField = label;
      while (field.firstChild) wrapper.append(field.firstChild);
      field.replaceWith(wrapper);
    }
  }

  private setCanonicalCuppingMode(mode: CuppingTargetValue): void {
    (this.base as unknown as BaseModeSetter).setCuppingMode(mode, true);
  }

  private installDirectCuppingTarget(): void {
    const targetField = this.root.querySelector<HTMLElement>('[data-session-field="杯测目标"]');
    const shell = targetField?.querySelector<HTMLElement>(".batch-setup__target-shell");
    const trigger = targetField?.querySelector<HTMLButtonElement>(".batch-setup__target-button");
    const menu = targetField?.querySelector<HTMLElement>(".batch-setup__target-menu");
    if (!targetField || !shell || !trigger || !menu) return;

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
      choice.addEventListener("pointerdown", (event) => event.stopPropagation());
      choice.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setCanonicalCuppingMode(mode);
        this.syncDirectCuppingTarget(menu, choices);
      });
      choices.set(mode, choice);
      group.append(choice);
    }

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
