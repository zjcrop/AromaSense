import type { SensoryObservation, StageId } from "../../../shared/protocol/aromasense-v1";
import { completionForStage } from "../../core/completion-engine";
import { DESCRIPTOR_GROUPS_V1 } from "../../core/sensory-dictionary-v1";
import {
  calculateSCACVAScore,
  SCA_CVA_AFFECTIVE_FIELDS,
  SCA_DEFECTIVE_CUPS_FIELD,
  SCA_DEFECT_TYPES_VALIDATION_KEY,
  SCA_DEFECT_UNIFORMITY_VALIDATION_KEY,
  SCA_NON_UNIFORM_CUPS_FIELD
} from "../../core/sca-cva-score-engine";
import type { CuppingScreenController, CuppingScreenState } from "../cupping-screen-controller";
import { CuppingScreenRenderer } from "./cupping-screen-renderer";
import { attachDragReorder } from "./drag-reorder";
import { button, element, setPressed } from "./dom-helpers";

const PATCH_FLAG = Symbol.for("aromasense.cupping.input-ux-upgrade.v1");
const SAMPLE_CUP_COUNT_FIELD = "overall_sample_cup_count";
const customDisposers = new WeakMap<HTMLElement, Array<() => void>>();
const aromaTargets = new WeakMap<HTMLElement, "dry" | "wet">();
const normalizationPending = new WeakSet<HTMLElement>();

interface RendererInternals {
  root: HTMLElement;
  state?: CuppingScreenState;
  controller: CuppingScreenController;
  summaryReader: { listObservations(sampleId: string): Promise<readonly SensoryObservation[]> };
  options: { now(): string };
  render(): Promise<void>;
}

interface RendererPrototype {
  [PATCH_FLAG]?: boolean;
  render(this: RendererInternals): Promise<void>;
}

