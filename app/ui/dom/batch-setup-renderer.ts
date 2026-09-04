import type { CuppingSetupService } from "../../core/cupping-setup-service";
import type { SampleRecognitionService } from "../../core/sample-recognition-service";
import {
  BatchSetupRenderer as BaseBatchSetupRenderer,
  type BatchSetupRendererOptions as BaseBatchSetupRendererOptions,
  type RecentSessionItem
} from "./batch-setup-review-renderer";

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
  const previous = document.head.querySelector("style[data-aromasense-home-chrome]");
  previous?.remove();
  const style = document.createElement("style");
  style.dataset.aromasenseHomeChrome = "true";
  style.textContent = `
    .batch-setup{max-width:760px!important;padding-top:28px!important}
    .batch-setup__header{
      display:grid!important;
      justify-items:center!important;
      align-items:center!important;
      gap:13px!important;
      margin:0 0 30px!important;
      padding:8px 0 2px!important;
      text-align:center!important;
    }
    .batch-setup__header-copy{width:auto!important;justify-self:center!important;text-align:center!important}
    .batch-setup__brand{display:grid;gap:8px;justify-items:center}
    .batch-setup__brand-zh{
      order:1;
      margin:0;
      color:#d6ad63;
      font-family:"Noto Serif SC","Songti SC",STSong,serif;
      font-size:34px;
      line-height:1.08;
      font-weight:580;
      letter-spacing:.30em;
      text-indent:.30em;
    }
    .batch-setup__brand-en{
      order:2;
      margin:0;
      color:#f4f1eb;
      font-size:17px;
      line-height:1;
      font-weight:640;
      letter-spacing:.09em;
    }
    .batch-setup__header-actions{
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
      gap:26px!important;
      min-width:0!important;
    }
    .batch-setup__header-actions button{
      min-width:0!important;min-height:26px!important;margin:0!important;padding:3px 1px!important;
      border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;
      color:#969087!important;font-size:11px!important;font-weight:560!important;letter-spacing:.08em!important;
      white-space:nowrap!important;
    }
    .batch-setup__header-actions button:hover,.batch-setup__header-actions button:focus-visible{color:#d6ad63!important;outline:none}
    .batch-setup__home-section{margin:0 0 30px}
    .batch-setup__home-section-title,
    .batch-setup__session-meta-title{
      margin:0 0 16px!important;
      color:#d6ad63!important;
      text-align:center!important;
      font-family:"Noto Serif SC","Songti SC",STSong,serif!important;
      font-size:16px!important;
      line-height:1.2!important;
      font-weight:560!important;
      letter-spacing:.16em!important;
    }
    .batch-setup__session-meta{margin:0 0 30px!important;padding:0!important;border:0!important;background:transparent!important}
    .batch-setup__session-meta-grid{gap:13px 18px!important}
    .batch-setup__session-meta-field[data-session-field="日期"],
    .batch-setup__session-meta-field[data-session-field="时间"],
    .batch-setup__session-meta-field[data-session-field="组织方"],
    .batch-setup__session-meta-field[data-session-field="参与对象"]{
      font-size:15px!important;
    }
    .batch-setup__session-meta-input{
      min-height:45px!important;
      font-size:15px!important;
      border-radius:0!important;
      border-width:0 0 1px!important;
      border-color:rgba(214,173,99,.24)!important;
      background:transparent!important;
      padding:8px 2px!important;
    }
    .batch-setup__samples-section{margin:0 0 28px}
    .batch-setup__capture-actions{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:8px!important;margin:0 0 14px!important}
    .batch-setup__capture-actions button{
      min-height:40px!important;border-radius:8px!important;background:#1b1b1b!important;
    }
    .batch-setup__import-inline{border-color:rgba(185,153,90,.38)!important;color:#c9bea4!important}
    .batch-setup__rows{margin-top:4px}
    .batch-setup__footer-section{
      margin:10px 0 0;
      padding:22px 0 0;
      border-top:1px solid rgba(255,255,255,.065);
    }
    .batch-setup__footer-section .batch-setup__start{
      margin:0!important;min-height:48px!important;border-radius:9px!important;
      font-size:14px!important;letter-spacing:.08em!important;
    }
    .batch-setup__history{margin-top:20px;padding-top:3px;border-top:0}
    .batch-setup__history-group{border-bottom:1px solid rgba(255,255,255,.055)}
    .batch-setup__history-toggle{
      width:100%;min-height:42px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;
      margin:0;padding:9px 0;border:0;background:transparent;color:#9a958d;text-align:left;font:inherit;font-size:12px;font-weight:590;
    }
    .batch-setup__history-toggle::after{content:'+';color:#77726b;font-size:16px;font-weight:400;transition:transform 160ms ease,color 160ms ease}
    .batch-setup__history-group.is-open .batch-setup__history-toggle{color:#d6ad63}
    .batch-setup__history-group.is-open .batch-setup__history-toggle::after{transform:rotate(45deg);color:#d6ad63}
    .batch-setup__history-list{display:grid;gap:1px;padding:0 0 8px}
    .batch-setup__history-list[hidden]{display:none!important}
    .batch-setup__history-item{
      width:100%;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;
      margin:0;padding:9px 0;border:0;background:transparent;color:#eee9df;text-align:left;font:inherit;
    }
    .batch-setup__history-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:560}
    .batch-setup__history-meta{color:#858078;font-size:10px;white-space:nowrap}
    .batch-setup__file-input{display:none!important}
    @media(max-width:620px){
      .batch-setup{padding-top:20px!important}
      .batch-setup__header{margin-bottom:26px!important}
      .batch-setup__brand-zh{font-size:29px}
      .batch-setup__brand-en{font-size:15px}
      .batch-setup__session-meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:11px 12px!important}
      .batch-setup__capture-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      .batch-setup__history-item{grid-template-columns:1fr;gap:2px}
      .batch-setup__history-meta{white-space:normal}
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
  private openHistoryGroup?: "unfinished" | "completed";

  constructor(
    private readonly root: HTMLElement,
    service: CuppingSetupService,
    recognizer: SampleRecognitionService,
    private readonly options: BatchSetupRendererOptions
  ) {
    installInlineFieldStyles();
    installHomeStyles();
    this.base = new BaseBatchSetupRenderer(root, service, recognizer, options);
  }

  async render(): Promise<void> {
    this.targetObserver?.disconnect();
    this.targetObserver = undefined;
    await this.base.render();
    this.flattenSessionMetadataFields();
    this.installDirectCuppingTarget();
    this.rebuildHomeHeader();
    this.rebuildHomeLayout();
  }

  private rebuildHomeHeader(): void {
    const header = this.root.querySelector<HTMLElement>(".batch-setup__header");
    const copy = header?.querySelector<HTMLElement>(".batch-setup__header-copy");
    const actions = header?.querySelector<HTMLElement>(".batch-setup__header-actions");
    if (!header || !copy || !actions) return;

    copy.replaceChildren();
    const brand = document.createElement("div");
    brand.className = "batch-setup__brand";
    brand.setAttribute("aria-label", "香迹 AromaSense");
    brand.append(
      Object.assign(document.createElement("h1"), { className: "batch-setup__brand-zh", textContent: "香迹" }),
      Object.assign(document.createElement("div"), { className: "batch-setup__brand-en", textContent: "AromaSense" })
    );
    copy.append(brand);

    const actionButtons = [...actions.querySelectorAll<HTMLButtonElement>("button")];
    const account = actionButtons[0];
    const importButton = actionButtons[1];
    const records = actionButtons[2];
    actions.replaceChildren();
    if (account) {
      account.textContent = "账户";
      actions.append(account);
    }
    if (records) {
      records.textContent = "记录";
      actions.append(records);
    }
    const captureActions = this.root.querySelector<HTMLElement>(".batch-setup__capture-actions");
    if (importButton && captureActions) {
      importButton.textContent = "导入数据";
      importButton.className = "batch-setup__capture batch-setup__import-inline";
      captureActions.append(importButton);
    }
  }

  private sectionTitle(text: string): HTMLElement {
    const title = document.createElement("h2");
    title.className = "batch-setup__home-section-title";
    title.textContent = text;
    return title;
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

    const footer = document.createElement("section");
    footer.className = "batch-setup__footer-section";
    footer.setAttribute("aria-label", "开始杯测与记录");
    footer.append(start);
    const history = this.buildRecentSessions();
    if (history) footer.append(history);

    const hiddenInputs = [...this.root.querySelectorAll<HTMLInputElement>(".batch-setup__file-input")];
    this.root.replaceChildren(header, metadata, samples, ...hiddenInputs, footer);
  }

  private buildRecentSessions(): HTMLElement | undefined {
    const sessions = this.options.recentSessions ?? [];
    const unfinished = sessions.filter((item) => item.status === "draft" || item.status === "active");
    const completed = sessions.filter((item) => item.status === "completed" || item.status === "archived");
    if (!unfinished.length && !completed.length) return undefined;

    const history = document.createElement("section");
    history.className = "batch-setup__history";
    history.setAttribute("aria-label", "杯测记录");
    history.append(
      this.historyGroup("unfinished", "未完成记录", unfinished),
      this.historyGroup("completed", "已完成记录", completed)
    );
    return history;
  }

  private historyGroup(
    key: "unfinished" | "completed",
    title: string,
    sessions: readonly RecentSessionItem[]
  ): HTMLElement {
    const group = document.createElement("section");
    group.className = "batch-setup__history-group";
    group.dataset.historyGroup = key;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "batch-setup__history-toggle";
    toggle.textContent = title;
    toggle.setAttribute("aria-expanded", "false");

    const list = document.createElement("div");
    list.className = "batch-setup__history-list";
    list.hidden = true;
    list.id = `batch-history-${key}`;
    toggle.setAttribute("aria-controls", list.id);

    if (!sessions.length) {
      const empty = document.createElement("div");
      empty.className = "batch-setup__history-meta";
      empty.textContent = "暂无记录";
      list.append(empty);
    } else {
      for (const session of sessions.slice(0, 12)) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "batch-setup__history-item";
        const name = document.createElement("strong");
        name.className = "batch-setup__history-name";
        name.textContent = session.title?.trim() || "未命名杯测";
        const meta = document.createElement("span");
        meta.className = "batch-setup__history-meta";
        const stateLabel = session.status === "active" ? "进行中"
          : session.status === "draft" ? "未开始"
          : session.status === "archived" ? "已归档"
          : "已完成";
        meta.textContent = `${session.sampleCount} 个样品 · ${stateLabel}`;
        row.append(name, meta);
        row.addEventListener("click", () => {
          if (key === "unfinished") {
            void (this.options.onOpenRecent?.(session.sessionId, false) ?? this.options.onResume?.(session.sessionId));
          } else {
            void (this.options.onOpenRecent?.(session.sessionId, true) ?? this.options.onOpenRecords?.());
          }
        });
        list.append(row);
      }
    }

    toggle.addEventListener("click", () => this.toggleHistoryGroup(key));
    group.append(toggle, list);
    return group;
  }

  private toggleHistoryGroup(key: "unfinished" | "completed"): void {
    const opening = this.openHistoryGroup !== key;
    this.openHistoryGroup = opening ? key : undefined;
    for (const group of this.root.querySelectorAll<HTMLElement>("[data-history-group]")) {
      const active = opening && group.dataset.historyGroup === key;
      group.classList.toggle("is-open", active);
      const toggle = group.querySelector<HTMLButtonElement>(".batch-setup__history-toggle");
      const list = group.querySelector<HTMLElement>(".batch-setup__history-list");
      toggle?.setAttribute("aria-expanded", String(active));
      if (list) list.hidden = !active;
    }
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
