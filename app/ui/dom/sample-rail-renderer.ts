import type { StageId } from "../../../shared/protocol/aromasense-v1";
import type { SampleRailItemViewState } from "../cupping-view-model";
import { button, clearElement, element } from "./dom-helpers";

export interface SampleRailCallbacks {
  select(sampleId: string, stageId: StageId): void | Promise<void>;
}

function preferredStage(item: SampleRailItemViewState): StageId {
  return item.stages.find((stage) => stage.status === "active")?.stageId
    ?? item.stages.find((stage) => stage.status === "not_started")?.stageId
    ?? item.stages[item.stages.length - 1]?.stageId
    ?? "preparation";
}

export function renderSampleRail(
  root: HTMLElement,
  items: readonly SampleRailItemViewState[],
  callbacks: SampleRailCallbacks
): void {
  clearElement(root);
  root.classList.add("sample-rail");

  for (const item of items) {
    const card = element("article", `sample-rail__item${item.active ? " is-active" : ""}`);
    card.dataset.sampleId = item.sampleId;
    card.draggable = true;

    const head = button("sample-rail__head", "", () => callbacks.select(item.sampleId, preferredStage(item)));
    const number = element("strong", "sample-rail__number", String(item.displayNumber).padStart(2, "0"));
    const label = element("span", "sample-rail__label", item.label ?? `样品 ${item.displayNumber}`);
    const count = element(
      "span",
      "sample-rail__count",
      `${item.completedStageCount}/${item.totalStageCount}`
    );
    head.append(number, label, count);

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
    card.append(head, stages, handle);
    root.append(card);
  }
}