const DESCRIPTOR_LABELS = new Map(
  DESCRIPTOR_GROUPS_V1.flatMap((group) => group.descriptors.map((descriptor) => [descriptor.id, descriptor.label] as const))
);

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cupping-input-ux-upgrade]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCuppingInputUxUpgrade = "true";
  style.textContent = `
    /* The editor is the only scrolling surface. Keep the stage rail and arrows adjacent in normal flex flow. */
    .cupping-main__editor{padding-bottom:6px!important}
    .cupping-main__stage-strip{position:relative!important;bottom:auto!important;margin:0!important}
    .cupping-main__footer{position:relative!important;bottom:auto!important;margin-top:1px!important;padding-top:0!important}
    .cupping-stage-step.is-current::after{
      content:attr(data-hidden-completion-hint)!important;
      visibility:hidden!important;
      display:block!important;
      height:0!important;
      min-height:0!important;
      max-height:0!important;
      padding:0!important;
      margin:0!important;
      overflow:hidden!important;
      border:0!important;
    }
    .sensory-layer--descriptive{display:none!important}
    .sensory-layer__note,.sensory-aroma-phase__note,.selected-tag-stack__limit{display:none!important}
    .ui-hidden-strength{display:none!important}

    .selected-tag-stack-wrap--fixed{position:relative;padding:9px 38px 9px 10px;border:1px solid rgba(185,153,90,.24);border-radius:10px;background:rgba(185,153,90,.035)}
    .selected-tag-stack-wrap--fixed .selected-tag-stack__title{margin:0 0 7px;font-size:12px;color:#cfc8bc}
    .selected-tag-stack__trash,.sensory-note-field__trash{position:absolute;right:7px;top:6px;width:27px;height:27px;display:grid;place-items:center;border:0;border-radius:7px;background:rgba(255,255,255,.045);color:#a7a099;font-size:15px;line-height:1}
    .selected-tag-stack__trash:disabled,.sensory-note-field__trash:disabled{opacity:.35}
    .selected-tag-stack{display:flex;flex-wrap:wrap;gap:6px;min-height:27px;align-items:center}
    .selected-tag-stack__item{display:inline-flex;align-items:center;gap:5px;padding:5px 6px 5px 9px;border:1px solid rgba(185,153,90,.42);border-radius:999px;background:#20201f}
    .selected-tag-stack__drag{width:18px;height:18px;padding:0;border:0;border-radius:50%;background:rgba(185,153,90,.12);color:#b9995a;font-size:8px;touch-action:none;cursor:grab}
    .selected-tag-stack__empty{color:#77716a;font-size:10px}
    .flavor-groups--fixed{display:grid;gap:8px;margin-top:8px}
    .flavor-groups--fixed .flavor-group{margin:0;overflow:visible}
    .flavor-groups--fixed .flavor-group__header{display:block}
    .flavor-groups--fixed .flavor-group__title{display:block;width:100%;box-sizing:border-box;padding:8px 10px;color:#c8c0b4;font-size:12px;font-weight:650;pointer-events:none}
    .flavor-groups--fixed .flavor-group__tags{display:flex!important;padding:0 9px 10px}

    .aroma-dual-entry{display:grid;gap:10px;margin:2px 0 10px}
    .aroma-dual-entry__targets{display:grid;grid-template-columns:minmax(0,1fr) 42px minmax(0,1fr);gap:0;align-items:stretch}
    .aroma-target{position:relative;min-width:0;padding:10px;border:1.5px dashed rgba(185,153,90,.44);border-radius:12px;background:rgba(185,153,90,.025);transition:border-color 120ms ease,background 120ms ease}
    .aroma-target.is-active{border-style:solid;border-color:var(--as-gold,#b9995a);background:rgba(185,153,90,.06)}
    .aroma-target__header{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px}
    .aroma-target__title{font-size:14px;font-weight:750;color:#d9d1c4}
    .aroma-target__trash{width:27px;height:27px;border:0;border-radius:7px;background:rgba(255,255,255,.045);color:#aaa29a;font-size:15px}
    .aroma-target .selected-tag-stack{min-height:54px;align-content:flex-start}
    .aroma-target .sensory-field{padding:9px 0 0;border-bottom:0}
    .aroma-target .sensory-field__label{margin-bottom:7px}
    .aroma-dual-entry__bridge{position:relative;z-index:3;display:grid;align-content:center;justify-items:center;gap:7px;margin:0 -5px}
    .aroma-dual-entry__bridge button{width:34px;height:30px;padding:0;border:1px solid rgba(185,153,90,.45);border-radius:999px;background:#151515;color:#c9b57d;font-size:14px;font-weight:850;line-height:1}
    .aroma-dual-entry__taxonomy{padding-top:1px}
    .aroma-dual-entry__taxonomy-title{margin:0 0 6px;font-size:12px;color:#a9a198}

    .sensory-note-field{position:relative;padding-right:38px}
    .sensory-note-field__textarea{width:100%;min-height:64px;resize:vertical;border:1px solid rgba(185,153,90,.28);border-radius:10px;padding:9px;background:#242424;color:#f4efe4}
    .floating-note-trigger{position:fixed;right:max(12px,env(safe-area-inset-right));top:50%;z-index:12020;width:44px;height:44px;display:grid;place-items:center;transform:translateY(-50%);border:1px solid rgba(185,153,90,.62);border-radius:50%;background:#181817;color:#d4bc82;font-size:23px;box-shadow:0 6px 22px rgba(0,0,0,.36)}
    .floating-note-overlay{position:fixed;inset:0;z-index:12030;background:rgba(0,0,0,.16)}
    .floating-note-panel{position:absolute;right:max(62px,calc(env(safe-area-inset-right) + 54px));top:50%;width:min(560px,calc(100vw - 116px));height:25dvh;min-height:180px;max-height:310px;display:grid;grid-template-rows:1fr auto;gap:8px;transform:translateY(-50%);padding:10px;border:1px solid rgba(185,153,90,.45);border-radius:14px;background:#191919;box-shadow:0 16px 50px rgba(0,0,0,.52)}
    .floating-note-panel__textarea{width:100%;height:100%;min-height:0;resize:none;border:1px solid rgba(185,153,90,.28);border-radius:9px;padding:10px;background:#222;color:#f4efe4;font:inherit;line-height:1.5}
    .floating-note-panel__actions{display:grid;grid-template-columns:42px 1fr;gap:8px}
    .floating-note-panel__clear,.floating-note-panel__done{min-height:38px;border:1px solid rgba(185,153,90,.34);border-radius:9px;background:#20201f;color:#d9d1c4}
    .floating-note-panel__done{color:#d6bd82;font-weight:750}

    .final-assessment__cup-grid,.final-assessment__zero-cups{display:none!important}
    .cup-comparison{display:grid;grid-template-columns:minmax(0,1fr) 82px;gap:12px;align-items:stretch;margin-top:10px;padding:10px;border:1px solid rgba(185,153,90,.2);border-radius:11px;background:rgba(185,153,90,.03)}
    .cup-comparison__ranges{display:grid;gap:9px}
    .cup-comparison__row{display:grid;grid-template-columns:92px minmax(0,1fr) 28px;gap:8px;align-items:center;color:#bdb5a8;font-size:11px}
    .cup-comparison__row input{width:100%}
    .cup-comparison__row input:disabled{filter:grayscale(1);opacity:.32;cursor:not-allowed}
    .cup-comparison__value{text-align:center;font-variant-numeric:tabular-nums;color:#d2bd8c}
    .cup-comparison__count{display:grid;place-items:center;align-content:center;gap:3px;border:1px solid rgba(185,153,90,.42);border-radius:10px;background:#181818;color:#d8c594;font-weight:800;font-size:20px}
    .cup-comparison__count small{display:block;color:#8d867c;font-size:9px;font-weight:500}
    .cup-count-overlay{position:fixed;inset:0;z-index:12100;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:20px}
    .cup-count-dialog{width:min(320px,88vw);display:grid;gap:10px;padding:16px;border:1px solid rgba(185,153,90,.45);border-radius:15px;background:#181818;box-shadow:0 18px 52px rgba(0,0,0,.5)}
    .cup-count-dialog__title{margin:0;text-align:center;font-size:14px;color:#d7cec1}
    .cup-count-dialog__wheel{height:154px;overflow-y:auto;scroll-snap-type:y mandatory;padding:56px 0;overscroll-behavior:contain}
    .cup-count-dialog__option{display:block;width:100%;height:42px;scroll-snap-align:center;border:0;background:transparent;color:#817b73;font-size:18px}
    .cup-count-dialog__option.is-selected{color:#d7bc7e;font-size:25px;font-weight:850}
    .cup-count-dialog__numeric{width:100%;min-height:40px;text-align:center;border:1px solid rgba(185,153,90,.3);border-radius:8px;background:#222;color:#eee;font-size:18px}
    .cup-count-dialog__done{min-height:40px;border:1px solid rgba(185,153,90,.4);border-radius:9px;background:#25231f;color:#d7bc7e;font-weight:750}

    .scoring-missing-fields{margin:0 0 10px;padding:9px 10px;border:1px solid rgba(214,173,99,.3);border-radius:9px;background:rgba(214,173,99,.055);color:#d2bd8c;font-size:11px;line-height:1.55}
    .final-assessment__score-note.is-warning{display:none!important}

    @media(max-width:720px){
      .aroma-dual-entry__targets{grid-template-columns:minmax(0,1fr) 36px minmax(0,1fr)}
      .aroma-dual-entry__bridge button{width:30px;height:29px;font-size:12px}
      .floating-note-panel{right:max(55px,calc(env(safe-area-inset-right) + 48px));width:calc(100vw - 104px)}
      .cup-comparison{grid-template-columns:minmax(0,1fr) 68px;padding:8px;gap:8px}
      .cup-comparison__row{grid-template-columns:78px minmax(0,1fr) 24px;gap:6px}
    }
  `;
  document.head.append(style);
}

