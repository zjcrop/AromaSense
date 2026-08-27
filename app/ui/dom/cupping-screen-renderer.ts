import type { StageId } from "../../../shared/protocol/aromasense-v1";
import { scoreProfileForMetadata } from "../../core/cupping-score-profile";
import {
  blindModeDescription,
  blindModeLabel,
  isBlindSessionRevealed,
  visibleSampleLabel,
  visibleSampleMetadata
} from "../../core/blind-session";
import { cuppingModeFromMetadata } from "../../core/session-metadata";
import type { SampleSummaryReader } from "../../storage/sample-summary-reader";
import type { CuppingScreenController, CuppingScreenState } from "../cupping-screen-controller";
import type { FlavorGroupPreferenceService, FlavorGroupPreferences } from "../flavor-group-preferences";
import { attachDragReorder } from "./drag-reorder";
import { button, clearElement, element } from "./dom-helpers";
import { finalAssessmentPhase, renderFinalAssessment } from "./final-assessment-renderer";
import { renderSampleRail } from "./sample-rail-renderer";
import { renderSensoryEditor } from "./sensory-editor-renderer";

export interface CuppingScreenRendererOptions {
  now(): string;
  onSessionFinished?(sessionId: string, finalRevisionId?: string): void | Promise<void>;
  onExit?(sessionId: string): void | Promise<void>;
  onOpenAccount?(sessionId: string): void | Promise<void>;
  onOpenRecords?(): void | Promise<void>;
}

const SAMPLE_DETAIL_FIELDS: readonly [string, string][] = [
  ["country", "国家"], ["region", "产区"], ["farm", "庄园/处理站"], ["variety", "品种"],
  ["process", "处理法"], ["roast", "烘焙度"], ["roastDate", "烘焙日期"], ["altitude", "海拔"], ["flavorNotes", "风味"]
];

