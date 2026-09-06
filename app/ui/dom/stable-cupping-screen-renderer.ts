import type { SampleSummaryReader } from "../../storage/sample-summary-reader";
import {
  cuppingModeFromMetadata,
  cuppingModePolicy
} from "../../core/session-metadata";
import type { CuppingScreenController } from "../cupping-screen-controller";
import type { FlavorGroupPreferenceService } from "../flavor-group-preferences";
import type { OverlayManager } from "../interaction-foundation";
import {
  CuppingScreenRenderer as StableBaseCuppingScreenRenderer
} from "./stable-cupping-screen-renderer-base";
import type { CuppingScreenRendererOptions } from "./cupping-screen-renderer";

const EDITABLE_SAMPLE_FIELDS: readonly [string, string, string][] = [
  ["country", "国家", "国家"],
  ["region", "产区", "产区"],
  ["farm", "庄园/处理站", "庄园、合作社或处理站"],
  ["variety", "品种", "品种"],
  ["process", "处理法", "处理法"],
  ["roast", "烘焙度", "烘焙度"],
  ["roastDate", "烘焙日期", "YYYY-MM-DD / 七月十五日 / 15 Jul 2026"],
  ["altitude", "海拔", "海拔"],
  ["flavorNotes", "风味信息", "已知风味信息"]
];

