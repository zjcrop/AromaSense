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
    .batch-setup__target-choice+ .batch-setup__target-choice{border-left:1px solid rgba(214,173,99,.10)}
    .batch-setup__target-choice.is-selected,
    .batch-setup__target-choice[aria-pressed="true"]{
      color:#f4f1eb;font-weight:800;background:rgba(214,173,99,.08)
    }
    .batch-setup__target-choice:focus-visible{outline:1px solid rgba(214,173,99,.65);outline-offset:-1px}
  `;
  document.head.append(style);
}

function installHomeStyles(): void {
  if (document.head.querySelector("style[data-aromasense-home-chrome]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseHomeChrome = "true";
  style.textContent = `
    .batch-setup__header{
      display:grid!important;
      grid-template-columns:minmax(150px,1fr) auto!important;
      align-items:center!important;
      gap:18px!important;
      margin-bottom:22px!important;
    }
    .batch-setup__header-copy{
      width:172px;
      min-width:0;
      justify-self:start;
      text-align:center;
    }
    .batch-setup__brand{display:grid;gap:7px;justify-items:center}
    .batch-setup__brand-en{
      margin:0;
      color:#f5f1e8;
      font-size:22px;
      line-height:1;
      font-weight:690;
      letter-spacing:.015em;
    }
    .batch-setup__brand-zh{
      color:#d6ad63;
      font-family:"Noto Serif SC","Songti SC",STSong,serif;
      font-size:15px;
      line-height:1;
      font-weight:560;
      letter-spacing:.34em;
      text-indent:.34em;
    }
    .batch-setup__header-actions{
      display:flex!important;
      align-items:center;
      justify-content:flex-end;
      gap:20px!important;
      min-width:0;
    }
    .batch-setup__header-actions button{
      min-width:0!important;
      min-height:34px!important;
      margin:0!important;
      padding:4px 0!important;
      border:0!important;
      border-radius:0!important;
      background:transparent!important;
      box-shadow:none!important;
      color:#d6ad63!important;
      font-size:13px!important;
      font-weight:700!important;
      white-space:nowrap;
    }
    .batch-setup__history{
      margin-top:24px;
      padding-top:6px;
      border-top:1px solid rgba(255,255,255,.06);
    }
    .batch-setup__history-group{border-bottom:1px solid rgba(255,255,255,.055)}
    .batch-setup__history-toggle{
      width:100%;
      min-height:44px;
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      align-items:center;
      gap:12px;
      margin:0;
      padding:10px 0;
      border:0;
      background:transparent;
      color:#b9b3a9;
      text-align:left;
      font:inherit;
      font-size:13px;
      font-weight:650;
    }
    .batch-setup__history-toggle::after{
      content:'+';
      color:#8b867e;
      font-size:16px;
      font-weight:400;
      transition:transform 160ms ease,color 160ms ease;
    }
    .batch-setup__history-group.is-open .batch-setup__history-toggle{color:#d6ad63}
    .batch-setup__history-group.is-open .batch-setup__history-toggle::after{
      transform:rotate(45deg);
      color:#d6ad63;
    }
    .batch-setup__history-list{display:grid;gap:1px;padding:0 0 8px}
    .batch-setup__history-list[hidden]{display:none!important}
    .batch-setup__history-item{
      width:100%;
      min-width:0;
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      align-items:center;
      gap:12px;
      margin:0;
      padding:9px 0;
      border:0;
      background:transparent;
      color:#eee9df;
      text-align:left;
      font:inherit;
    }
    .batch-setup__history-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:560}
    .batch-setup__history-meta{color:#858078;font-size:10px;white-space:nowrap}
    @media(max-width:620px){
      .batch-setup__header{grid-template-columns:minmax(128px,1fr) auto!important;gap:12px!important}
      .batch-setup__header-copy{width:142px}
      .batch-setup__brand-en{font-size:19px}
      .batch-setup__brand-zh{font-size:13px}
      .batch-setup__header-actions{gap:13px!important}
      .batch-setup__header-actions button{font-size:12px!important}
      .batch-setup__history-item{grid-template-columns:1fr;gap:2px}
      .batch-setup__history-meta{white-space:normal}
    }
    @media(max-width:390px){
      .batch-setup__header{grid-template-columns:minmax(112px,1fr) auto!important;gap:9px!important}
      .batch-setup__header-copy{width:124px}
      .batch-setup__brand-en{font-size:17px}
      .batch-setup__brand-zh{font-size:12px}
      .batch-setup__header-actions{gap:10px!important}
      .batch-setup__header-actions button{font-size:11px!important}
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
    this.rebuildRecentSessions();
  }

  private rebuildHomeHeader(): void {
    const header = this.root.querySelector<HTMLElement>(".batch-setup__header");
    const copy = header?.querySelector<HTMLElement>(".batch-setup__header-copy");
    const actions = header?.querySelector<HTMLElement>(".batch-setup__header-actions");
    if (!header || !copy || !actions) return;

    copy.replaceChildren();
    const brand = document.createElement("div");
    brand.className = "batch-setup__brand";
    brand.setAttribute("aria-label", "AromaSense 香迹");
    brand.append(
      Object.assign(document.createElement("h1"), { className: "batch-setup__brand-en", textContent: "AromaSense" }),
      Object.assign(document.createElement("div"), { className: "batch-setup__brand-zh", textContent: "香  迹" })
    );
    copy.append(brand);

    const actionButtons = [...actions.querySelectorAll<HTMLButtonElement>("button")];
    if (actionButtons[0]) actionButtons[0].textContent = "账户";
    if (actionButtons[1]) actionButtons[1].textContent = "导入";
    if (actionButtons[2]) actionButtons[2].textContent = "记录";
  }

  private rebuildRecentSessions(): void {
    this.root.querySelector(".batch-setup__recent")?.remove();
    this.root.querySelector(".batch-setup__history")?.remove();

    const sessions = this.options.recentSessions ?? [];
    const unfinished = sessions.filter((item) => item.status === "draft" || item.status === "active");
    const completed = sessions.filter((item) => item.status === "completed" || item.status === "archived");
    if (!unfinished.length && !completed.length) return;

    const history = document.createElement("section");
    history.className = "batch-setup__history";
    history.setAttribute("aria-label", "最近杯测记录");
    history.append(
      this.historyGroup("unfinished", "未完成记录", unfinished),
      this.historyGroup("completed", "已完成记录", completed)
    );
    this.root.append(history);
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
