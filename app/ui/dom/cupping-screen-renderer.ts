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
}

export class CuppingScreenRenderer {
  private state?: CuppingScreenState;
  private flavorPreferences?: FlavorGroupPreferences;
  private disposeRailDrag?: () => void;
  private disposeFlavorDrag?: () => void;
  private disposeDescriptorDrags: (() => void)[] = [];
  private readonly railRoot = element("aside", "cupping-layout__rail");
  private readonly mainRoot = element("main", "cupping-layout__main");
  private readonly headerRoot = element("header", "cupping-main__header");
  private readonly editorRoot = element("div", "cupping-main__editor");
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
    this.mainRoot.append(this.headerRoot, this.statusRoot, this.editorRoot, this.footerRoot);
    const layout = element("div", "cupping-layout");
    layout.append(this.railRoot, this.mainRoot);
    this.root.append(layout);
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
    this.disposeFlavorDrag?.();
    for (const dispose of this.disposeDescriptorDrags) dispose();
    this.disposeDescriptorDrags = [];
  }

  private async select(sampleId: string, stageId: StageId): Promise<void> {
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

  private async render(): Promise<void> {
    const state = this.state;
    if (!state) return;

    this.disposeDragHandlers();
    renderSampleRail(this.railRoot, state.rail, {
      select: (sampleId, stageId) => this.select(sampleId, stageId)
    });
    this.disposeRailDrag = attachDragReorder(this.railRoot, {
      itemSelector: ".sample-rail__item",
      itemIdAttribute: "data-sample-id",
      onReorder: async (ids) => {
        await this.run(async () => {
          this.state = await this.controller.reorderSampleIds(ids, this.options.now());
        });
      }
    });

    clearElement(this.headerRoot);
    clearElement(this.editorRoot);
    clearElement(this.footerRoot);

    if (!state.active) {
      const empty = element("section", "cupping-empty");
      empty.append(
        element("h2", "cupping-empty__title", "选择一个样品开始记录"),
        element("p", "cupping-empty__text", "左侧样品可拖动排序；点击样品或温段进入记录。")
      );
      this.editorRoot.append(empty);
      return;
    }

    const active = state.active;
    const sampleTitle = active.slice.sample.label ?? `样品 ${active.slice.sample.displayNumber}`;
    const stage = state.rail
      .find((item) => item.sampleId === active.context.sampleId)
      ?.stages.find((item) => item.stageId === active.context.stageId);
    this.headerRoot.append(
      element("div", "cupping-main__sample-number", String(active.slice.sample.displayNumber).padStart(2, "0")),
      element("div", "cupping-main__titles")
    );
    const titles = this.headerRoot.querySelector<HTMLElement>(".cupping-main__titles");
    titles?.append(
      element("h1", "cupping-main__sample-title", sampleTitle),
      element("p", `cupping-main__stage cupping-main__stage--${stage?.tone ?? "neutral"}`, stage?.label ?? active.context.stageId)
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

    const previous = button("cupping-nav cupping-nav--previous", "上一步", () =>
      this.run(async () => { this.state = await this.controller.goPrevious(this.options.now()); })
    );
    const complete = button("cupping-nav cupping-nav--complete", "完成本段", () =>
      this.run(async () => { this.state = await this.controller.completeStage(this.options.now()); })
    );
    const next = button("cupping-nav cupping-nav--next", "下一步", () =>
      this.run(async () => {
        this.state = await this.controller.goNext(this.options.now());
        if (this.state.voicePrompt) this.options.voicePlayer?.play(this.state.voicePrompt);
      })
    );
    this.footerRoot.append(previous, complete, next);
  }
}
