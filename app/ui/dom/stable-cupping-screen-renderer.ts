import type { SampleSummaryReader } from "../../storage/sample-summary-reader";
import {
  SampleRecognitionService,
  type RecognizedPage,
  type RecognizedSample
} from "../../core/sample-recognition-service";
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
import {
  openBatchReviewDialog,
  type BatchReviewDialogHandle,
  type BatchReviewField,
  type BatchReviewValue
} from "./batch-review-dialog";
import { compactImagePreview } from "./image-preview-data";
import { SegmentationReviewRecognitionService } from "./segmentation-review-recognizer";

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

interface RuntimeTimerInternals { timerId?: number; }
interface StableBaseInternals { base: RuntimeTimerInternals; }
interface ResumeContext { sampleId: string; stageId: string; finalPhase?: string; }
interface ManagerMessage { text: string; error?: boolean; }
interface RuntimeRecognitionDraft {
  version: 1;
  sessionId: string;
  page: RecognizedPage;
  index: number;
  addedSampleIds: string[];
  preview?: string;
  updatedAt: string;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function activeFinalPhase(controller: CuppingScreenController): string | undefined {
  const active = controller.current()?.active;
  if (active?.context.stageId !== "final") return undefined;
  const value = active.slice.observations.find((item) => item.fieldKey === "final_phase")?.value;
  return typeof value === "string" && value.trim() ? value.trim() : "flavor";
}

function reviewFields(sample: RecognizedSample): BatchReviewField[] {
  return EDITABLE_SAMPLE_FIELDS.map(([key, label]) => ({
    key,
    label,
    group: key === "flavorNotes" ? "风味线索" : "样品信息",
    value: textValue(sample.metadata[key]),
    multiline: key === "flavorNotes",
    tier: key === "flavorNotes" ? "detail" : "core"
  }));
}

function installFreeCuppingStyles(): void {
  if (document.head.querySelector("style[data-aromasense-free-cupping-runtime]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseFreeCuppingRuntime = "true";
  style.textContent = `
    .cupping-rail-tools__sample-manager,.cupping-rail-tools__session-editor{min-height:28px;border:0;background:transparent;color:#d6ad63;font:inherit;font-size:10px;font-weight:700;cursor:pointer}
    .cupping-rail-tools__sample-manager{margin-left:auto}.cupping-rail-tools__session-editor{margin-left:6px;color:#aaa39a}
    .free-cupping-manager{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.68);backdrop-filter:blur(4px)}
    .free-cupping-manager.is-page{place-items:stretch;padding:0;background:#101010;backdrop-filter:none}
    .free-cupping-manager__panel{width:min(760px,100%);max-height:88dvh;overflow:auto;box-sizing:border-box;padding:18px 20px 24px;border:1px solid rgba(214,173,99,.28);border-radius:14px;background:#151515;color:#f4f1eb;box-shadow:0 22px 58px rgba(0,0,0,.5)}
    .free-cupping-manager.is-page .free-cupping-manager__panel{width:100%;max-height:100dvh;border:0;border-radius:0;box-shadow:none;padding:max(18px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(26px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}
    .free-cupping-manager__head{display:flex;align-items:flex-start;gap:14px;margin-bottom:12px}.free-cupping-manager__titles{flex:1;min-width:0}
    .free-cupping-manager__title{margin:0;font-size:18px}.free-cupping-manager__note{margin:5px 0 0;color:#999187;font-size:11px;line-height:1.55}
    .free-cupping-manager__head-actions{display:flex;align-items:center;gap:8px}.free-cupping-manager__page-toggle,.free-cupping-manager__close{border:0;background:transparent;font:inherit;cursor:pointer}.free-cupping-manager__page-toggle{color:#d6ad63;font-size:10px;font-weight:750}.free-cupping-manager__close{color:#aaa39a;font-size:22px}
    .free-cupping-manager__add,.free-cupping-manager__resume{width:100%;min-height:42px;margin:0 0 12px;border:1px solid rgba(214,173,99,.36);border-radius:8px;background:#1c1c1c;color:#d6ad63;font:inherit;font-weight:750;cursor:pointer}
    .free-cupping-manager__resume{margin-top:-4px;border-color:rgba(131,185,230,.34);color:#9fc8eb;background:#181c20}
    .free-cupping-manager__progress{position:sticky;bottom:0;z-index:3;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 10px;align-items:center;margin:10px -4px 0;padding:9px 4px 2px;background:linear-gradient(180deg,rgba(21,21,21,0),#151515 28%)}
    .free-cupping-manager__progress[hidden]{display:none!important}.free-cupping-manager__progress-label{color:#b7afa2;font-size:10px;line-height:1.4}.free-cupping-manager__progress-percent{color:#d6ad63;font-size:10px;font-variant-numeric:tabular-nums}.free-cupping-manager__progress-track{grid-column:1/-1;height:4px;overflow:hidden;border-radius:99px;background:#2a2926}.free-cupping-manager__progress-fill{height:100%;width:0;border-radius:inherit;background:#b9995a;transition:width .24s cubic-bezier(.2,.7,.2,1)}
    .free-cupping-manager__list{display:grid;gap:12px}.free-cupping-manager__sample{padding:13px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:#191919}
    .free-cupping-manager__sample-head{display:flex;align-items:center;gap:10px;margin-bottom:9px}.free-cupping-manager__sample-number{color:#d6ad63;font-weight:800}.free-cupping-manager__sample-name{flex:1;min-width:0;padding:6px 0;border:0;border-bottom:1px solid rgba(214,173,99,.2);background:transparent;color:#f4f1eb;font:inherit}
    .free-cupping-manager__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}.free-cupping-manager__field{display:grid;gap:3px}.free-cupping-manager__field--wide{grid-column:1/-1}
    .free-cupping-manager__field span{color:#8f8880;font-size:9px}.free-cupping-manager__field input{width:100%;box-sizing:border-box;padding:6px 0;border:0;border-bottom:1px solid rgba(255,255,255,.08);background:transparent;color:#e9e5de;font:inherit;font-size:12px;outline:none}
    .free-cupping-manager__actions{display:flex;justify-content:flex-end;gap:14px;margin-top:11px}.free-cupping-manager__save,.free-cupping-manager__delete{border:0;background:transparent;font:inherit;font-size:11px;font-weight:750;cursor:pointer}.free-cupping-manager__save{color:#d6ad63}.free-cupping-manager__delete{color:#c9867f}
    .free-cupping-manager button:disabled,.free-cupping-manager input:disabled{opacity:.42;cursor:not-allowed}.free-cupping-manager__status{min-height:18px;margin:8px 0 0;color:#989188;font-size:10px}.free-cupping-manager__status.is-error{color:#d9867e}.free-cupping-manager__capture-input{display:none!important}
    .free-cupping-return{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));z-index:10012;transform:translateX(-50%);display:flex;align-items:center;gap:10px;width:min(720px,calc(100vw - 24px));box-sizing:border-box;padding:10px 12px;border:1px solid rgba(214,173,99,.32);border-radius:10px;background:rgba(20,20,20,.96);box-shadow:0 10px 30px rgba(0,0,0,.38);color:#b6afa4;font-size:11px}.free-cupping-return__text{flex:1}.free-cupping-return button{border:0;background:transparent;color:#d6ad63;font:inherit;font-size:11px;font-weight:750;cursor:pointer}.free-cupping-return__stay{color:#918b82!important}
    @media(max-width:620px){.free-cupping-manager{padding:8px}.free-cupping-manager__panel{max-height:94dvh;padding:15px 13px 22px}.free-cupping-manager.is-page{padding:0}.free-cupping-manager__grid{grid-template-columns:1fr}.free-cupping-manager__field--wide{grid-column:auto}.free-cupping-return{align-items:flex-start;flex-wrap:wrap}.free-cupping-return__text{flex-basis:100%}}
  `;
  document.head.append(style);
}

/** Installed after sample-rail-renderer's injected stylesheet so the same DOM
 * element cannot lose overflow-y:auto to `.sample-rail{overflow:visible}`. */
function installRailInteractionFixStyles(): void {
  if (document.head.querySelector("style[data-aromasense-rail-scroll-fix]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseRailScrollFix = "true";
  style.textContent = `
    .cupping-layout__rail{position:relative!important;overflow:visible!important}
    .cupping-layout__rail-list.sample-rail{position:relative!important;z-index:2!important;overflow-x:hidden!important;overflow-y:auto!important;touch-action:pan-y!important;overscroll-behavior-y:contain!important;scroll-behavior:smooth!important;-webkit-overflow-scrolling:touch;scrollbar-width:none!important;-ms-overflow-style:none!important}
    .cupping-layout__rail-list.sample-rail::-webkit-scrollbar,.cupping-main__editor::-webkit-scrollbar,.batch-review__panel::-webkit-scrollbar,.free-cupping-manager__panel::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}
    .cupping-main__editor,.batch-review__panel,.free-cupping-manager__panel{scrollbar-width:none!important;-ms-overflow-style:none!important}
    .sample-rail__active-tab{display:none!important}
    .sample-rail__item.is-active::before{content:none!important;display:none!important}
    .cupping-rail-active-float{position:absolute;z-index:1;left:3px;top:0;box-sizing:border-box;border:1px solid rgba(214,173,99,.42);border-radius:14px 999px 999px 14px;background:linear-gradient(90deg,rgba(82,64,37,.92),rgba(128,95,45,.96));box-shadow:0 5px 18px rgba(0,0,0,.30),inset 0 0 0 1px rgba(255,255,255,.055);opacity:0;pointer-events:none;will-change:top,width,height,opacity;transition:top .22s cubic-bezier(.2,.7,.2,1),width .22s cubic-bezier(.2,.7,.2,1),height .22s cubic-bezier(.2,.7,.2,1),opacity .12s ease}
    .sample-rail__item.is-active{z-index:4!important;overflow:visible!important}
    .sample-rail__item.is-active .sample-rail__select,.sample-rail__item.is-active .sample-rail__number,.sample-rail__item.is-active .sample-rail__active-copy{position:relative;z-index:5!important}
    .sample-rail__item.is-active .sample-rail__sample-name{position:relative;z-index:6!important;font-size:clamp(20px,2vw,23px)!important;font-weight:760!important;text-shadow:0 1px 9px rgba(0,0,0,.32)}
  `;
  document.head.append(style);
}

export class CuppingScreenRenderer {
  private base: StableBaseCuppingScreenRenderer;
  private observer?: MutationObserver;
  private managerOverlay?: HTMLElement;
  private runtimeReview?: BatchReviewDialogHandle;
  private resumeContext?: ResumeContext;
  private returnContext?: ResumeContext;
  private managerMessage?: ManagerMessage;
  private managerPageMode = false;
  private runtimeDraftMemory?: RuntimeRecognitionDraft;
  private railFloat?: HTMLElement;
  private railScrollTarget?: HTMLElement;
  private railScrollHandler?: () => void;
  private railResizeHandler?: () => void;
  private readonly runtimeRecognizer: SegmentationReviewRecognitionService;

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: CuppingScreenController,
    private readonly flavorService: FlavorGroupPreferenceService,
    private readonly summaryReader: SampleSummaryReader,
    private readonly options: CuppingScreenRendererOptions,
    private readonly overlayManager?: OverlayManager
  ) {
    installFreeCuppingStyles();
    this.runtimeRecognizer = new SegmentationReviewRecognitionService(new SampleRecognitionService(), root);
    this.base = this.createBase();
  }

  async initialize(sessionId: string): Promise<void> {
    await this.base.initialize(sessionId);
    installRailInteractionFixStyles();
    this.installObserver();
    this.applyModeRuntime();
  }

  /** Opens the full-page edit state. Used by unfinished free-cupping records. */
  async openEditor(): Promise<void> { await this.openManager(true); }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.runtimeReview?.close();
    this.runtimeReview = undefined;
    this.managerOverlay?.remove();
    this.managerOverlay = undefined;
    if (this.railScrollTarget && this.railScrollHandler) this.railScrollTarget.removeEventListener("scroll", this.railScrollHandler);
    if (this.railResizeHandler) window.removeEventListener("resize", this.railResizeHandler);
    this.railFloat?.remove();
    this.railFloat = undefined;
    this.railScrollTarget = undefined;
    this.root.querySelector(".free-cupping-return")?.remove();
    this.base.dispose();
  }

  private createBase(): StableBaseCuppingScreenRenderer {
    return new StableBaseCuppingScreenRenderer(this.root, this.controller, this.flavorService, this.summaryReader, this.options, this.overlayManager);
  }

  private installObserver(): void {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => this.applyModeRuntime());
    this.observer.observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  private syncRailFloat(): void {
    const host = this.root.querySelector<HTMLElement>(".cupping-layout__rail");
    const list = this.root.querySelector<HTMLElement>(".cupping-layout__rail-list.sample-rail");
    if (!host || !list) {
      this.railFloat?.remove();
      this.railFloat = undefined;
      return;
    }
    if (!this.railFloat || this.railFloat.parentElement !== host) {
      this.railFloat?.remove();
      const marker = document.createElement("div");
      marker.className = "cupping-rail-active-float";
      marker.setAttribute("aria-hidden", "true");
      host.append(marker);
      this.railFloat = marker;
    }
    if (this.railScrollTarget !== list) {
      if (this.railScrollTarget && this.railScrollHandler) this.railScrollTarget.removeEventListener("scroll", this.railScrollHandler);
      this.railScrollTarget = list;
      this.railScrollHandler = () => this.positionRailFloat();
      list.addEventListener("scroll", this.railScrollHandler, { passive: true });
    }
    if (!this.railResizeHandler) {
      this.railResizeHandler = () => this.positionRailFloat();
      window.addEventListener("resize", this.railResizeHandler, { passive: true });
    }
    this.positionRailFloat();
  }

  private positionRailFloat(): void {
    const marker = this.railFloat;
    const host = marker?.parentElement instanceof HTMLElement ? marker.parentElement : undefined;
    const list = this.railScrollTarget;
    const active = list?.querySelector<HTMLElement>(".sample-rail__item.is-active");
    if (!marker || !host || !list || !active) {
      if (marker) marker.style.opacity = "0";
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const visible = activeRect.bottom > listRect.top && activeRect.top < listRect.bottom;
    const height = Math.max(42, Math.round(activeRect.height - 4));
    const top = Math.round(activeRect.top - hostRect.top + activeRect.height / 2 - height / 2);
    marker.style.top = `${top}px`;
    marker.style.left = "3px";
    marker.style.width = `${Math.max(54, Math.round(hostRect.width + 13))}px`;
    marker.style.height = `${height}px`;
    marker.style.opacity = visible ? "1" : "0";
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
    this.syncRailFloat();
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    const policy = cuppingModePolicy(mode);
    this.root.dataset.cuppingMode = mode;
    if (mode === "free" || mode === "timed") this.root.querySelector(".cupping-main__blind-status")?.remove();
    if (!policy.timerEnabled) {
      this.stopInnerTimer();
      for (const node of this.root.querySelectorAll("[data-cupping-timer], .cupping-completion-stamp")) node.remove();
    }

    const mutable = policy.runtimeRosterMutable && state.sessionStatus !== "completed" && state.sessionStatus !== "archived";
    const existingManager = this.root.querySelector<HTMLButtonElement>("[data-runtime-sample-manager]");
    const existingEditor = this.root.querySelector<HTMLButtonElement>("[data-runtime-session-editor]");
    if (!mutable) { existingManager?.remove(); existingEditor?.remove(); return; }
    const tools = this.root.querySelector<HTMLElement>(".cupping-rail-tools");
    if (!tools) return;
    if (!existingManager) {
      const manage = document.createElement("button"); manage.type = "button"; manage.className = "cupping-rail-tools__sample-manager"; manage.dataset.runtimeSampleManager = "true"; manage.textContent = "豆子管理";
      manage.title = "保存当前页面状态后，识别添加、删除或修改本次自由杯测的豆子";
      manage.addEventListener("click", () => void this.openManager(false)); tools.append(manage);
    }
    if (!existingEditor) {
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "cupping-rail-tools__session-editor"; edit.dataset.runtimeSessionEditor = "true"; edit.textContent = "编辑";
      edit.title = "离开杯测内容视图，进入本次自由杯测编辑状态";
      edit.addEventListener("click", () => void this.openManager(true)); tools.append(edit);
    }
    this.renderReturnBanner();
  }

  private captureResumeContext(): void {
    const active = this.controller.current()?.active;
    if (!active) { this.resumeContext = undefined; return; }
    this.resumeContext = { sampleId: active.context.sampleId, stageId: active.context.stageId, ...(active.context.stageId === "final" ? { finalPhase: activeFinalPhase(this.controller) } : {}) };
  }

  private async nextFrame(): Promise<void> { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
  private async waitFor(predicate: () => boolean, frames = 45): Promise<boolean> {
    for (let index = 0; index < frames; index += 1) { if (predicate()) return true; await this.nextFrame(); }
    return predicate();
  }
  private sampleSelectButton(sampleId: string): HTMLButtonElement | undefined {
    return [...this.root.querySelectorAll<HTMLElement>(".sample-rail__item")].find((card) => card.dataset.sampleId === sampleId)?.querySelector<HTMLButtonElement>(".sample-rail__select") ?? undefined;
  }
  private stageButton(context: ResumeContext): HTMLButtonElement | undefined {
    const buttons = [...this.root.querySelectorAll<HTMLButtonElement>(".cupping-stage-step")];
    if (context.stageId === "final" && context.finalPhase) return buttons.find((item) => item.dataset.stageId === "final" && item.dataset.finalPhase === context.finalPhase);
    return buttons.find((item) => item.dataset.stageId === context.stageId);
  }
  private resumeSatisfied(context: ResumeContext): boolean {
    const active = this.controller.current()?.active;
    if (!active || active.context.sampleId !== context.sampleId || active.context.stageId !== context.stageId) return false;
    return context.stageId !== "final" || !context.finalPhase || activeFinalPhase(this.controller) === context.finalPhase;
  }
  private async restoreContext(context?: ResumeContext): Promise<void> {
    if (!context) return;
    const state = this.controller.current();
    if (!state?.samples.some((sample) => sample.sampleId === context.sampleId)) return;
    this.sampleSelectButton(context.sampleId)?.click();
    await this.waitFor(() => this.controller.current()?.active?.context.sampleId === context.sampleId);
    await this.waitFor(() => Boolean(this.stageButton(context)) || this.resumeSatisfied(context));
    if (!this.resumeSatisfied(context)) { this.stageButton(context)?.click(); await this.waitFor(() => this.resumeSatisfied(context)); }
  }

  private async reloadBase(target = this.resumeContext): Promise<void> {
    const state = this.controller.current(); if (!state) return;
    this.observer?.disconnect(); this.base.dispose(); this.root.replaceChildren(); this.base = this.createBase();
    await this.base.initialize(state.sessionId); installRailInteractionFixStyles(); this.installObserver(); this.applyModeRuntime(); await this.restoreContext(target);
  }

  private async openManager(pageMode = false): Promise<void> {
    const state = this.controller.current();
    if (!state || cuppingModeFromMetadata(state.sessionMetadata) !== "free") return;
    try {
      if (!this.managerOverlay) this.captureResumeContext();
      await this.controller.leaveSession();
      this.managerPageMode = pageMode;
      this.renderManager();
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  }

  private closeManager = async (): Promise<void> => {
    this.runtimeReview?.close(); this.runtimeReview = undefined;
    this.managerOverlay?.remove(); this.managerOverlay = undefined;
    this.setBusyProgress(false, 0, "");
    await this.reloadBase(this.resumeContext);
  };

  private rebuildManager(): void { this.runtimeReview?.close(); this.runtimeReview = undefined; this.managerOverlay?.remove(); this.managerOverlay = undefined; this.renderManager(); }

  private setBusyProgress(active: boolean, percent: number, label: string): void {
    const safe = Math.max(0, Math.min(100, Math.round(percent)));
    const overlay = this.managerOverlay;
    const progress = overlay?.querySelector<HTMLElement>(".free-cupping-manager__progress");
    const text = overlay?.querySelector<HTMLElement>(".free-cupping-manager__progress-label");
    const value = overlay?.querySelector<HTMLElement>(".free-cupping-manager__progress-percent");
    const fill = overlay?.querySelector<HTMLElement>(".free-cupping-manager__progress-fill");
    if (progress) progress.hidden = !active;
    if (text) text.textContent = label;
    if (value) value.textContent = `${safe}%`;
    if (fill) fill.style.width = `${safe}%`;
    this.root.toggleAttribute("aria-busy", active);
    if (active) this.root.dataset.longOperationLabel = label;
    else delete this.root.dataset.longOperationLabel;
  }

  private runtimeDraftKey(): string | undefined {
    const sessionId = this.controller.current()?.sessionId?.trim();
    return sessionId ? `aromasense.runtime-recognition-draft.v1.${sessionId}` : undefined;
  }

  private reviewedSample(sample: RecognizedSample, value: BatchReviewValue): RecognizedSample {
    const metadata: Record<string, unknown> = { ...sample.metadata };
    for (const [key] of EDITABLE_SAMPLE_FIELDS) delete metadata[key];
    for (const [key, fieldValue] of Object.entries(value.fields)) {
      const normalized = fieldValue.trim();
      if (normalized) metadata[key] = normalized;
    }
    return { ...sample, label: value.label.trim(), metadata };
  }

  private saveRuntimeRecognitionDraft(
    page: RecognizedPage,
    index: number,
    addedSampleIds: readonly string[],
    preview?: string,
    currentValue?: BatchReviewValue
  ): RuntimeRecognitionDraft | undefined {
    const sessionId = this.controller.current()?.sessionId;
    const key = this.runtimeDraftKey();
    if (!sessionId || !key || !page.samples.length) return undefined;
    const safeIndex = Math.max(0, Math.min(page.samples.length - 1, Math.trunc(index)));
    const samples = page.samples.map((sample, sampleIndex) =>
      sampleIndex === safeIndex && currentValue ? this.reviewedSample(sample, currentValue) : sample
    );
    const draft: RuntimeRecognitionDraft = {
      version: 1,
      sessionId,
      page: { ...page, samples },
      index: safeIndex,
      addedSampleIds: [...new Set(addedSampleIds.filter(Boolean))],
      preview,
      updatedAt: this.options.now()
    };
    this.runtimeDraftMemory = draft;
    try {
      const persisted = preview && preview.length > 750_000 ? { ...draft, preview: undefined } : draft;
      window.localStorage?.setItem(key, JSON.stringify(persisted));
    } catch { /* in-memory fallback still protects the current app lifetime */ }
    return draft;
  }

  private loadRuntimeRecognitionDraft(): RuntimeRecognitionDraft | undefined {
    const state = this.controller.current();
    const key = this.runtimeDraftKey();
    if (!state || !key) return undefined;
    if (this.runtimeDraftMemory?.sessionId === state.sessionId) return this.runtimeDraftMemory;
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as Partial<RuntimeRecognitionDraft>;
      if (parsed.version !== 1 || parsed.sessionId !== state.sessionId || !parsed.page || !Array.isArray(parsed.page.samples) || !parsed.page.samples.length) return undefined;
      const index = Number(parsed.index);
      if (!Number.isInteger(index) || index < 0 || index >= parsed.page.samples.length) return undefined;
      const draft: RuntimeRecognitionDraft = {
        version: 1,
        sessionId: state.sessionId,
        page: parsed.page as RecognizedPage,
        index,
        addedSampleIds: Array.isArray(parsed.addedSampleIds) ? parsed.addedSampleIds.map(String).filter(Boolean) : [],
        preview: typeof parsed.preview === "string" ? parsed.preview : undefined,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : ""
      };
      this.runtimeDraftMemory = draft;
      return draft;
    } catch {
      return undefined;
    }
  }

  private clearRuntimeRecognitionDraft(): void {
    const key = this.runtimeDraftKey();
    this.runtimeDraftMemory = undefined;
    if (!key) return;
    try { window.localStorage?.removeItem(key); } catch { /* best effort */ }
  }

  private async recognizeAndReviewPhoto(file: File, add: HTMLButtonElement, status: HTMLElement): Promise<void> {
    add.disabled = true; status.classList.remove("is-error"); status.textContent = "正在准备照片…";
    let predicted = 8;
    this.setBusyProgress(true, predicted, "添加豆子 · 准备图片");
    const timer = window.setInterval(() => { predicted = Math.min(72, predicted + (predicted < 35 ? 3 : 1)); this.setBusyProgress(true, predicted, "添加豆子 · PP-OCRv5 识别中"); }, 420);
    try {
      const previewPromise = compactImagePreview(file).catch(() => undefined);
      this.setBusyProgress(true, 14, "添加豆子 · PP-OCRv5 文字识别");
      const page = await this.runtimeRecognizer.recognizePage(file, 0);
      window.clearInterval(timer);
      if (!page.samples.length) throw new Error("照片中没有得到可添加的样品");
      const preview = await previewPromise;
      this.saveRuntimeRecognitionDraft(page, 0, [], preview);
      this.setBusyProgress(false, 100, "");
      status.textContent = `识别到 ${page.samples.length} 个豆子，请逐一确认后加入当前杯测。`;
      this.openRecognitionReview(page, preview, status, add, 0, []);
    } catch (error) {
      window.clearInterval(timer); add.disabled = false;
      this.setBusyProgress(false, 0, "");
      status.textContent = `识别添加失败：${error instanceof Error ? error.message : String(error)}`; status.classList.add("is-error");
    }
  }

  private openRecognitionReview(
    page: RecognizedPage,
    preview: string | undefined,
    status: HTMLElement,
    add: HTMLButtonElement,
    startIndex = 0,
    restoredAddedIds: readonly string[] = []
  ): void {
    const samples = [...page.samples];
    const addedIds: string[] = [...restoredAddedIds];
    const openAt = (index: number): void => {
      const sample = samples[index];
      if (!sample || !this.managerOverlay) return;
      this.setBusyProgress(false, 0, "");
      this.runtimeReview?.close();
      this.runtimeReview = openBatchReviewDialog({
        root: this.managerOverlay,
        rowId: `runtime-add-${index}`,
        index,
        total: samples.length,
        confirmed: addedIds.length,
        finalPending: index === samples.length - 1,
        previewUrl: preview,
        recognitionStatus: [page.engine, page.layoutType, sample.requiresReview ? "存在待核对字段" : "自动识别完成"].join(" · "),
        rawText: sample.rawText,
        label: sample.label,
        fields: reviewFields(sample),
        onExit: (value) => {
          this.saveRuntimeRecognitionDraft(page, index, addedIds, preview, value);
          this.runtimeReview?.close();
          this.runtimeReview = undefined;
          add.disabled = false;
          this.setBusyProgress(false, 0, "");
          this.managerMessage = {
            text: `识别结果已暂存：已加入 ${addedIds.length} 个，待确认 ${samples.length - index} 个。可随时继续确认。`
          };
          this.rebuildManager();
        },
        onConfirm: async (value: BatchReviewValue) => {
          this.setBusyProgress(false, 0, "");
          const reviewed = this.reviewedSample(sample, value);
          const metadata: Record<string, unknown> = { ...reviewed.metadata };
          const recognition = metadata.recognition && typeof metadata.recognition === "object"
            ? metadata.recognition as Record<string, unknown>
            : {};
          metadata.recognition = {
            ...recognition,
            runtimeRosterAddition: true,
            runtimeUserConfirmed: true,
            runtimeAddedAt: this.options.now()
          };
          const id = crypto.randomUUID();
          try {
            await this.controller.addSample(id, { label: reviewed.label, metadata }, this.options.now());
            addedIds.push(id);
            this.runtimeReview?.close();
            this.runtimeReview = undefined;
            if (index + 1 < samples.length) {
              this.saveRuntimeRecognitionDraft(page, index + 1, addedIds, preview);
              openAt(index + 1);
              return;
            }
            this.clearRuntimeRecognitionDraft();
            await this.finishRuntimeAddition(addedIds, status);
          } catch (error) {
            this.setBusyProgress(false, 0, "");
            throw error;
          }
        }
      });
    };
    openAt(Math.max(0, Math.min(samples.length - 1, startIndex)));
  }

  private async finishRuntimeAddition(addedIds: readonly string[], status: HTMLElement): Promise<void> {
    const last = addedIds.at(-1); if (!last) return;
    const original = this.resumeContext;
    this.returnContext = original;
    this.managerOverlay?.remove(); this.managerOverlay = undefined;
    this.setBusyProgress(false, 0, "");
    const lastContext: ResumeContext = { sampleId: last, stageId: "aroma" };
    await this.reloadBase(lastContext);
    this.resumeContext = original;
    this.managerMessage = { text: `已确认并加入 ${addedIds.length} 个豆子` };
    status.textContent = "";
    this.renderReturnBanner(addedIds.length);
  }

  private renderReturnBanner(addedCount?: number): void {
    this.root.querySelector(".free-cupping-return")?.remove();
    const context = this.returnContext; if (!context) return;
    const banner = document.createElement("div"); banner.className = "free-cupping-return";
    const text = document.createElement("span"); text.className = "free-cupping-return__text"; text.textContent = `${addedCount ? `已新增 ${addedCount} 个豆子。` : "新增豆子已确认。"}当前停留在最后新增豆子，可继续编辑。`;
    const stay = document.createElement("button"); stay.type = "button"; stay.className = "free-cupping-return__stay"; stay.textContent = "继续编辑"; stay.onclick = () => { this.returnContext = undefined; banner.remove(); };
    const back = document.createElement("button"); back.type = "button"; back.textContent = "返回添加前进程";
    back.onclick = async () => { const target = this.returnContext; this.returnContext = undefined; banner.remove(); if (target) { this.resumeContext = target; await this.reloadBase(target); } };
    banner.append(text, stay, back); this.root.append(banner);
  }

  private renderManager(): void {
    const state = this.controller.current(); if (!state || cuppingModeFromMetadata(state.sessionMetadata) !== "free") return;
    this.managerOverlay?.remove();
    const overlay = document.createElement("div"); overlay.className = `free-cupping-manager${this.managerPageMode ? " is-page" : ""}`; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "自由杯测编辑");
    const panel = document.createElement("section"); panel.className = "free-cupping-manager__panel";
    const head = document.createElement("div"); head.className = "free-cupping-manager__head";
    const titles = document.createElement("div"); titles.className = "free-cupping-manager__titles";
    const title = document.createElement("h2"); title.className = "free-cupping-manager__title"; title.textContent = this.managerPageMode ? "自由杯测 · 编辑" : "自由杯测 · 豆子管理";
    const note = document.createElement("p"); note.className = "free-cupping-manager__note"; note.textContent = "当前杯测内容已落盘。拍照新增会经过 PP-OCRv5 识别、必要的多条目分割和逐豆确认；确认前不会写入当前杯测。";
    titles.append(title, note);
    const headActions = document.createElement("div"); headActions.className = "free-cupping-manager__head-actions";
    const pageToggle = document.createElement("button"); pageToggle.type = "button"; pageToggle.className = "free-cupping-manager__page-toggle"; pageToggle.textContent = this.managerPageMode ? "浮层模式" : "进入杯测编辑页面";
    pageToggle.onclick = () => { this.managerPageMode = !this.managerPageMode; this.renderManager(); };
    const close = document.createElement("button"); close.type = "button"; close.className = "free-cupping-manager__close"; close.textContent = "×"; close.setAttribute("aria-label", "继续杯测"); close.addEventListener("click", () => void this.closeManager());
    headActions.append(pageToggle, close); head.append(titles, headActions);

    const status = document.createElement("div"); status.className = "free-cupping-manager__status";
    if (this.managerMessage) { status.textContent = this.managerMessage.text; status.classList.toggle("is-error", Boolean(this.managerMessage.error)); this.managerMessage = undefined; }
    const captureInput = document.createElement("input"); captureInput.type = "file"; captureInput.accept = "image/*"; captureInput.setAttribute("capture", "environment"); captureInput.className = "free-cupping-manager__capture-input";
    const add = document.createElement("button"); add.type = "button"; add.className = "free-cupping-manager__add"; add.textContent = "+ 拍照识别添加豆子"; add.addEventListener("click", () => captureInput.click());
    captureInput.addEventListener("change", () => { const file = captureInput.files?.[0]; captureInput.value = ""; if (file) void this.recognizeAndReviewPhoto(file, add, status); });
    const pendingDraft = this.loadRuntimeRecognitionDraft();
    const resume = pendingDraft ? document.createElement("button") : undefined;
    if (resume && pendingDraft) {
      resume.type = "button";
      resume.className = "free-cupping-manager__resume";
      resume.textContent = `继续确认已识别豆子 · ${pendingDraft.index + 1}/${pendingDraft.page.samples.length}`;
      resume.addEventListener("click", () => {
        const draft = this.loadRuntimeRecognitionDraft();
        if (!draft) { this.rebuildManager(); return; }
        add.disabled = true;
        this.setBusyProgress(false, 0, "");
        status.textContent = `继续确认已暂存的识别结果：${draft.index + 1}/${draft.page.samples.length}`;
        this.openRecognitionReview(draft.page, draft.preview, status, add, draft.index, draft.addedSampleIds);
      });
    }

    const list = document.createElement("div"); list.className = "free-cupping-manager__list";
    for (const sample of state.samples) {
      const locked = state.lockedSampleIds.includes(sample.sampleId);
      const card = document.createElement("article"); card.className = "free-cupping-manager__sample"; card.dataset.sampleId = sample.sampleId;
      const sampleHead = document.createElement("div"); sampleHead.className = "free-cupping-manager__sample-head";
      const number = document.createElement("strong"); number.className = "free-cupping-manager__sample-number"; number.textContent = String(sample.displayNumber).padStart(2, "0");
      const name = document.createElement("input"); name.className = "free-cupping-manager__sample-name"; name.value = sample.label ?? ""; name.placeholder = locked ? "得分已锁定" : "豆子/样品名称"; name.disabled = locked; sampleHead.append(number, name);
      const grid = document.createElement("div"); grid.className = "free-cupping-manager__grid"; const inputs = new Map<string, HTMLInputElement>();
      for (const [key, label, placeholder] of EDITABLE_SAMPLE_FIELDS) {
        const field = document.createElement("label"); field.className = `free-cupping-manager__field${key === "flavorNotes" ? " free-cupping-manager__field--wide" : ""}`;
        const caption = document.createElement("span"); caption.textContent = label; const input = document.createElement("input"); input.type = "text"; input.value = textValue(sample.metadata[key]); input.placeholder = placeholder; input.disabled = locked; inputs.set(key, input); field.append(caption, input); grid.append(field);
      }
      const actions = document.createElement("div"); actions.className = "free-cupping-manager__actions";
      const save = document.createElement("button"); save.type = "button"; save.className = "free-cupping-manager__save"; save.textContent = locked ? "已锁定" : "保存信息"; save.disabled = locked;
      save.addEventListener("click", async () => { save.disabled = true; try { const patch: Record<string, unknown> = {}; for (const [key, input] of inputs) patch[key] = input.value; await this.controller.saveSampleIdentity(sample.sampleId, name.value, patch, this.options.now()); status.textContent = `样品 ${String(sample.displayNumber).padStart(2, "0")} 已保存`; status.classList.remove("is-error"); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); status.classList.add("is-error"); } finally { save.disabled = false; } });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "free-cupping-manager__delete"; remove.textContent = "删除"; remove.disabled = locked || state.samples.length <= 1; remove.title = locked ? "得分已确认的样品不能删除" : state.samples.length <= 1 ? "至少保留一个样品" : "删除本样品及其杯测记录";
      remove.addEventListener("click", async () => { if (!window.confirm(`删除样品 ${String(sample.displayNumber).padStart(2, "0")}？该样品已记录的杯测数据也会一并删除。`)) return; remove.disabled = true; try { await this.controller.deleteSample(sample.sampleId, this.options.now()); this.rebuildManager(); } catch (error) { remove.disabled = false; status.textContent = error instanceof Error ? error.message : String(error); status.classList.add("is-error"); } });
      actions.append(save, remove); card.append(sampleHead, grid, actions); list.append(card);
    }

    const progress = document.createElement("div"); progress.className = "free-cupping-manager__progress"; progress.hidden = true;
    const progressLabel = document.createElement("span"); progressLabel.className = "free-cupping-manager__progress-label";
    const progressPercent = document.createElement("strong"); progressPercent.className = "free-cupping-manager__progress-percent"; progressPercent.textContent = "0%";
    const track = document.createElement("div"); track.className = "free-cupping-manager__progress-track"; const fill = document.createElement("div"); fill.className = "free-cupping-manager__progress-fill"; track.append(fill); progress.append(progressLabel, progressPercent, track);
    panel.append(head, add); if (resume) panel.append(resume); panel.append(captureInput, list, status, progress); overlay.append(panel);
    overlay.addEventListener("click", (event) => { if (!this.managerPageMode && event.target === overlay) void this.closeManager(); });
    this.managerOverlay = overlay; document.body.append(overlay);
  }
}
