import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import { DESCRIPTOR_GROUPS_V1, type SensoryAssessmentLayer } from "../../core/sensory-dictionary-v1";
import type { FlavorGroupPreferences } from "../flavor-group-preferences";
import { controlsForStage, type SensoryControlSpec } from "../sensory-control-model";
import { button, clearElement, element, setPressed } from "./dom-helpers";

export interface SensoryEditorCallbacks {
  saveField(fieldKey: string, value: unknown): void | Promise<void>;
  setFlavorGroupCollapsed(groupId: string, collapsed: boolean): void | Promise<void>;
}

export interface SensoryEditorRenderInput {
  stageId: Parameters<typeof controlsForStage>[0];
  observations: readonly SensoryObservation[];
  flavorPreferences: FlavorGroupPreferences;
  callbacks: SensoryEditorCallbacks;
  fieldFilter?: ReadonlySet<string>;
}

const LAYER_LABELS: Partial<Record<SensoryAssessmentLayer, string>> = {
  descriptive: "描述性记录",
  affective: "质量印象",
  notes: "补充记录"
};

function observationMap(observations: readonly SensoryObservation[]): Map<string, unknown> {
  return new Map(observations.map((item) => [item.fieldKey, item.value] as const));
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function renderRange(spec: SensoryControlSpec, value: unknown, onSave: (value: number) => void): HTMLElement {
  const wrap = element("div", "sensory-range");
  const output = element("output", "sensory-range__value");
  const input = element("input", "sensory-range__input");
  input.type = "range";
  input.min = String(spec.min ?? 0);
  input.max = String(spec.max ?? 10);
  input.step = String(spec.step ?? 0.5);
  input.value = String(numberValue(value, spec.min ?? 0));
  output.value = input.value;
  input.addEventListener("input", () => { output.value = input.value; });
  input.addEventListener("change", () => onSave(Number(input.value)));
  wrap.append(input, output);
  return wrap;
}

function renderToggle(value: unknown, onSave: (value: boolean) => void): HTMLElement {
  const node = button("sensory-toggle", value === true ? "有" : "无", () => {
    const next = node.getAttribute("aria-pressed") !== "true";
    setPressed(node, next);
    node.textContent = next ? "有" : "无";
    onSave(next);
  });
  setPressed(node, value === true);
  return node;
}

function renderText(value: unknown, onSave: (value: string) => void): HTMLElement {
  const node = element("textarea", "sensory-text");
  node.rows = 3;
  node.value = typeof value === "string" ? value : "";
  node.addEventListener("change", () => onSave(node.value));
  return node;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function renderTagPicker(value: unknown, preferences: FlavorGroupPreferences, callbacks: SensoryEditorCallbacks): HTMLElement {
  const root = element("div", "flavor-groups");
  const orderedSelected = stringArray(value);
  const selected = new Set(orderedSelected);
  const groups = new Map(DESCRIPTOR_GROUPS_V1.map((group) => [group.id, group] as const));
  const descriptorLabels = new Map(DESCRIPTOR_GROUPS_V1.flatMap((group) => group.descriptors.map((item) => [item.id, item.label] as const)));

  const stack = element("section", "selected-tag-stack-wrap");
  stack.append(element("h3", "selected-tag-stack__title", "已选标签"));
  const stackList = element("div", "selected-tag-stack");
  stackList.dataset.fieldKey = "flavor_tags";
  for (const descriptorId of orderedSelected) {
    const item = element("span", "selected-tag-stack__item");
    item.dataset.selectedId = descriptorId;
    item.append(
      element("span", "selected-tag-stack__label", descriptorLabels.get(descriptorId) ?? descriptorId),
      button("selected-tag-stack__drag", "●", () => undefined)
    );
    item.querySelector<HTMLButtonElement>("button")!.dataset.dragHandle = "selected-tag";
    stackList.append(item);
  }
  if (!orderedSelected.length) stackList.append(element("span", "selected-tag-stack__empty", "尚未选择"));
  stack.append(stackList);
  root.append(stack);

  for (const groupId of preferences.orderedGroupIds) {
    const group = groups.get(groupId);
    if (!group) continue;
    const collapsed = preferences.collapsedGroupIds.includes(groupId);
    const section = element("section", "flavor-group");
    section.dataset.groupId = groupId;

    const header = element("div", "flavor-group__header");
    const title = button("flavor-group__title", group.label, () => callbacks.setFlavorGroupCollapsed(groupId, !collapsed));
    title.setAttribute("aria-expanded", String(!collapsed));
    const handle = button("flavor-group__drag", "●", () => undefined);
    handle.type = "button";
    handle.dataset.dragHandle = "group";
    handle.setAttribute("aria-label", `拖动${group.label}分组`);
    header.append(title, handle);
    section.append(header);

    if (!collapsed) {
      const tags = element("div", "flavor-group__tags");
      tags.dataset.groupId = groupId;
      const byId = new Map(group.descriptors.map((descriptor) => [descriptor.id, descriptor] as const));
      const orderedIds = preferences.descriptorOrderByGroup[groupId] ?? group.descriptors.map((descriptor) => descriptor.id);
      for (const descriptorId of orderedIds) {
        const descriptor = byId.get(descriptorId);
        if (!descriptor) continue;
        const item = element("span", "flavor-tag-item");
        item.dataset.descriptorId = descriptor.id;
        const tag = button("flavor-tag", descriptor.label, () => {
          const next = [...orderedSelected];
          const existing = next.indexOf(descriptor.id);
          if (existing >= 0) next.splice(existing, 1); else next.push(descriptor.id);
          void callbacks.saveField("flavor_tags", next);
          setPressed(tag, existing < 0);
        });
        setPressed(tag, selected.has(descriptor.id));
        tags.append(item);
        item.append(tag);
      }
      section.append(tags);
    }
    root.append(section);
  }
  return root;
}

function renderControl(spec: SensoryControlSpec, value: unknown, input: SensoryEditorRenderInput): HTMLElement {
  const field = element("section", `sensory-field sensory-field--${spec.kind}`);
  field.dataset.assessmentLayer = spec.assessmentLayer;
  const label = element("label", "sensory-field__label", spec.label);
  if (spec.required) label.dataset.required = "true";
  field.append(label);
  const save = (next: unknown) => void input.callbacks.saveField(spec.fieldKey, next);
  switch (spec.kind) {
    case "slider":
    case "score": field.append(renderRange(spec, value, (next) => save(next))); break;
    case "toggle": field.append(renderToggle(value, (next) => save(next))); break;
    case "text": field.append(renderText(value, (next) => save(next))); break;
    case "tag-picker": field.append(renderTagPicker(value, input.flavorPreferences, input.callbacks)); break;
  }
  return field;
}

export function renderSensoryEditor(root: HTMLElement, input: SensoryEditorRenderInput): void {
  clearElement(root);
  const values = observationMap(input.observations);
  const controls = controlsForStage(input.stageId).filter((spec) => !input.fieldFilter || input.fieldFilter.has(spec.fieldKey));
  let activeLayer: SensoryAssessmentLayer | undefined;

  for (const spec of controls) {
    if (spec.assessmentLayer !== activeLayer) {
      activeLayer = spec.assessmentLayer;
      const label = LAYER_LABELS[activeLayer];
      if (label) {
        const heading = element("div", `sensory-layer sensory-layer--${activeLayer}`);
        heading.append(
          element("h2", "sensory-layer__title", label),
          element("p", "sensory-layer__note", activeLayer === "descriptive"
            ? "记录感知到的属性与强度，不表达喜欢或质量高低。"
            : activeLayer === "affective" ? "独立评价质量印象，不替代描述性强度记录。" : "")
        );
        root.append(heading);
      }
    }
    root.append(renderControl(spec, values.get(spec.fieldKey), input));
  }
}
