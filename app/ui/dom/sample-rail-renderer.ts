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

function currentStage(item: SampleRailItemViewState) {
  return item.stages.find((stage) => stage.status === "active")
    ?? item.stages.find((stage) => stage.status === "not_started")
    ?? [...item.stages].reverse().find((stage) => stage.status === "completed")
    ?? item.stages[0];
}

function progressTone(item: SampleRailItemViewState): string {
  return currentStage(item)?.tone ?? "neutral";
}

function shortLabel(item: SampleRailItemViewState): string {
  const raw = (item.label ?? `样品 ${item.displayNumber}`).trim();
  return raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;
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
    const explicitlyExpanded = options.expandedSampleIds?.has(item.sampleId) ?? false;
    const expanded = !options.compact && (explicitlyExpanded || item.active);
    const stage = currentStage(item);
    const card = element(
      "article",
      `sample-rail__item sample-rail__item--${progressTone(item)}${item.active ? " is-active" : ""}${expanded ? " is-expanded" : " is-collapsed"}`
    );
    card.dataset.sampleId = item.sampleId;

    const select = button("sample-rail__select", "", () => callbacks.select(item.sampleId, preferredStage(item)));
    select.append(element("strong", "sample-rail__number", String(item.displayNumber).padStart(2, "0")));
    if (expanded) {
      const text = element("span", "sample-rail__active-copy");
      text.append(
        element("span", "sample-rail__label", shortLabel(item)),
        element("small", `sample-rail__stage sample-rail__stage--${stage?.tone ?? "neutral"}`, stage?.label ?? "准备")
      );
      select.append(text);
    }

    const stateDot = element("span", `sample-rail__state-dot sample-rail__state-dot--${stage?.tone ?? "neutral"}`);
    stateDot.title = stage ? `${stage.label}：${stage.status}` : "尚未开始";
    select.append(stateDot);

    const actions = element("div", "sample-rail__actions");
    if (!options.compact) {
      if (expanded) {
        const collapse = button("sample-rail__expand", "‹", () => callbacks.toggleExpanded(item.sampleId));
        collapse.setAttribute("aria-expanded", "true");
        collapse.title = "收起样品便签";
        actions.append(collapse);
      }
      const drag = button("sample-rail__drag", "●", () => undefined);
      drag.type = "button";
      drag.dataset.dragHandle = "sample";
      drag.setAttribute("aria-label", `拖动样品 ${item.displayNumber}`);
      drag.title = `长按拖动样品 ${item.displayNumber}`;
      actions.append(drag);
    }

    card.append(select);
    if (actions.childElementCount) card.append(actions);
    root.append(card);
  }
}
