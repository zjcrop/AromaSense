import type { StageId } from "../../../shared/protocol/aromasense-v1";
import type { SampleSummaryReader } from "../../storage/sample-summary-reader";
import type { CuppingScreenController, CuppingScreenState } from "../cupping-screen-controller";
import type { FlavorGroupPreferenceService, FlavorGroupPreferences } from "../flavor-group-preferences";
import { buildRadarSummary } from "../sample-summary-model";
import type { VoicePromptPlayer } from "./browser-voice";
import { attachDragReorder } from "./drag-reorder";
import { button, clearElement, element } from "./dom-helpers";
import { renderRadarSummary } from "./radar-renderer";
import { renderSampleRail } from "./sample-rail-renderer";
import { renderSensoryEditor } from "./sensory-editor-renderer";

export interface CuppingScreenRendererOptions {
  now(): string;
  voicePlayer?: VoicePromptPlayer;
  onSessionFinished?(sessionId: string, finalRevisionId?: string): void | Promise<void>;
  onExit?(sessionId: string): void | Promise<void>;
  onOpenAccount?(sessionId: string): void | Promise<void>;
  onSync?(): void | Promise<void>;
  syncLabel?: string;
}

const SAMPLE_DETAIL_FIELDS: readonly [string, string][] = [
  ["country", "国家"],
  ["region", "产区"],
  ["farm", "庄园/处理站"],
  ["variety", "品种"],
  ["process", "处理法"],
  ["roastDate", "烘焙日期"],
  ["altitude", "海拔"],
  ["flavorNotes", "风味"]
];

function readableMetadataValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }
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
    chip.append(
      element("small", "cupping-main__sample-detail-label", item.label),
      element("span", "cupping-main__sample-detail-value", item.value)
    );
    details.append(chip);
  }
  return details;
}

