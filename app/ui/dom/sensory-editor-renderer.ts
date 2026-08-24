import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import { DESCRIPTOR_GROUPS_V1 } from "../../core/sensory-dictionary-v1";
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
}

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

function renderTagPicker(
  value: unknown,
  preferences: FlavorGroupPreferences,
  callbacks: SensoryEditorCallbacks
): HTMLElement {
  const root = element("div", "flavor-groups");
  const selected = new Set(stringArray(value));
  const groups = new Map(DESCRIPTOR_GROUPS_V1.map((group) => [group.id, group] as const));

  for (const groupId of preferences.orderedGroupIds) {
    const group = groups.get(groupId);
    if (!group) continue;
    const collapsed = preferences.collapsedGroupIds.includes(groupId);
    const section = element("section", "flavor-group");
    section.dataset.groupId = groupId;
    section.draggable = true;

    const header = element("div", "flavor-group__header");
    const title = button("flavor-group__title", group.label, () =>
      callbacks.setFlavorGroupCollapsed(groupId, !collapsed)
    );
    title.setAttribute("aria-expanded", String(!collapsed));
    const handle = element("span", "flavor-group__drag", "⋮⋮");
    handle.setAttribute("aria-label", `拖动${group.label}分组`);
    header.append(title, handle);
    section.append(header);

    if (!collapsed) {
      const tags = element("div", "flavor-group__tags");
      tags.dataset.groupId = groupId;
      const byId = new Map(group.descriptors.map((descriptor) => [descriptor.id, descriptor] as const));
      const orderedIds = preferences.descriptorOrderByGroup[groupId]
        ?? group.descriptors.map((descriptor) => descriptor.id);
      for (const descriptorId of orderedIds) {
        const descriptor = byId.get(descriptorId);
        if (!descriptor) continue;
        const tag = button("flavor-tag", descriptor.label, () => {
          if (selected.has(descriptor.id)) selected.delete(descriptor.id);
          else selected.add(descriptor.id);
          void callbacks.saveField("flavor_tags", [...selected]);
          setPressed(tag, selected.has(descriptor.id));
        });
        tag.dataset.descriptorId = descriptor.id;
        tag.draggable = true;
        setPressed(tag, selected.has(descriptor.id));
        tags.append(tag);
      }
      section.append(tags);
    }
    root.append(section);
  }
  return root;
}

export function renderSensoryEditor(root: HTMLElement, input: SensoryEditorRenderInput): void {
  clearElement(root);
  const values = observationMap(input.observations);

  for (const spec of controlsForStage(input.stageId)) {
    const field = element("section", `sensory-field sensory-field--${spec.kind}`);
    const label = element("label", "sensory-field__label", spec.label);
    if (spec.required) label.dataset.required = "true";
    field.append(label);
    const value = values.get(spec.fieldKey);
    const save = (next: unknown) => void input.callbacks.saveField(spec.fieldKey, next);

    switch (spec.kind) {
      case "slider":
      case "score":
        field.append(renderRange(spec, value, (next) => save(next)));
        break;
      case "toggle":
        field.append(renderToggle(value, (next) => save(next)));
        break;
      case "text":
        field.append(renderText(value, (next) => save(next)));
        break;
      case "tag-picker":
        field.append(renderTagPicker(value, input.flavorPreferences, input.callbacks));
        break;
    }
    root.append(field);
  }
}