function ensureBlindStatusStyles(): void {
  if (document.head.querySelector("style[data-aromasense-blind-status]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseBlindStatus = "true";
  style.textContent = `
    .cupping-main__blind-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding:7px 10px;border:1px solid rgba(185,153,90,.25);border-radius:9px;background:rgba(185,153,90,.07)}
    .cupping-main__blind-mode{color:#d4bc82;font-size:12px}
    .cupping-main__blind-copy{color:#9c968c;font-size:10px;line-height:1.45}
  `;
  document.head.append(style);
}

function readableMetadataValue(value: unknown): string | undefined {
  if (typeof value === "string") { const normalized = value.trim(); return normalized || undefined; }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function renderSampleDetails(metadata: Record<string, unknown>): HTMLElement | undefined {
  const values = SAMPLE_DETAIL_FIELDS.flatMap(([key, label]) => {
    const value = readableMetadataValue(metadata[key]);
    return value ? [{ label, value }] : [];
  });
  if (!values.length) return undefined;
  const details = element("div", "cupping-main__sample-details");
  for (const item of values) {
    const chip = element("span", "cupping-main__sample-detail");
    chip.append(element("small", "cupping-main__sample-detail-label", item.label), element("span", "cupping-main__sample-detail-value", item.value));
    details.append(chip);
  }
  return details;
}

export class CuppingScreenRenderer {
  private state?: CuppingScreenState;
  private flavorPreferences?: FlavorGroupPreferences;
  private disposeRailDrag?: () => void;
  private disposeFlavorDrag?: () => void;
  private disposeSelectedStackDrag?: () => void;
  private railCompact = true;
  private readonly expandedSampleIds = new Set<string>();
  private readonly layoutRoot = element("div", "cupping-layout is-rail-compact");
  private readonly railRoot = element("aside", "cupping-layout__rail");
  private readonly railListRoot = element("div", "cupping-layout__rail-list");
  private readonly mainRoot = element("main", "cupping-layout__main");
  private readonly headerRoot = element("header", "cupping-main__header");
  private readonly editorRoot = element("div", "cupping-main__editor");
  private readonly stageStripRoot = element("nav", "cupping-main__stage-strip");
  private readonly footerRoot = element("footer", "cupping-main__footer");
  private readonly statusRoot = element("div", "cupping-status");

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: CuppingScreenController,
    private readonly flavorService: FlavorGroupPreferenceService,
    private readonly summaryReader: SampleSummaryReader,
    private readonly options: CuppingScreenRendererOptions
  ) {
    ensureBlindStatusStyles();
    this.root.classList.add("aromasense-cupping");
    this.stageStripRoot.setAttribute("aria-label", "杯测流程");
    this.mainRoot.append(this.headerRoot, this.statusRoot, this.editorRoot, this.stageStripRoot, this.footerRoot);
    this.layoutRoot.append(this.railRoot, this.mainRoot);
    this.root.append(this.layoutRoot);

    const autoCollapse = (): void => this.collapseRailForEditing();
    this.editorRoot.addEventListener("pointerdown", autoCollapse, { passive: true });
    this.editorRoot.addEventListener("focusin", autoCollapse);
  }

  async initialize(sessionId: string): Promise<void> {
    this.flavorPreferences = await this.flavorService.load();
    this.state = await this.controller.initialize(sessionId);
    await this.render();
  }

  dispose(): void { this.disposeDragHandlers(); }

  private disposeDragHandlers(): void {
    this.disposeRailDrag?.(); this.disposeRailDrag = undefined;
    this.disposeFlavorDrag?.(); this.disposeFlavorDrag = undefined;
    this.disposeSelectedStackDrag?.(); this.disposeSelectedStackDrag = undefined;
  }

  private updateRailToggleLabels(): void {
    for (const toggle of this.railRoot.querySelectorAll<HTMLButtonElement>("[data-rail-toggle]")) {
      toggle.textContent = this.railCompact ? "›" : "‹";
      toggle.title = this.railCompact ? "展开样品便签栏" : "收起样品便签栏";
      toggle.setAttribute("aria-label", toggle.title);
      toggle.setAttribute("aria-expanded", String(!this.railCompact));
    }
  }

  private applyRailModeWithoutRender(compact: boolean): void {
    this.railCompact = compact;
    this.layoutRoot.classList.toggle("is-rail-compact", compact);
    this.railListRoot.classList.toggle("is-compact", compact);
    this.railRoot.setAttribute("aria-expanded", String(!compact));
    this.updateRailToggleLabels();
  }

  private collapseRailForEditing(): void {
    if (this.railCompact) return;
    // Only switch presentation classes here. Re-rendering on pointer/focus would
    // replace the control the user is interacting with and can cancel the input.
    this.applyRailModeWithoutRender(true);
  }

  private async toggleRail(): Promise<void> {
    this.railCompact = !this.railCompact;
    await this.render();
  }

  private async select(sampleId: string, stageId: StageId): Promise<void> {
    this.expandedSampleIds.add(sampleId);
    await this.run(async () => { this.state = await this.controller.select(sampleId, stageId, this.options.now()); });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.setBusy(true);
    try { await work(); this.setStatus(""); await this.render(); }
    catch (error) { this.setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`, true); }
    finally { this.setBusy(false); }
  }

  private setBusy(busy: boolean): void { this.root.toggleAttribute("aria-busy", busy); }
  private setStatus(text: string, error = false): void {
    this.statusRoot.textContent = text;
    this.statusRoot.classList.toggle("is-error", error);
    this.statusRoot.hidden = text.length === 0;
  }

  private async leaveSession(): Promise<void> {
    const state = this.state; if (!state) return;
    if (!window.confirm("退出当前杯测？已输入内容会保留在本地，下次可继续。")) return;
    this.setBusy(true);
    try { await this.controller.leaveSession(); await this.options.onExit?.(state.sessionId); }
    catch (error) { this.setStatus(`退出前保存失败：${error instanceof Error ? error.message : String(error)}`, true); }
    finally { this.setBusy(false); }
  }

  private async openAccount(): Promise<void> {
    const state = this.state; if (!state) return;
    this.setBusy(true);
    try { await this.controller.leaveSession(); await this.options.onOpenAccount?.(state.sessionId); }
    catch (error) { this.setStatus(`打开账户前保存失败：${error instanceof Error ? error.message : String(error)}`, true); }
    finally { this.setBusy(false); }
  }

  private async finishFromEnd(): Promise<void> {
    await this.run(async () => {
      this.state = await this.controller.finishSession(this.options.now());
      await this.options.onSessionFinished?.(this.state.sessionId, this.state.finalRevisionId);
      await this.options.onOpenRecords?.();
    });
  }

  private railToggleButton(className: string): HTMLButtonElement {
    const toggle = button(className, this.railCompact ? "›" : "‹", () => this.toggleRail());
    toggle.dataset.railToggle = "true";
    toggle.title = this.railCompact ? "展开样品便签栏" : "收起样品便签栏";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(!this.railCompact));
    return toggle;
  }

  private renderRail(state: CuppingScreenState): void {
    clearElement(this.railRoot);
    this.layoutRoot.classList.toggle("is-rail-compact", this.railCompact);
    this.railRoot.setAttribute("aria-expanded", String(!this.railCompact));

    const tools = element("div", "cupping-rail-tools");
    tools.append(this.railToggleButton("cupping-rail-tools__toggle"));
    if (!this.railCompact) tools.append(button("cupping-rail-tools__action", "账户", () => this.openAccount()));
    this.railRoot.append(tools, this.railListRoot);

    renderSampleRail(this.railListRoot, state.rail, {
      select: (sampleId, stageId) => this.select(sampleId, stageId),
      toggleExpanded: async (sampleId) => {
        if (this.expandedSampleIds.has(sampleId)) this.expandedSampleIds.delete(sampleId);
        else this.expandedSampleIds.add(sampleId);
        await this.render();
      }
    }, { compact: this.railCompact, expandedSampleIds: this.expandedSampleIds });

    const controls = element("div", "cupping-rail-footer");
    controls.append(this.railToggleButton("cupping-rail-footer__toggle"));

    const actions = element("div", "cupping-rail-footer__actions");
    const exit = button("cupping-rail-footer__exit", "退出", () => this.leaveSession());
    exit.title = "暂时退出当前杯测，已录入内容保留为未完成记录";

    const finish = button("cupping-rail-footer__finish", "完成", () => this.finishFromEnd());
    const canFinish = state.sessionStatus !== "completed" && state.sessionStatus !== "archived" && this.controller.canFinishSession();
    finish.disabled = !canFinish;
    finish.title = canFinish
      ? "完成整场杯测并归入已完成记录"
      : "所有样品的全部杯测流程完成后才可结束整场杯测";
    actions.append(exit, finish);
    controls.append(actions);
    this.railRoot.append(controls);
    this.updateRailToggleLabels();
  }

  private renderStageStrip(state: CuppingScreenState, sampleId?: string, activeStageId?: StageId): void {
    clearElement(this.stageStripRoot);
    if (!sampleId || !activeStageId) { this.stageStripRoot.hidden = true; return; }
    const sample = state.rail.find((item) => item.sampleId === sampleId);
    if (!sample) { this.stageStripRoot.hidden = true; return; }
    this.stageStripRoot.hidden = false;
    for (const stage of sample.stages) {
      const active = stage.stageId === activeStageId;
      const step = button(`cupping-stage-step cupping-stage-step--${stage.tone} is-${stage.status}${active ? " is-current" : ""}`, stage.label, () => this.select(sampleId, stage.stageId));
      step.dataset.stageId = stage.stageId;
      step.setAttribute("aria-current", active ? "step" : "false");
      this.stageStripRoot.append(step);
    }
  }

  private renderBlindStatus(state: CuppingScreenState): HTMLElement | undefined {
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    if (mode === "open") return undefined;
    const revealed = isBlindSessionRevealed(state.sessionMetadata, state.sessionStatus);
    const banner = element("div", `cupping-main__blind-status is-${mode}${revealed ? " is-revealed" : ""}`);
    banner.append(element("strong", "cupping-main__blind-mode", blindModeLabel(mode)));
    if (revealed) {
      const revealedAt = state.sessionMetadata.revealedAt?.trim();
      banner.append(element("span", "cupping-main__blind-copy", revealedAt ? `已统一揭盲 · ${revealedAt}` : "已统一揭盲"));
    } else {
      banner.append(element("span", "cupping-main__blind-copy", blindModeDescription(mode)));
    }
    return banner;
  }

  private attachTagStackDrag(): void {
    const stack = this.editorRoot.querySelector<HTMLElement>(".selected-tag-stack");
    if (!stack || !stack.querySelector(".selected-tag-stack__item")) return;
    this.disposeSelectedStackDrag = attachDragReorder(stack, {
      itemSelector: ".selected-tag-stack__item",
      itemIdAttribute: "data-selected-id",
      onReorder: async (ids) => {
        this.collapseRailForEditing();
        await this.run(async () => { this.state = await this.controller.saveField("flavor_tags", ids, this.options.now()); });
      }
    });
  }

  private async render(): Promise<void> {
    const state = this.state; if (!state) return;
    this.disposeDragHandlers();
    this.renderRail(state);

    if (!this.railCompact && state.sessionStatus !== "completed" && state.sessionStatus !== "archived") {
      this.disposeRailDrag = attachDragReorder(this.railListRoot, {
        itemSelector: ".sample-rail__item",
        itemIdAttribute: "data-sample-id",
        onReorder: async (ids) => { await this.run(async () => { this.state = await this.controller.reorderSampleIds(ids, this.options.now()); }); }
      });
    }

    clearElement(this.headerRoot); clearElement(this.editorRoot); clearElement(this.footerRoot);
    this.footerRoot.classList.remove("is-two-action");
    this.renderStageStrip(state, state.active?.context.sampleId, state.active?.context.stageId);
    const blindStatus = this.renderBlindStatus(state); if (blindStatus) this.headerRoot.append(blindStatus);

    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") {
      const done = element("section", "cupping-empty");
      done.append(element("h2", "cupping-empty__title", "本次杯测已完成"), element("p", "cupping-empty__text", "记录已锁定为只读，可在杯测记录中复盘。盲测与半盲测会在整场完成后统一揭盲。"));
      this.editorRoot.append(done);
      this.footerRoot.append(button("cupping-nav cupping-nav--exit", "杯测记录", () => this.options.onOpenRecords?.()));
      return;
    }

    if (!state.active) {
      const empty = element("section", "cupping-empty");
      empty.append(element("h2", "cupping-empty__title", "选择一个样品开始记录"), element("p", "cupping-empty__text", "左侧编号用于切换样品；需要查看标签详情时展开侧栏，开始填写后会自动收回。"));
      this.editorRoot.append(empty);
      return;
    }

    const active = state.active;
    const sampleTitle = visibleSampleLabel(
      active.slice.sample.label,
      active.slice.sample.displayNumber,
      state.sessionMetadata,
      state.sessionStatus
    );
    const visibleMetadata = visibleSampleMetadata(active.slice.sample.metadata, state.sessionMetadata, state.sessionStatus);
    const stage = state.rail.find((item) => item.sampleId === active.context.sampleId)?.stages.find((item) => item.stageId === active.context.stageId);
    const titleBlock = element("div", "cupping-main__titles");
    titleBlock.append(element("h1", "cupping-main__sample-title", sampleTitle), element("p", `cupping-main__stage cupping-main__stage--${stage?.tone ?? "neutral"}`, stage?.label ?? active.context.stageId));
    const details = renderSampleDetails(visibleMetadata); if (details) titleBlock.append(details);
    this.headerRoot.append(element("div", "cupping-main__sample-number", String(active.slice.sample.displayNumber).padStart(2, "0")), titleBlock);

    const preferences = this.flavorPreferences ?? await this.flavorService.load();
    const callbacks = {
      saveField: async (fieldKey: string, value: unknown) => {
        this.collapseRailForEditing();
        await this.run(async () => { this.state = await this.controller.saveField(fieldKey, value, this.options.now()); });
      },
      setFlavorGroupCollapsed: async (groupId: string, collapsed: boolean) => {
        this.collapseRailForEditing();
        await this.run(async () => { this.flavorPreferences = await this.flavorService.setCollapsed(groupId, collapsed, this.options.now()); });
      }
    };

    if (active.context.stageId === "final") {
      renderFinalAssessment(this.editorRoot, {
        observations: active.slice.observations,
        flavorPreferences: preferences,
        callbacks,
        scoreProfile: scoreProfileForMetadata(state.sessionMetadata)
      });
    } else {
      renderSensoryEditor(this.editorRoot, { stageId: active.context.stageId, observations: active.slice.observations, flavorPreferences: preferences, callbacks });
    }

    const flavorGroups = this.editorRoot.querySelector<HTMLElement>(".flavor-groups");
    if (flavorGroups) {
      this.disposeFlavorDrag = attachDragReorder(flavorGroups, {
        itemSelector: ".flavor-group",
        itemIdAttribute: "data-group-id",
        onReorder: async (ids) => {
          this.collapseRailForEditing();
          await this.run(async () => { this.flavorPreferences = await this.flavorService.reorder(ids, this.options.now()); });
        }
      });
    }
    this.attachTagStackDrag();

    const previous = button("cupping-nav cupping-nav--previous", "上一步", () => this.run(async () => { this.state = await this.controller.goPrevious(this.options.now()); }));
    const finalPhase = active.context.stageId === "final" ? finalAssessmentPhase(active.slice.observations) : undefined;
    const next = button("cupping-nav cupping-nav--next", active.context.stageId === "final" ? "完成本样品" : "下一步", () =>
      this.run(async () => { this.state = await this.controller.goNext(this.options.now()); })
    );
    if (active.context.stageId === "final" && finalPhase !== "score") {
      next.disabled = true;
      next.title = "请依次完成风味描述、综评和评分";
    }
    this.footerRoot.classList.add("is-two-action");
    this.footerRoot.append(previous, next);
  }
}
