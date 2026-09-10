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
  /** SCA uses one shared Fragrance/Aroma CATA list; free cupping keeps source-specific labels. */
  aromaTagMode?: "shared" | "classified";
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

function noteParagraphs(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}

function notePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 10 ? `${normalized.slice(0, 10)}……` : normalized;
}

function renderParagraphNotes(value: unknown, onSave: (value: string) => void): HTMLElement {
  const root = element("div", "sensory-note-composer");
  const list = element("div", "sensory-note-composer__list");
  const add = button("sensory-note-composer__add", "记", () => openEditor(paragraphs.length));
  add.type = "button";
  add.title = "新增一段当前节点笔记";
  const editor = element("textarea", "sensory-note-composer__editor");
  editor.rows = 3;
  editor.hidden = true;
  let paragraphs = noteParagraphs(value);
  let editingIndex = -1;

  const persist = (): void => onSave(paragraphs.join("\n\n"));
  const renderList = (): void => {
    clearElement(list);
    paragraphs.forEach((paragraph, index) => {
      const row = button("sensory-note-composer__row", notePreview(paragraph), () => openEditor(index));
      row.type = "button";
      row.title = paragraph;
      list.append(row);
    });
  };
  const closeEditor = (save = true): void => {
    if (editingIndex < 0) return;
    const normalized = editor.value.trim();
    const existed = editingIndex < paragraphs.length;
    if (normalized) {
      if (existed) paragraphs[editingIndex] = normalized;
      else paragraphs.push(normalized);
    } else if (existed) {
      paragraphs.splice(editingIndex, 1);
    }
    editingIndex = -1;
    editor.hidden = true;
    editor.value = "";
    renderList();
    if (save) persist();
  };
  function openEditor(index: number): void {
    if (editingIndex >= 0) closeEditor(true);
    editingIndex = Math.max(0, Math.min(index, paragraphs.length));
    editor.value = editingIndex < paragraphs.length ? paragraphs[editingIndex]! : "";
    editor.hidden = false;
    queueMicrotask(() => editor.focus());
  }
  editor.addEventListener("blur", () => closeEditor(true));
  renderList();
  root.append(list, add, editor);
  return root;
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
  fieldKey: string,
  label: string,
  value: unknown,
  preferences: FlavorGroupPreferences,
  callbacks: SensoryEditorCallbacks,
  maxSelected?: number
): HTMLElement {
  const root = element("div", "flavor-groups");
  const orderedSelected = stringArray(value);
  const selected = new Set(orderedSelected);
  const descriptorLabels = new Map(DESCRIPTOR_GROUPS_V1.flatMap((group) => group.descriptors.map((item) => [item.id, item.label] as const)));

  const stack = element("section", "selected-tag-stack-wrap");
  stack.append(element("h3", "selected-tag-stack__title", `已选${label}`));
  if (maxSelected) stack.append(element("p", "selected-tag-stack__limit", `最多 ${maxSelected} 项；顺序固定，重复点击可取消。`));
  const stackList = element("div", "selected-tag-stack");
  stackList.dataset.fieldKey = fieldKey;
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

  // Global taxonomy order is intentionally fixed. Personal usage history may
  // collapse groups, but must never move categories/descriptors under the hand.
  for (const group of DESCRIPTOR_GROUPS_V1) {
    const collapsed = preferences.collapsedGroupIds.includes(group.id);
    const section = element("section", "flavor-group");
    section.dataset.groupId = group.id;

    const header = element("div", "flavor-group__header");
    const title = button("flavor-group__title", group.label, () => callbacks.setFlavorGroupCollapsed(group.id, !collapsed));
    title.setAttribute("aria-expanded", String(!collapsed));
    header.append(title);
    section.append(header);

    if (!collapsed) {
      const tags = element("div", "flavor-group__tags");
      tags.dataset.groupId = group.id;
      for (const descriptor of group.descriptors) {
        const item = element("span", "flavor-tag-item");
        item.dataset.descriptorId = descriptor.id;
        const tag = button("flavor-tag", descriptor.label, () => {
          const next = [...orderedSelected];
          const existing = next.indexOf(descriptor.id);
          if (existing >= 0) next.splice(existing, 1);
          else {
            if (maxSelected && next.length >= maxSelected) return;
            next.push(descriptor.id);
          }
          void callbacks.saveField(fieldKey, next);
          setPressed(tag, existing < 0);
        });
        setPressed(tag, selected.has(descriptor.id));
        if (maxSelected && orderedSelected.length >= maxSelected && !selected.has(descriptor.id)) tag.title = `最多选择 ${maxSelected} 项`;
        tags.append(item);
        item.append(tag);
      }
      section.append(tags);
    }
    root.append(section);
  }
  return root;
}