export class CuppingScreenRenderer {
  private state?: CuppingScreenState;
  private flavorPreferences?: FlavorGroupPreferences;
  private disposeRailDrag?: () => void;
  private disposeFlavorDrag?: () => void;
  private disposeDescriptorDrags: (() => void)[] = [];
  private railCompact = false;
  private readonly expandedSampleIds = new Set<string>();
  private readonly layoutRoot = element("div", "cupping-layout");
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
    this.root.classList.add("aromasense-cupping");
    this.stageStripRoot.setAttribute("aria-label", "杯测流程");
    this.mainRoot.append(this.headerRoot, this.statusRoot, this.editorRoot, this.stageStripRoot, this.footerRoot);
    this.layoutRoot.append(this.railRoot, this.mainRoot);
    this.root.append(this.layoutRoot);
  }

  async initialize(sessionId: string): Promise<void> {
    this.flavorPreferences = await this.flavorService.load();
    this.state = await this.controller.initialize(sessionId);
    await this.render();
  }

  dispose(): void {
    this.disposeDragHandlers();
    this.options.voicePlayer?.cancel();
  }

  private disposeDragHandlers(): void {
    this.disposeRailDrag?.();
    this.disposeRailDrag = undefined;
    this.disposeFlavorDrag?.();
    this.disposeFlavorDrag = undefined;
    for (const dispose of this.disposeDescriptorDrags) dispose();
    this.disposeDescriptorDrags = [];
  }

  private async select(sampleId: string, stageId: StageId): Promise<void> {
    this.expandedSampleIds.add(sampleId);
    await this.run(async () => {
      this.state = await this.controller.select(sampleId, stageId, this.options.now());
      if (this.state.voicePrompt) this.options.voicePlayer?.play(this.state.voicePrompt);
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.setBusy(true);
    try {
      await work();
      this.setStatus("");
      await this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`保存失败：${message}`, true);
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.root.toggleAttribute("aria-busy", busy);
  }

  private setStatus(text: string, error = false): void {
    this.statusRoot.textContent = text;
    this.statusRoot.classList.toggle("is-error", error);
    this.statusRoot.hidden = text.length === 0;
  }

  private async leaveSession(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const confirmed = window.confirm("退出当前杯测？已输入内容会保留在本地，下次可从“继续未完成杯测”恢复。");
    if (!confirmed) return;
    this.setBusy(true);
    try {
      await this.controller.leaveSession();
      this.options.voicePlayer?.cancel();
      await this.options.onExit?.(state.sessionId);
    } catch (error) {
      this.setStatus(`退出前保存失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      this.setBusy(false);
    }
  }

  private async openAccount(): Promise<void> {
    const state = this.state;
    if (!state) return;
    this.setBusy(true);
    try {
      await this.controller.leaveSession();
      this.options.voicePlayer?.cancel();
      await this.options.onOpenAccount?.(state.sessionId);
    } catch (error) {
      this.setStatus(`打开账户前保存失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      this.setBusy(false);
    }
  }

  private async syncNow(): Promise<void> {
    this.setBusy(true);
    try {
      await this.options.onSync?.();
      this.setStatus("已执行同步检查；未配置云端或未登录时，本地记录保持不变。");
    } catch (error) {
      this.setStatus(`同步失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      this.setBusy(false);
    }
  }

  private renderRail(state: CuppingScreenState): void {
    clearElement(this.railRoot);
    this.layoutRoot.classList.toggle("is-rail-compact", this.railCompact);

    const tools = element("div", "cupping-rail-tools");
    const toggle = button("cupping-rail-tools__toggle", this.railCompact ? "›" : "‹", async () => {
      this.railCompact = !this.railCompact;
      await this.render();
    });
    toggle.title = this.railCompact ? "展开样品便签栏" : "收起样品便签栏";
    tools.append(toggle);
    if (!this.railCompact) {
      tools.append(
        button("cupping-rail-tools__action", "账户", () => this.openAccount()),
        button("cupping-rail-tools__action", this.options.syncLabel ?? "同步", () => this.syncNow())
      );
    }
    this.railRoot.append(tools, this.railListRoot);

    renderSampleRail(this.railListRoot, state.rail, {
      select: (sampleId, stageId) => this.select(sampleId, stageId),
      toggleExpanded: async (sampleId) => {
        if (this.expandedSampleIds.has(sampleId)) this.expandedSampleIds.delete(sampleId);
        else this.expandedSampleIds.add(sampleId);
        await this.render();
      }
    }, {
      compact: this.railCompact,
      expandedSampleIds: this.expandedSampleIds
    });
  }

  private renderStageStrip(state: CuppingScreenState, sampleId?: string, activeStageId?: StageId): void {
    clearElement(this.stageStripRoot);
    if (!sampleId || !activeStageId) {
      this.stageStripRoot.hidden = true;
      return;
    }
    const sample = state.rail.find((item) => item.sampleId === sampleId);
    if (!sample) {
      this.stageStripRoot.hidden = true;
      return;
    }
    this.stageStripRoot.hidden = false;
    for (const stage of sample.stages) {
      const active = stage.stageId === activeStageId;
      const step = button(
        `cupping-stage-step cupping-stage-step--${stage.tone} is-${stage.status}${active ? " is-current" : ""}`,
        stage.label,
        () => this.select(sampleId, stage.stageId)
      );
      step.dataset.stageId = stage.stageId;
      step.setAttribute("aria-current", active ? "step" : "false");
      step.title = `${stage.label} · ${stage.status === "completed" ? "已完成" : stage.status === "active" ? "进行中" : "未开始"}`;
      this.stageStripRoot.append(step);
    }
  }

  private async render(): Promise<void> {
    const state = this.state;
    if (!state) return;

    this.disposeDragHandlers();
    this.renderRail(state);

    if (!this.railCompact && state.sessionStatus !== "completed" && state.sessionStatus !== "archived") {
      this.disposeRailDrag = attachDragReorder(this.railListRoot, {
        itemSelector: ".sample-rail__item",
        itemIdAttribute: "data-sample-id",
        onReorder: async (ids) => {
          await this.run(async () => {
            this.state = await this.controller.reorderSampleIds(ids, this.options.now());
          });
        }
      });
    }

    clearElement(this.headerRoot);
    clearElement(this.editorRoot);
    clearElement(this.footerRoot);
    this.renderStageStrip(state, state.active?.context.sampleId, state.active?.context.stageId);

    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") {
      const done = element("section", "cupping-empty");
      done.append(
        element("h2", "cupping-empty__title", "本次杯测已完成"),
        element("p", "cupping-empty__text", state.finalRevisionId ? `最终修订：${state.finalRevisionId}` : "本地记录已锁定为只读。")
      );
      this.editorRoot.append(done);
      this.footerRoot.append(button("cupping-nav cupping-nav--exit", "返回", () => this.options.onExit?.(state.sessionId)));
      return;
    }

    if (!state.active) {
      const empty = element("section", "cupping-empty");
      empty.append(
        element("h2", "cupping-empty__title", "选择一个样品开始记录"),
        element("p", "cupping-empty__text", "左侧便签点击进入样品，展开后可直接切换温段；便签栏可整体收起。")
      );
      this.editorRoot.append(empty);
      this.footerRoot.append(button("cupping-nav cupping-nav--exit", "退出杯测", () => this.leaveSession()));
      return;
    }

    const active = state.active;
    const sampleTitle = active.slice.sample.label ?? `样品 ${active.slice.sample.displayNumber}`;
    const stage = state.rail
      .find((item) => item.sampleId === active.context.sampleId)
      ?.stages.find((item) => item.stageId === active.context.stageId);
    const titleBlock = element("div", "cupping-main__titles");
    titleBlock.append(
      element("h1", "cupping-main__sample-title", sampleTitle),
      element("p", `cupping-main__stage cupping-main__stage--${stage?.tone ?? "neutral"}`, stage?.label ?? active.context.stageId)
    );
    const details = renderSampleDetails(active.slice.sample.metadata);
    if (details) titleBlock.append(details);
    this.headerRoot.append(
      element("div", "cupping-main__sample-number", String(active.slice.sample.displayNumber).padStart(2, "0")),
      titleBlock
    );

    const preferences = this.flavorPreferences ?? await this.flavorService.load();
    renderSensoryEditor(this.editorRoot, {
      stageId: active.context.stageId,
      observations: active.slice.observations,
      flavorPreferences: preferences,
      callbacks: {
        saveField: async (fieldKey, value) => {
          await this.run(async () => {
            this.state = await this.controller.saveField(fieldKey, value, this.options.now());
          });
        },
        setFlavorGroupCollapsed: async (groupId, collapsed) => {
          await this.run(async () => {
            this.flavorPreferences = await this.flavorService.setCollapsed(groupId, collapsed, this.options.now());
          });
        }
      }
    });

    if (active.context.stageId === "final") {
      const observations = await this.summaryReader.listObservations(active.context.sampleId);
      const summaryRoot = element("div", "cupping-main__summary");
      renderRadarSummary(summaryRoot, buildRadarSummary(observations));
      this.editorRoot.prepend(summaryRoot);
    }

    const flavorGroups = this.editorRoot.querySelector<HTMLElement>(".flavor-groups");
    if (flavorGroups) {
      this.disposeFlavorDrag = attachDragReorder(flavorGroups, {
        itemSelector: ".flavor-group",
        itemIdAttribute: "data-group-id",
        onReorder: async (ids) => {
          await this.run(async () => {
            this.flavorPreferences = await this.flavorService.reorder(ids, this.options.now());
          });
        }
      });
    }

    for (const tags of this.editorRoot.querySelectorAll<HTMLElement>(".flavor-group__tags")) {
      const groupId = tags.dataset.groupId;
      if (!groupId) continue;
      this.disposeDescriptorDrags.push(
        attachDragReorder(tags, {
          itemSelector: ".flavor-tag",
          itemIdAttribute: "data-descriptor-id",
          onReorder: async (ids) => {
            await this.run(async () => {
              this.flavorPreferences = await this.flavorService.reorderDescriptors(groupId, ids, this.options.now());
            });
          }
        })
      );
    }

    const exit = button("cupping-nav cupping-nav--exit", "退出杯测", () => this.leaveSession());
    const previous = button("cupping-nav cupping-nav--previous", "上一步", () =>
      this.run(async () => { this.state = await this.controller.goPrevious(this.options.now()); })
    );
    const nextLabel = active.context.stageId === "final" ? "完成本样品" : "下一步";
    const next = button("cupping-nav cupping-nav--next", nextLabel, () =>
      this.run(async () => {
        this.state = await this.controller.goNext(this.options.now());
        if (this.state.voicePrompt) this.options.voicePlayer?.play(this.state.voicePrompt);
      })
    );
    this.footerRoot.append(exit, previous, next);

    if (this.controller.canFinishSession()) {
      const finish = button("cupping-nav cupping-nav--finish", "结束杯测并生成备份", () =>
        this.run(async () => {
          this.state = await this.controller.finishSession(this.options.now());
          await this.options.onSessionFinished?.(this.state.sessionId, this.state.finalRevisionId);
        })
      );
      this.footerRoot.append(finish);
    }
  }
}