function observationMap(observations: readonly SensoryObservation[]): Map<string, unknown> {
  return new Map(observations.map((item) => [item.fieldKey, item.value] as const));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stableUnion(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}

function disposeCustom(root: HTMLElement): void {
  for (const dispose of customDisposers.get(root) ?? []) dispose();
  customDisposers.delete(root);
  root.querySelectorAll(".floating-note-trigger,.floating-note-overlay,.cup-count-overlay").forEach((node) => node.remove());
}

function currentEditor(renderer: RendererInternals): HTMLElement | null {
  return renderer.root.querySelector<HTMLElement>(".cupping-main__editor");
}

async function saveFields(
  renderer: RendererInternals,
  updates: readonly [string, unknown][],
  preserveScroll = true
): Promise<void> {
  const editor = currentEditor(renderer);
  const scrollTop = editor?.scrollTop ?? 0;
  for (const [fieldKey, value] of updates) {
    renderer.state = await renderer.controller.saveField(fieldKey, value, renderer.options.now());
  }
  await renderer.render();
  if (preserveScroll) {
    requestAnimationFrame(() => {
      const nextEditor = currentEditor(renderer);
      if (nextEditor) nextEditor.scrollTop = scrollTop;
    });
  }
}

function saveWithoutBlocking(renderer: RendererInternals, updates: readonly [string, unknown][], preserveScroll = true): void {
  void saveFields(renderer, updates, preserveScroll).catch((error) => console.error("AromaSense input UX save failed", error));
}

function stripCompletionHints(root: HTMLElement): void {
  for (const step of root.querySelectorAll<HTMLElement>(".cupping-stage-step,.final-assessment__phase")) {
    const title = step.getAttribute("title") ?? "";
    if (!title.includes("完成标准")) continue;
    step.dataset.hiddenCompletionHint = title;
    step.removeAttribute("title");
  }
}

function stripStrengthLabels(root: HTMLElement): void {
  for (const label of root.querySelectorAll<HTMLElement>(".sensory-field__label")) {
    const raw = (label.textContent ?? "").replace(/＊/g, "").trim();
    if (!raw.includes("强度")) continue;
    const visible = raw.replace(/强度/g, "").trim();
    const required = label.dataset.required === "true";
    label.replaceChildren(document.createTextNode(visible));
    const hidden = element("span", "ui-hidden-strength", "强度");
    hidden.setAttribute("aria-hidden", "true");
    label.append(hidden);
    if (required) {
      const mark = element("span", "sensory-field__required", "＊");
      mark.setAttribute("aria-label", "必填");
      label.append(mark);
    }
  }
}

function selectedStack(
  fieldKey: string,
  title: string,
  ids: readonly string[],
  locked: boolean,
  onClear: () => void
): { root: HTMLElement; list: HTMLElement } {
  const wrap = element("section", "selected-tag-stack-wrap selected-tag-stack-wrap--fixed");
  wrap.append(element("h3", "selected-tag-stack__title", title));
  const trash = button("selected-tag-stack__trash", "🗑︎", onClear);
  trash.title = "清空";
  trash.setAttribute("aria-label", `清空${title}`);
  trash.disabled = locked;
  wrap.append(trash);
  const list = element("div", "selected-tag-stack");
  list.dataset.fieldKey = fieldKey;
  for (const descriptorId of ids) {
    const item = element("span", "selected-tag-stack__item");
    item.dataset.selectedId = descriptorId;
    item.append(element("span", "selected-tag-stack__label", DESCRIPTOR_LABELS.get(descriptorId) ?? descriptorId));
    const drag = button("selected-tag-stack__drag", "●", () => undefined);
    drag.dataset.dragHandle = "selected-tag";
    drag.title = "拖动排序";
    drag.disabled = locked;
    item.append(drag);
    list.append(item);
  }
  if (!ids.length) list.append(element("span", "selected-tag-stack__empty", "尚未选择"));
  wrap.append(list);
  return { root: wrap, list };
}

function taxonomy(
  selected: () => ReadonlySet<string>,
  locked: boolean,
  onToggle: (descriptorId: string) => void
): HTMLElement {
  const root = element("div", "flavor-groups flavor-groups--fixed");
  for (const group of DESCRIPTOR_GROUPS_V1) {
    const section = element("section", "flavor-group");
    section.dataset.groupId = group.id;
    const header = element("div", "flavor-group__header");
    const title = element("div", "flavor-group__title", group.label);
    title.setAttribute("aria-expanded", "true");
    header.append(title);
    const tags = element("div", "flavor-group__tags");
    tags.dataset.groupId = group.id;
    for (const descriptor of group.descriptors) {
      const item = element("span", "flavor-tag-item");
      item.dataset.descriptorId = descriptor.id;
      const tag = button("flavor-tag", descriptor.label, () => onToggle(descriptor.id));
      tag.disabled = locked;
      setPressed(tag, selected().has(descriptor.id));
      item.append(tag);
      tags.append(item);
    }
    section.append(header, tags);
    root.append(section);
  }
  return root;
}

function attachSelectedDrag(
  renderer: RendererInternals,
  list: HTMLElement,
  onReorder: (ids: readonly string[]) => void
): void {
  if (!list.querySelector(".selected-tag-stack__item")) return;
  const disposers = customDisposers.get(renderer.root) ?? [];
  disposers.push(attachDragReorder(list, {
    itemSelector: ".selected-tag-stack__item",
    itemIdAttribute: "data-selected-id",
    handleSelector: "[data-drag-handle]",
    onReorder
  }));
  customDisposers.set(renderer.root, disposers);
}

function intensityField(
  fieldKey: string,
  visibleLabel: string,
  value: unknown,
  locked: boolean,
  onSave: (value: number) => void
): HTMLElement {
  const field = element("section", "sensory-field sensory-field--slider");
  field.dataset.assessmentLayer = "descriptive";
  field.dataset.fieldKey = fieldKey;
  const label = element("label", "sensory-field__label", visibleLabel);
  const hidden = element("span", "ui-hidden-strength", "强度");
  hidden.setAttribute("aria-hidden", "true");
  label.append(hidden);
  const wrap = element("div", "sensory-range");
  const range = element("input", "sensory-range__input");
  range.type = "range";
  range.min = "0";
  range.max = "15";
  range.step = "0.5";
  range.value = typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
  range.disabled = locked;
  const output = element("output", "sensory-range__value", range.value);
  range.addEventListener("input", () => { output.value = range.value; });
  range.addEventListener("change", () => onSave(Number(range.value)));
  wrap.append(range, output);
  field.append(label, wrap);
  return field;
}

function buildAromaDual(renderer: RendererInternals, locked: boolean): void {
  const state = renderer.state;
  const active = state?.active;
  const editor = currentEditor(renderer);
  if (!state || !active || !editor || active.context.stageId !== "aroma") return;
  const phases = [...editor.querySelectorAll<HTMLElement>(".sensory-aroma-phase")];
  if (!phases.length) return;

  const values = observationMap(active.slice.observations);
  const legacy = stringArray(values.get("flavor_tags"));
  const hasSpecific = values.has("dry_fragrance_tags") || values.has("wet_aroma_tags");
  let dryTags = hasSpecific ? stringArray(values.get("dry_fragrance_tags")) : [...legacy];
  let wetTags = hasSpecific ? stringArray(values.get("wet_aroma_tags")) : [...legacy];
  let activeTarget = aromaTargets.get(renderer.root) ?? "dry";

  const dual = element("section", "aroma-dual-entry");
  dual.dataset.aromaPhase = "dual";
  const targets = element("div", "aroma-dual-entry__targets");

  const dry = element("section", `aroma-target aroma-target--dry${activeTarget === "dry" ? " is-active" : ""}`);
  dry.dataset.aromaTarget = "dry";
  dry.setAttribute("role", "button");
  dry.setAttribute("tabindex", "0");
  const dryHeader = element("div", "aroma-target__header");
  dryHeader.append(element("strong", "aroma-target__title", "干香"));
  const dryTrash = button("aroma-target__trash", "🗑︎", () => {
    dryTags = [];
    saveWithoutBlocking(renderer, [["dry_fragrance_tags", []], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  dryTrash.title = "清空干香";
  dryTrash.setAttribute("aria-label", "清空干香");
  dryTrash.disabled = locked;
  dryHeader.append(dryTrash);
  dry.append(dryHeader);
  const dryStack = selectedStack("dry_fragrance_tags", "", dryTags, locked, () => {
    dryTags = [];
    saveWithoutBlocking(renderer, [["dry_fragrance_tags", []], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  dryStack.root.querySelector(".selected-tag-stack__title")?.remove();
  dryStack.root.querySelector(".selected-tag-stack__trash")?.remove();
  dryStack.root.classList.remove("selected-tag-stack-wrap--fixed");
  dry.append(dryStack.list);
  dry.append(intensityField("dry_fragrance_intensity", "干香", values.get("dry_fragrance_intensity"), locked, (next) => saveWithoutBlocking(renderer, [["dry_fragrance_intensity", next]])));

  const wet = element("section", `aroma-target aroma-target--wet${activeTarget === "wet" ? " is-active" : ""}`);
  wet.dataset.aromaTarget = "wet";
  wet.setAttribute("role", "button");
  wet.setAttribute("tabindex", "0");
  const wetHeader = element("div", "aroma-target__header");
  wetHeader.append(element("strong", "aroma-target__title", "湿香"));
  const wetTrash = button("aroma-target__trash", "🗑︎", () => {
    wetTags = [];
    saveWithoutBlocking(renderer, [["wet_aroma_tags", []], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  wetTrash.title = "清空湿香";
  wetTrash.setAttribute("aria-label", "清空湿香");
  wetTrash.disabled = locked;
  wetHeader.append(wetTrash);
  wet.append(wetHeader);
  const wetStack = selectedStack("wet_aroma_tags", "", wetTags, locked, () => {
    wetTags = [];
    saveWithoutBlocking(renderer, [["wet_aroma_tags", []], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  wetStack.root.querySelector(".selected-tag-stack__title")?.remove();
  wetStack.root.querySelector(".selected-tag-stack__trash")?.remove();
  wetStack.root.classList.remove("selected-tag-stack-wrap--fixed");
  wet.append(wetStack.list);
  wet.append(intensityField("wet_aroma_intensity", "湿香", values.get("wet_aroma_intensity"), locked, (next) => saveWithoutBlocking(renderer, [["wet_aroma_intensity", next]])));

  const refreshTargetVisuals = (): void => {
    dry.classList.toggle("is-active", activeTarget === "dry");
    wet.classList.toggle("is-active", activeTarget === "wet");
    const selected = new Set(activeTarget === "dry" ? dryTags : wetTags);
    for (const tag of dual.querySelectorAll<HTMLButtonElement>(".flavor-tag")) {
      const id = tag.closest<HTMLElement>("[data-descriptor-id]")?.dataset.descriptorId;
      if (id) setPressed(tag, selected.has(id));
    }
  };
  const activate = (target: "dry" | "wet"): void => {
    activeTarget = target;
    aromaTargets.set(renderer.root, target);
    refreshTargetVisuals();
  };
  dry.addEventListener("click", (event) => { if (!(event.target as HTMLElement).closest("button,input")) activate("dry"); });
  wet.addEventListener("click", (event) => { if (!(event.target as HTMLElement).closest("button,input")) activate("wet"); });
  dry.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") activate("dry"); });
  wet.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") activate("wet"); });

  const bridge = element("div", "aroma-dual-entry__bridge");
  const swap = button("aroma-dual-entry__bridge-button", "⇄", () => {
    [dryTags, wetTags] = [wetTags, dryTags];
    saveWithoutBlocking(renderer, [["dry_fragrance_tags", dryTags], ["wet_aroma_tags", wetTags], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  swap.title = "干香与湿香互换";
  swap.setAttribute("aria-label", "干香与湿香互换");
  const copyLeft = button("aroma-dual-entry__bridge-button", "←●", () => {
    dryTags = [...wetTags];
    saveWithoutBlocking(renderer, [["dry_fragrance_tags", dryTags], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  copyLeft.title = "湿香复制到干香";
  copyLeft.setAttribute("aria-label", "湿香复制到干香");
  const copyRight = button("aroma-dual-entry__bridge-button", "●→", () => {
    wetTags = [...dryTags];
    saveWithoutBlocking(renderer, [["wet_aroma_tags", wetTags], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  copyRight.title = "干香复制到湿香";
  copyRight.setAttribute("aria-label", "干香复制到湿香");
  for (const control of [swap, copyLeft, copyRight]) control.disabled = locked;
  bridge.append(swap, copyLeft, copyRight);
  targets.append(dry, bridge, wet);
  dual.append(targets);

  const taxonomyWrap = element("section", "aroma-dual-entry__taxonomy");
  taxonomyWrap.dataset.aromaPhase = "shared";
  taxonomyWrap.append(element("h3", "aroma-dual-entry__taxonomy-title", "风味标签"));
  const common = taxonomy(
    () => new Set(activeTarget === "dry" ? dryTags : wetTags),
    locked,
    (descriptorId) => {
      if (activeTarget === "dry") {
        const next = [...dryTags];
        const index = next.indexOf(descriptorId);
        if (index >= 0) next.splice(index, 1); else next.push(descriptorId);
        dryTags = next;
      } else {
        const next = [...wetTags];
        const index = next.indexOf(descriptorId);
        if (index >= 0) next.splice(index, 1); else next.push(descriptorId);
        wetTags = next;
      }
      saveWithoutBlocking(renderer, [
        [activeTarget === "dry" ? "dry_fragrance_tags" : "wet_aroma_tags", activeTarget === "dry" ? dryTags : wetTags],
        ["flavor_tags", stableUnion(dryTags, wetTags)]
      ]);
    }
  );
  taxonomyWrap.append(common);
  dual.append(taxonomyWrap);

  phases[0]!.before(dual);
  phases.forEach((phase) => phase.remove());

  attachSelectedDrag(renderer, dryStack.list, (ids) => {
    dryTags = [...ids];
    saveWithoutBlocking(renderer, [["dry_fragrance_tags", dryTags], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  attachSelectedDrag(renderer, wetStack.list, (ids) => {
    wetTags = [...ids];
    saveWithoutBlocking(renderer, [["wet_aroma_tags", wetTags], ["flavor_tags", stableUnion(dryTags, wetTags)]]);
  });
  refreshTargetVisuals();
}

function rebuildGenericFlavorPickers(renderer: RendererInternals, locked: boolean): void {
  const active = renderer.state?.active;
  const editor = currentEditor(renderer);
  if (!active || !editor) return;
  const values = observationMap(active.slice.observations);
  for (const oldRoot of [...editor.querySelectorAll<HTMLElement>(".flavor-groups")]) {
    if (oldRoot.closest(".aroma-dual-entry")) continue;
    const oldStack = oldRoot.querySelector<HTMLElement>(".selected-tag-stack");
    const fieldKey = oldStack?.dataset.fieldKey;
    if (!fieldKey) continue;
    let selectedIds = stringArray(values.get(fieldKey));
    const oldTitle = oldRoot.querySelector<HTMLElement>(".selected-tag-stack__title")?.textContent?.trim() ?? "风味标签";
    const title = oldTitle.replace(/^已选/, "") || "风味标签";
    const upgraded = element("div", "flavor-groups flavor-groups--fixed");
    const selected = selectedStack(fieldKey, title, selectedIds, locked, () => saveWithoutBlocking(renderer, [[fieldKey, []]]));
    upgraded.append(selected.root);
    upgraded.append(taxonomy(
      () => new Set(selectedIds),
      locked,
      (descriptorId) => {
        const next = [...selectedIds];
        const index = next.indexOf(descriptorId);
        if (index >= 0) next.splice(index, 1); else next.push(descriptorId);
        selectedIds = next;
        saveWithoutBlocking(renderer, [[fieldKey, selectedIds]]);
      }
    ));
    oldRoot.replaceWith(upgraded);
    attachSelectedDrag(renderer, selected.list, (ids) => saveWithoutBlocking(renderer, [[fieldKey, [...ids]]]));
  }
}

function upgradeNotes(renderer: RendererInternals, locked: boolean): void {
  const active = renderer.state?.active;
  const editor = currentEditor(renderer);
  if (!active || !editor) return;
  const field = editor.querySelector<HTMLElement>('.sensory-field[data-field-key="notes"]');
  if (!field) return;
  const values = observationMap(active.slice.observations);
  const current = typeof values.get("notes") === "string" ? String(values.get("notes")) : "";
  const label = field.querySelector<HTMLElement>(".sensory-field__label");
  field.replaceChildren();
  if (label) field.append(label);
  field.classList.add("sensory-note-field");
  const trash = button("sensory-note-field__trash", "🗑︎", () => saveWithoutBlocking(renderer, [["notes", ""]]));
  trash.title = "清空记录";
  trash.setAttribute("aria-label", "清空记录");
  trash.disabled = locked;
  const text = element("textarea", "sensory-note-field__textarea");
  text.rows = 2;
  text.value = current;
  text.disabled = locked;
  text.addEventListener("change", () => saveWithoutBlocking(renderer, [["notes", text.value]]));
  field.append(trash, text);

  if (locked) return;
  const trigger = button("floating-note-trigger", "✍︎", () => openFloatingNotes(renderer, current));
  trigger.title = "文字记录";
  trigger.setAttribute("aria-label", "文字记录");
  renderer.root.append(trigger);
}

function openFloatingNotes(renderer: RendererInternals, initial: string): void {
  renderer.root.querySelector(".floating-note-overlay")?.remove();
  const editor = currentEditor(renderer);
  const scrollTop = editor?.scrollTop ?? 0;
  const overlay = element("div", "floating-note-overlay");
  const panel = element("section", "floating-note-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "文字记录");
  const text = element("textarea", "floating-note-panel__textarea");
  text.value = initial;
  const actions = element("div", "floating-note-panel__actions");
  const clear = button("floating-note-panel__clear", "🗑︎", () => { text.value = ""; text.focus(); });
  clear.title = "清空";
  clear.setAttribute("aria-label", "清空文字记录");
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    const value = text.value;
    overlay.remove();
    void saveFields(renderer, [["notes", value]], false).then(() => {
      requestAnimationFrame(() => {
        const nextEditor = currentEditor(renderer);
        if (nextEditor) nextEditor.scrollTop = scrollTop;
      });
    }).catch((error) => console.error("AromaSense floating note save failed", error));
  };
  const done = button("floating-note-panel__done", "完成", close);
  actions.append(clear, done);
  panel.append(text, actions);
  panel.addEventListener("click", (event) => event.stopPropagation());
  overlay.addEventListener("click", close);
  overlay.append(panel);
  renderer.root.append(overlay);
  requestAnimationFrame(() => text.focus({ preventScroll: true }));
}

function numericValue(map: ReadonlyMap<string, unknown>, key: string): number | undefined {
  const value = map.get(key);
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function cupSlider(
  key: string,
  label: string,
  value: number,
  max: number,
  disabled: boolean,
  onSave: (value: number) => void
): HTMLElement {
  const row = element("label", "cup-comparison__row");
  row.dataset.fieldKey = key;
  row.append(element("span", "", label));
  const range = element("input", "");
  range.type = "range";
  range.min = "0";
  range.max = String(max);
  range.step = "1";
  range.value = String(Math.max(0, Math.min(max, value)));
  range.disabled = disabled;
  const output = element("output", "cup-comparison__value", range.value);
  range.addEventListener("input", () => { output.value = range.value; });
  range.addEventListener("change", () => onSave(Number(range.value)));
  row.append(range, output);
  return row;
}

function openCupCountDialog(renderer: RendererInternals, current: number, nonUniform: number, defective: number): void {
  renderer.root.querySelector(".cup-count-overlay")?.remove();
  const overlay = element("div", "cup-count-overlay");
  const dialog = element("section", "cup-count-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "同一只豆子的杯数");
  dialog.append(element("h3", "cup-count-dialog__title", "同一只豆子的杯数"));
  const wheel = element("div", "cup-count-dialog__wheel");
  let selected = Math.max(1, Math.min(5, current));
  let scrollTimer: number | undefined;
  const options: HTMLButtonElement[] = [];
  const refresh = (): void => options.forEach((node) => node.classList.toggle("is-selected", Number(node.dataset.value) === selected));
  for (let value = 1; value <= 5; value += 1) {
    const option = button("cup-count-dialog__option", String(value), () => {
      selected = value;
      input.value = String(value);
      refresh();
      option.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    option.dataset.value = String(value);
    options.push(option);
    wheel.append(option);
  }
  const input = element("input", "cup-count-dialog__numeric");
  input.type = "number";
  input.inputMode = "numeric";
  input.pattern = "[0-9]*";
  input.min = "1";
  input.max = "5";
  input.step = "1";
  input.value = String(selected);
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, 1);
    input.value = digits;
    if (!digits) return;
    selected = Math.max(1, Math.min(5, Number(digits)));
    input.value = String(selected);
    refresh();
  });
  wheel.addEventListener("scroll", () => {
    if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      const rect = wheel.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const closest = options.reduce((best, item) => {
        const itemRect = item.getBoundingClientRect();
        const distance = Math.abs(itemRect.top + itemRect.height / 2 - center);
        return distance < best.distance ? { item, distance } : best;
      }, { item: options[0]!, distance: Number.POSITIVE_INFINITY }).item;
      selected = Number(closest.dataset.value) || selected;
      input.value = String(selected);
      refresh();
    }, 100);
  }, { passive: true });
  const done = button("cup-count-dialog__done", "完成", () => {
    const nextCount = Math.max(1, Math.min(5, selected));
    overlay.remove();
    const nextNonUniform = nextCount === 1 ? 0 : Math.min(nextCount, nonUniform);
    const nextDefective = nextCount === 1 ? 0 : Math.min(nextCount, defective);
    saveWithoutBlocking(renderer, [
      [SAMPLE_CUP_COUNT_FIELD, nextCount],
      [SCA_NON_UNIFORM_CUPS_FIELD, nextNonUniform],
      [SCA_DEFECTIVE_CUPS_FIELD, nextDefective]
    ]);
  });
  dialog.append(wheel, input, done);
  dialog.addEventListener("click", (event) => event.stopPropagation());
  overlay.addEventListener("click", () => overlay.remove());
  overlay.append(dialog);
  renderer.root.append(overlay);
  requestAnimationFrame(() => {
    refresh();
    options[selected - 1]?.scrollIntoView({ block: "center" });
  });
}

function upgradeCupComparison(renderer: RendererInternals, locked: boolean): void {
  const active = renderer.state?.active;
  const editor = currentEditor(renderer);
  if (!active || !editor || !["overall", "final"].includes(active.context.stageId)) return;
  const legacyGrid = editor.querySelector<HTMLElement>(".final-assessment__cup-grid");
  if (!legacyGrid) return;
  const values = observationMap(active.slice.observations);
  const explicitCount = numericValue(values, SAMPLE_CUP_COUNT_FIELD);
  const nonRaw = numericValue(values, SCA_NON_UNIFORM_CUPS_FIELD);
  const defectiveRaw = numericValue(values, SCA_DEFECTIVE_CUPS_FIELD);
  const legacyRecorded = nonRaw !== undefined || defectiveRaw !== undefined;
  const cupCount = explicitCount && explicitCount >= 1 && explicitCount <= 5 ? explicitCount : legacyRecorded ? 5 : 1;
  const nonUniform = cupCount === 1 ? 0 : Math.min(cupCount, nonRaw ?? 0);
  const defective = cupCount === 1 ? 0 : Math.min(cupCount, defectiveRaw ?? 0);
  const disabled = locked || cupCount === 1;

  const root = element("section", "cup-comparison");
  const ranges = element("div", "cup-comparison__ranges");
  ranges.append(
    cupSlider(SCA_NON_UNIFORM_CUPS_FIELD, "非一致性杯数", nonUniform, cupCount, disabled, (next) => saveWithoutBlocking(renderer, [[SCA_NON_UNIFORM_CUPS_FIELD, next]])),
    cupSlider(SCA_DEFECTIVE_CUPS_FIELD, "缺陷杯数", defective, cupCount, disabled, (next) => saveWithoutBlocking(renderer, [[SCA_DEFECTIVE_CUPS_FIELD, next]]))
  );
  const count = button("cup-comparison__count", String(cupCount), () => openCupCountDialog(renderer, cupCount, nonUniform, defective));
  count.dataset.sampleCupCount = String(cupCount);
  count.setAttribute("aria-label", `同一只豆子的杯数 ${cupCount}`);
  count.append(element("small", "", "同豆杯数"));
  count.disabled = locked;
  root.append(ranges, count);
  legacyGrid.after(root);

  if (!locked && !explicitCount && !legacyRecorded && !normalizationPending.has(renderer.root)) {
    normalizationPending.add(renderer.root);
    queueMicrotask(() => {
      saveFields(renderer, [[SAMPLE_CUP_COUNT_FIELD, 1], [SCA_NON_UNIFORM_CUPS_FIELD, 0], [SCA_DEFECTIVE_CUPS_FIELD, 0]])
        .catch((error) => console.error("AromaSense cup-count normalization failed", error))
        .finally(() => normalizationPending.delete(renderer.root));
    });
  }
}

const STAGE_LABELS: Partial<Record<StageId, string>> = {
  aroma: "香气",
  high_temp: "高温",
  mid_temp: "中温",
  low_temp: "低温",
  flavor: "风味",
  overall: "综评",
  scoring: "评分"
};

const FIELD_LABELS: Record<string, string> = {
  dry_fragrance_intensity: "干香",
  dry_fragrance_tags: "干香",
  wet_aroma_intensity: "湿香",
  wet_aroma_tags: "湿香",
  flavor_tags: "风味",
  acidity_intensity: "酸质",
  sweetness_intensity: "甜感",
  bitterness_intensity: "苦味",
  mouthfeel_intensity: "口感",
  finish_intensity: "余韵",
  quality_clean: "洁净度",
  [SCA_NON_UNIFORM_CUPS_FIELD]: "非一致性杯数",
  [SCA_DEFECTIVE_CUPS_FIELD]: "缺陷杯数",
  [SCA_DEFECT_TYPES_VALIDATION_KEY]: "缺陷类型",
  [SCA_DEFECT_UNIFORMITY_VALIDATION_KEY]: "杯间一致性"
};
for (const field of SCA_CVA_AFFECTIVE_FIELDS) FIELD_LABELS[field.key] = field.label;

async function addScoringMissingBanner(renderer: RendererInternals): Promise<void> {
  const active = renderer.state?.active;
  const editor = currentEditor(renderer);
  if (!active || !editor || active.context.stageId !== "scoring") return;
  const observations = await renderer.summaryReader.listObservations(active.context.sampleId);
  const pairs: string[] = [];
  const seen = new Set<string>();
  const add = (stage: string, field: string): void => {
    const pair = `（${stage}/${field}）`;
    if (seen.has(pair)) return;
    seen.add(pair);
    pairs.push(pair);
  };
  for (const stageId of ["aroma", "high_temp", "mid_temp", "low_temp", "flavor"] as const) {
    const stageObservations = observations.filter((item) => item.stageId === stageId);
    for (const fieldKey of completionForStage(stageId, stageObservations).missing) {
      add(STAGE_LABELS[stageId] ?? stageId, FIELD_LABELS[fieldKey] ?? fieldKey);
    }
  }
  const score = calculateSCACVAScore(observations);
  for (const fieldKey of [...score.missing, ...score.invalid]) add("综评", FIELD_LABELS[fieldKey] ?? fieldKey);
  const allValues = observationMap(observations);
  if (!allValues.has("quality_clean")) add("综评", "洁净度");
  if (!pairs.length) return;
  const banner = element("div", "scoring-missing-fields", `未完成：${pairs.join("")}`);
  editor.prepend(banner);
}

async function applyUpgrade(renderer: RendererInternals): Promise<void> {
  installStyles();
  disposeCustom(renderer.root);
  const state = renderer.state;
  const active = state?.active;
  if (!state || !active) return;
  const locked = state.lockedSampleIds.includes(active.context.sampleId);
  stripCompletionHints(renderer.root);
  buildAromaDual(renderer, locked);
  rebuildGenericFlavorPickers(renderer, locked);
  upgradeNotes(renderer, locked);
  upgradeCupComparison(renderer, locked);
  stripStrengthLabels(renderer.root);
  await addScoringMissingBanner(renderer);
}

function installPatch(): void {
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;
  const originalRender = prototype.render;
  prototype.render = async function(): Promise<void> {
    await originalRender.call(this);
    await applyUpgrade(this);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") installPatch();
