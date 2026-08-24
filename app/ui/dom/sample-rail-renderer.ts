import type { StageId } from "../../../shared/protocol/aromasense-v1";
import type { SampleRailItemViewState } from "../cupping-view-model";
import { button, clearElement, element } from "./dom-helpers";

export interface SampleRailCallbacks {
  select(sampleId: string, stageId: StageId): void | Promise<void>;
  toggleExpanded(sampleId: string): void | Promise<void>;
}

export interface SampleRailRenderOptions {
  compact?: boolean;
  expandedSampleIds?: ReadonlySet<string>;
}

function preferredStage(item: SampleRailItemViewState): StageId {
  return item.stages.find((stage) => stage.status === "active")?.stageId
    ?? item.stages.find((stage) => stage.status === "not_started")?.stageId
    ?? item.stages[item.stages.length - 1]?.stageId
    ?? "preparation";
}

function progressTone(item: SampleRailItemViewState): string {
  const active = item.stages.find((stage) => stage.status === "active")
    ?? [...item.stages].reverse().find((stage) => stage.status === "completed");
  return active?.tone ?? "neutral";
}

export function renderSampleRail(
  root: HTMLElement,
  items: readonly SampleRailItemViewState[],
  callbacks: SampleRailCallbacks,
  options: SampleRailRenderOptions = {}
): void {
  clearElement(root);
  root.classList.add("sample-rail");
  root.classList.toggle("is-compact", Boolean(options.compact));

  for (const item of items) {
    const expanded = !options.compact && (options.expandedSampleIds?.has(item.sampleId) ?? item.active);
    const card = element(
      "article",
      `sample-rail__item sample-rail__item--${progressTone(item)}${item.active ? " is-active" : ""}${expanded ? " is-expanded" : " is-collapsed"}`
    );
    card.dataset.sampleId = item.sampleId;
    card.draggable = !options.compact;

    const head = element("div", "sample-rail__head");
    const select = button("sample-rail__select", "", () => callbacks.select(item.sampleId, preferredStage(item)));
    const number = element("strong", "sample-rail__number", String(item.displayNumber).padStart(2, "0"));
    const label = element("span", "sample-rail__label", item.label ?? `样品 ${item.displayNumber}`);
    const count = element("span", "sample-rail__count", `${item.completedStageCount}/${item.totalStageCount}`);
    select.append(number, label, count);
    head.append(select);

    if (!options.compact) {
      const expand = button("sample-rail__expand", expanded ? "收" : "展", () => callbacks.toggleExpanded(item.sampleId));
      expand.setAttribute("aria-expanded", String(expanded));
      expand.title = expanded ? "收起样品便签" : "展开样品便签";
      head.append(expand);
    }

    const progress = element("div", "sample-rail__progress");
    for (const stage of item.stages) {
      const dot = element("span", `sample-rail__progress-dot sample-rail__progress-dot--${stage.tone} is-${stage.status}`);
      dot.title = `${stage.label}：${stage.status}`;
      progress.append(dot);
    }

    card.append(head, progress);

    if (expanded) {
      const stages = element("div", "sample-rail__stages");
      for (const stage of item.stages) {
        const stageButton = button(
          `stage-chip stage-chip--${stage.tone} stage-chip--${stage.status}`,
          stage.label,
          () => callbacks.select(item.sampleId, stage.stageId)
        );
        stageButton.dataset.stageId = stage.stageId;
        stageButton.title = `${stage.label}：${stage.status}`;
        stages.append(stageButton);
      }
      const handle = element("span", "sample-rail__drag", "⋮⋮");
      handle.setAttribute("aria-label", `拖动样品 ${item.displayNumber}`);
      card.append(stages, handle);
    }

    root.append(card);
  }
}