function renderControl(spec: SensoryControlSpec, value: unknown, input: SensoryEditorRenderInput, maxSelected?: number): HTMLElement {
  const field = element("section", `sensory-field sensory-field--${spec.kind}`);
  field.dataset.assessmentLayer = spec.assessmentLayer;
  field.dataset.fieldKey = spec.fieldKey;
  const label = element("label", "sensory-field__label", spec.label);
  if (spec.required) {
    label.dataset.required = "true";
    const required = element("span", "sensory-field__required", "＊");
    required.setAttribute("aria-label", "必填");
    label.append(required);
  }
  field.append(label);
  const save = (next: unknown) => void input.callbacks.saveField(spec.fieldKey, next);
  switch (spec.kind) {
    case "slider":
    case "score": field.append(renderRange(spec, value, (next) => save(next))); break;
    case "toggle": field.append(renderToggle(value, (next) => save(next))); break;
    case "text": field.append(spec.fieldKey === "notes" ? renderParagraphNotes(value, (next) => save(next)) : renderText(value, (next) => save(next))); break;
    case "tag-picker": field.append(renderTagPicker(spec.fieldKey, spec.label, value, input.flavorPreferences, input.callbacks, maxSelected)); break;
  }
  return field;
}

export function renderSensoryEditor(root: HTMLElement, input: SensoryEditorRenderInput): void {
  clearElement(root);
  const values = observationMap(input.observations);
  const appMode = typeof document !== "undefined" ? document.getElementById("app")?.dataset.cuppingMode : undefined;
  const aromaTagMode = input.aromaTagMode ?? (appMode === "free" ? "classified" : "shared");
  const controls = controlsForStage(input.stageId)
    .filter((spec) => !input.fieldFilter || input.fieldFilter.has(spec.fieldKey))
    .filter((spec) => input.stageId !== "aroma"
      ? true
      : aromaTagMode === "shared"
        ? !["dry_fragrance_tags", "wet_aroma_tags"].includes(spec.fieldKey)
        : spec.fieldKey !== "flavor_tags");

  if (input.stageId === "aroma") {
    if (aromaTagMode === "shared") {
      const dry = element("section", "sensory-aroma-phase sensory-aroma-phase--dry");
      dry.dataset.aromaPhase = "dry";
      dry.append(
        element("h2", "sensory-aroma-phase__title", "干香 · Fragrance"),
        element("p", "sensory-aroma-phase__note", "注水前记录干香强度。")
      );
      const drySpec = controls.find((item) => item.fieldKey === "dry_fragrance_intensity");
      if (drySpec) dry.append(renderControl(drySpec, values.get(drySpec.fieldKey), input));
      root.append(dry);

      const wet = element("section", "sensory-aroma-phase sensory-aroma-phase--wet");
      wet.dataset.aromaPhase = "wet";
      wet.append(
        element("h2", "sensory-aroma-phase__title", "湿香 · Aroma"),
        element("p", "sensory-aroma-phase__note", "注水并破渣时记录湿香强度。")
      );
      const wetSpec = controls.find((item) => item.fieldKey === "wet_aroma_intensity");
      if (wetSpec) wet.append(renderControl(wetSpec, values.get(wetSpec.fieldKey), input));
      root.append(wet);

      const shared = element("section", "sensory-aroma-phase sensory-aroma-phase--shared");
      shared.dataset.aromaPhase = "shared";
      shared.append(
        element("h2", "sensory-aroma-phase__title", "Fragrance / Aroma 香气类别"),
        element("p", "sensory-aroma-phase__note", "SCA正式流程共用一套 CATA 香气类别，合计最多选择 5 项。")
      );
      const tagSpec = controls.find((item) => item.fieldKey === "flavor_tags");
      if (tagSpec) shared.append(renderControl(tagSpec, values.get(tagSpec.fieldKey), input, 5));
      root.append(shared);

      for (const spec of controls.filter((item) => !["dry_fragrance_intensity", "wet_aroma_intensity", "flavor_tags"].includes(item.fieldKey))) {
        root.append(renderControl(spec, values.get(spec.fieldKey), input));
      }
      return;
    }

    const phases: ReadonlyArray<{
      id: "dry" | "wet";
      title: string;
      note: string;
      fields: ReadonlySet<string>;
    }> = [
      {
        id: "dry",
        title: "干香 · Fragrance",
        note: "自由杯测：独立记录注水前干香的强度与描述来源。",
        fields: new Set(["dry_fragrance_intensity", "dry_fragrance_tags"])
      },
      {
        id: "wet",
        title: "湿香 · Aroma",
        note: "自由杯测：独立记录注水并破渣时湿香的强度与描述来源。",
        fields: new Set(["wet_aroma_intensity", "wet_aroma_tags"])
      }
    ];

    const phaseFieldKeys = new Set(phases.flatMap((phase) => [...phase.fields]));
    for (const phase of phases) {
      const section = element("section", `sensory-aroma-phase sensory-aroma-phase--${phase.id}`);
      section.dataset.aromaPhase = phase.id;
      section.append(element("h2", "sensory-aroma-phase__title", phase.title), element("p", "sensory-aroma-phase__note", phase.note));
      for (const spec of controls.filter((item) => phase.fields.has(item.fieldKey))) {
        const value = spec.fieldKey === "wet_aroma_tags" && !values.has(spec.fieldKey) ? values.get("flavor_tags") : values.get(spec.fieldKey);
        section.append(renderControl(spec, value, input));
      }
      root.append(section);
    }
    for (const spec of controls.filter((item) => !phaseFieldKeys.has(item.fieldKey))) root.append(renderControl(spec, values.get(spec.fieldKey), input));
    return;
  }

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