interface RuntimeTimerInternals {
  timerId?: number;
}
interface StableBaseInternals {
  base: RuntimeTimerInternals;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function installFreeCuppingStyles(): void {
  if (document.head.querySelector("style[data-aromasense-free-cupping-runtime]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseFreeCuppingRuntime = "true";
  style.textContent = `
    .cupping-rail-tools__sample-manager{min-height:28px;margin-left:auto;border:0;background:transparent;color:#d6ad63;font:inherit;font-size:10px;font-weight:700;cursor:pointer}
    .free-cupping-manager{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.68);backdrop-filter:blur(4px)}
    .free-cupping-manager__panel{width:min(760px,100%);max-height:88dvh;overflow:auto;box-sizing:border-box;padding:18px 20px;border:1px solid rgba(214,173,99,.28);border-radius:14px;background:#151515;color:#f4f1eb;box-shadow:0 22px 58px rgba(0,0,0,.5)}
    .free-cupping-manager__head{display:flex;align-items:flex-start;gap:14px;margin-bottom:12px}.free-cupping-manager__titles{flex:1;min-width:0}
    .free-cupping-manager__title{margin:0;font-size:18px}.free-cupping-manager__note{margin:5px 0 0;color:#999187;font-size:11px;line-height:1.55}
    .free-cupping-manager__close{border:0;background:transparent;color:#aaa39a;font-size:22px;cursor:pointer}
    .free-cupping-manager__add{width:100%;min-height:42px;margin:0 0 12px;border:1px solid rgba(214,173,99,.36);border-radius:8px;background:#1c1c1c;color:#d6ad63;font:inherit;font-weight:750;cursor:pointer}
    .free-cupping-manager__list{display:grid;gap:12px}.free-cupping-manager__sample{padding:13px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:#191919}
    .free-cupping-manager__sample-head{display:flex;align-items:center;gap:10px;margin-bottom:9px}.free-cupping-manager__sample-number{color:#d6ad63;font-weight:800}.free-cupping-manager__sample-name{flex:1;min-width:0;padding:6px 0;border:0;border-bottom:1px solid rgba(214,173,99,.2);background:transparent;color:#f4f1eb;font:inherit}
    .free-cupping-manager__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}.free-cupping-manager__field{display:grid;gap:3px}.free-cupping-manager__field--wide{grid-column:1/-1}
    .free-cupping-manager__field span{color:#8f8880;font-size:9px}.free-cupping-manager__field input{width:100%;box-sizing:border-box;padding:6px 0;border:0;border-bottom:1px solid rgba(255,255,255,.08);background:transparent;color:#e9e5de;font:inherit;font-size:12px;outline:none}
    .free-cupping-manager__actions{display:flex;justify-content:flex-end;gap:14px;margin-top:11px}.free-cupping-manager__save,.free-cupping-manager__delete{border:0;background:transparent;font:inherit;font-size:11px;font-weight:750;cursor:pointer}.free-cupping-manager__save{color:#d6ad63}.free-cupping-manager__delete{color:#c9867f}
    .free-cupping-manager button:disabled,.free-cupping-manager input:disabled{opacity:.42;cursor:not-allowed}.free-cupping-manager__status{min-height:18px;margin:8px 0 0;color:#989188;font-size:10px}.free-cupping-manager__status.is-error{color:#d9867e}
    @media(max-width:620px){.free-cupping-manager{padding:8px}.free-cupping-manager__panel{max-height:94dvh;padding:15px 13px}.free-cupping-manager__grid{grid-template-columns:1fr}.free-cupping-manager__field--wide{grid-column:auto}}
  `;
  document.head.append(style);
}

/**
 * Mode-policy layer over the stable cupping renderer.
 * - free: no timer/timing stamps; roster manager enabled
 * - timed: timer remains; public sample identity and roster are runtime-locked
 * - blind/semi-blind: existing timed visibility/late identity workflow remains
 */
export class CuppingScreenRenderer {
  private base: StableBaseCuppingScreenRenderer;
  private observer?: MutationObserver;
  private managerOverlay?: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: CuppingScreenController,
    private readonly flavorService: FlavorGroupPreferenceService,
    private readonly summaryReader: SampleSummaryReader,
    private readonly options: CuppingScreenRendererOptions,
    private readonly overlayManager?: OverlayManager
  ) {
    installFreeCuppingStyles();
    this.base = this.createBase();
  }

  async initialize(sessionId: string): Promise<void> {
    await this.base.initialize(sessionId);
    this.installObserver();
    this.applyModeRuntime();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.managerOverlay?.remove();
    this.managerOverlay = undefined;
    this.base.dispose();
  }

  private createBase(): StableBaseCuppingScreenRenderer {
    return new StableBaseCuppingScreenRenderer(
      this.root,
      this.controller,
      this.flavorService,
      this.summaryReader,
      this.options,
      this.overlayManager
    );
  }

  private installObserver(): void {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => this.applyModeRuntime());
    this.observer.observe(this.root, { childList: true, subtree: true });
  }

  private stopInnerTimer(): void {
    const runtime = (this.base as unknown as StableBaseInternals).base;
    if (runtime.timerId === undefined) return;
    window.clearInterval(runtime.timerId);
    runtime.timerId = undefined;
  }

  private applyModeRuntime(): void {
    const state = this.controller.current();
    if (!state) return;
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    const policy = cuppingModePolicy(mode);
    this.root.dataset.cuppingMode = mode;

    if (mode === "free" || mode === "timed") {
      this.root.querySelector(".cupping-main__blind-status")?.remove();
    }

    if (!policy.timerEnabled) {
      this.stopInnerTimer();
      for (const node of this.root.querySelectorAll("[data-cupping-timer], .cupping-completion-stamp")) node.remove();
    }

    const existing = this.root.querySelector<HTMLButtonElement>("[data-runtime-sample-manager]");
    const mutable = policy.runtimeRosterMutable && state.sessionStatus !== "completed" && state.sessionStatus !== "archived";
    if (!mutable) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const tools = this.root.querySelector<HTMLElement>(".cupping-rail-tools");
    if (!tools) return;
    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "cupping-rail-tools__sample-manager";
    manage.dataset.runtimeSampleManager = "true";
    manage.textContent = "豆子管理";
    manage.title = "暂停当前编辑，添加、删除或修改本次自由杯测的豆子";
    manage.addEventListener("click", () => void this.openManager());
    tools.append(manage);
  }

  private async reloadBase(): Promise<void> {
    const state = this.controller.current();
    if (!state) return;
    this.observer?.disconnect();
    this.base.dispose();
    this.root.replaceChildren();
    this.base = this.createBase();
    await this.base.initialize(state.sessionId);
    this.installObserver();
    this.applyModeRuntime();
  }

  private async openManager(): Promise<void> {
    const state = this.controller.current();
    if (!state || cuppingModeFromMetadata(state.sessionMetadata) !== "free") return;
    try {
      await this.controller.pauseEditing();
      this.renderManager();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  private closeManager = async (): Promise<void> => {
    this.managerOverlay?.remove();
    this.managerOverlay = undefined;
    await this.reloadBase();
  };

  private rebuildManager(): void {
    this.managerOverlay?.remove();
    this.managerOverlay = undefined;
    this.renderManager();
  }

  private renderManager(): void {
    const state = this.controller.current();
    if (!state || cuppingModeFromMetadata(state.sessionMetadata) !== "free") return;
    const overlay = document.createElement("div");
    overlay.className = "free-cupping-manager";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "自由杯测豆子管理");
    const panel = document.createElement("section");
    panel.className = "free-cupping-manager__panel";

    const head = document.createElement("div");
    head.className = "free-cupping-manager__head";
    const titles = document.createElement("div");
    titles.className = "free-cupping-manager__titles";
    const title = document.createElement("h2");
    title.className = "free-cupping-manager__title";
    title.textContent = "自由杯测 · 豆子管理";
    const note = document.createElement("p");
    note.className = "free-cupping-manager__note";
    note.textContent = "当前感官编辑已暂停并落盘。可新增、删除未锁定样品，或修改豆名与基础信息；关闭后从左侧样品继续杯测。";
    titles.append(title, note);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "free-cupping-manager__close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭豆子管理");
    close.addEventListener("click", () => void this.closeManager());
    head.append(titles, close);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "free-cupping-manager__add";
    add.textContent = "+ 添加豆子";
    add.addEventListener("click", async () => {
      add.disabled = true;
      try {
        await this.controller.addSample(crypto.randomUUID(), { metadata: {} }, this.options.now());
        this.rebuildManager();
      } catch (error) {
        add.disabled = false;
        status.textContent = error instanceof Error ? error.message : String(error);
        status.classList.add("is-error");
      }
    });

    const list = document.createElement("div");
    list.className = "free-cupping-manager__list";
    for (const sample of state.samples) {
      const locked = state.lockedSampleIds.includes(sample.sampleId);
      const card = document.createElement("article");
      card.className = "free-cupping-manager__sample";
      card.dataset.sampleId = sample.sampleId;
      const sampleHead = document.createElement("div");
      sampleHead.className = "free-cupping-manager__sample-head";
      const number = document.createElement("strong");
      number.className = "free-cupping-manager__sample-number";
      number.textContent = String(sample.displayNumber).padStart(2, "0");
      const name = document.createElement("input");
      name.className = "free-cupping-manager__sample-name";
      name.value = sample.label ?? "";
      name.placeholder = locked ? "得分已锁定" : "豆子/样品名称";
      name.disabled = locked;
      sampleHead.append(number, name);

      const grid = document.createElement("div");
      grid.className = "free-cupping-manager__grid";
      const inputs = new Map<string, HTMLInputElement>();
      for (const [key, label, placeholder] of EDITABLE_SAMPLE_FIELDS) {
        const field = document.createElement("label");
        field.className = `free-cupping-manager__field${key === "flavorNotes" ? " free-cupping-manager__field--wide" : ""}`;
        const caption = document.createElement("span");
        caption.textContent = label;
        const input = document.createElement("input");
        input.type = "text";
        input.value = textValue(sample.metadata[key]);
        input.placeholder = placeholder;
        input.disabled = locked;
        inputs.set(key, input);
        field.append(caption, input);
        grid.append(field);
      }

      const actions = document.createElement("div");
      actions.className = "free-cupping-manager__actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "free-cupping-manager__save";
      save.textContent = locked ? "已锁定" : "保存信息";
      save.disabled = locked;
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          const patch: Record<string, unknown> = {};
          for (const [key, input] of inputs) patch[key] = input.value;
          await this.controller.saveSampleIdentity(sample.sampleId, name.value, patch, this.options.now());
          status.textContent = `样品 ${String(sample.displayNumber).padStart(2, "0")} 已保存`;
          status.classList.remove("is-error");
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
          status.classList.add("is-error");
        } finally { save.disabled = false; }
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "free-cupping-manager__delete";
      remove.textContent = "删除";
      remove.disabled = locked || state.samples.length <= 1;
      remove.title = locked ? "得分已确认的样品不能删除" : state.samples.length <= 1 ? "至少保留一个样品" : "删除本样品及其杯测记录";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`删除样品 ${String(sample.displayNumber).padStart(2, "0")}？该样品已记录的杯测数据也会一并删除。`)) return;
        remove.disabled = true;
        try {
          await this.controller.deleteSample(sample.sampleId, this.options.now());
          this.rebuildManager();
        } catch (error) {
          remove.disabled = false;
          status.textContent = error instanceof Error ? error.message : String(error);
          status.classList.add("is-error");
        }
      });
      actions.append(save, remove);
      card.append(sampleHead, grid, actions);
      list.append(card);
    }

    const status = document.createElement("div");
    status.className = "free-cupping-manager__status";
    panel.append(head, add, list, status);
    overlay.append(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) void this.closeManager(); });
    this.managerOverlay = overlay;
    document.body.append(overlay);
  }
}
