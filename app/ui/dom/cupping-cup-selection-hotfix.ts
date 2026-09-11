import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import {
  SCA_CUP_CAPACITY_FIELD,
  SCA_DEFECTIVE_CUP_IDS_FIELD,
  SCA_DEFECTIVE_CUPS_FIELD,
  SCA_NON_UNIFORM_CUP_IDS_FIELD,
  SCA_NON_UNIFORM_CUPS_FIELD
} from "../../core/sca-cva-score-engine";
import type { CuppingScreenController, CuppingScreenState } from "../cupping-screen-controller";
import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const PATCH_FLAG = Symbol.for("aromasense.cupping.cup-selection-hotfix.20260911.v5");
const MAX_VISIBLE_CUPS = 40;
const LEGACY_SAMPLE_CUP_COUNT_FIELD = "overall_sample_cup_count";

type NumberPosition = "top" | "bottom";

interface RendererInternals {
  root: HTMLElement;
  state?: CuppingScreenState;
  controller: CuppingScreenController;
  summaryReader: { listObservations(sampleId: string): Promise<readonly SensoryObservation[]> };
  options: { now(): string };
  run(work: () => Promise<void>): Promise<void>;
}

interface RendererPrototype {
  [PATCH_FLAG]?: boolean;
  render(this: RendererInternals): Promise<void>;
}

interface SelectionUpdate {
  idsField: string;
  countField: string;
  ids: readonly number[];
}

interface CupSelectorOptions {
  host: RendererInternals;
  label: string;
  selected: Set<number>;
  capacity: number;
  locked: boolean;
  numberPosition: NumberPosition;
  protectedIds?: ReadonlySet<number>;
  onChange(index: number, pressed: boolean, ids: readonly number[]): void;
}

function latestValue(observations: readonly SensoryObservation[], fieldKey: string): unknown {
  let selected: SensoryObservation | undefined;
  for (const item of observations) {
    if (item.fieldKey !== fieldKey) continue;
    if (!selected || item.updatedAt >= selected.updatedAt) selected = item;
  }
  return selected?.value;
}

function normalizedIds(raw: unknown, legacyCount: unknown): number[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= MAX_VISIBLE_CUPS))]
      .sort((a, b) => a - b);
  }
  const count = typeof legacyCount === "number" && Number.isInteger(legacyCount) && legacyCount > 0
    ? Math.min(MAX_VISIBLE_CUPS, legacyCount)
    : 0;
  return Array.from({ length: count }, (_, index) => index + 1);
}

function sortedIds(selected: ReadonlySet<number>): number[] {
  return [...selected].sort((a, b) => a - b);
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cup-selection-hotfix]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCupSelectionHotfix = "true";
  style.textContent = `
    .sample-rail__item.is-active::before,.sample-rail__active-tab{
      border:0!important;
      box-shadow:0 4px 14px rgba(0,0,0,.24)!important;
    }
    .cup-comparison.cup-comparison--square-picker{
      display:grid!important;
      grid-template-columns:1fr!important;
      gap:7px!important;
      align-items:stretch!important;
      margin-top:10px!important;
      padding:10px!important;
    }
    .cup-comparison--square-picker .cup-comparison__selector{
      display:grid!important;
      grid-template-columns:78px minmax(0,1fr)!important;
      gap:10px!important;
      align-items:center!important;
      min-width:0!important;
    }
    .cup-comparison--square-picker .cup-comparison__label{
      color:#c8c0b5;
      font-size:11px;
      line-height:1.2;
      white-space:nowrap;
    }
    .cup-comparison--square-picker .cup-comparison__selector.is-top-numbered .cup-comparison__label{padding-top:12px}
    .cup-comparison--square-picker .cup-comparison__selector.is-bottom-numbered .cup-comparison__label{padding-bottom:12px}
    .cup-comparison--square-picker .cup-comparison__track{
      min-width:0;
      overflow-x:auto;
      scrollbar-width:none;
      overscroll-behavior-x:contain;
      touch-action:pan-x;
    }
    .cup-comparison--square-picker .cup-comparison__track::-webkit-scrollbar{display:none}
    .cup-comparison--square-picker .cup-comparison__slots{
      display:flex;
      align-items:start;
      gap:7px;
      width:max-content;
      min-width:max-content;
    }
    .cup-comparison--square-picker .cup-comparison__slot{
      flex:0 0 24px;
      width:24px;
      display:grid;
      justify-items:center;
      gap:3px;
    }
    .cup-comparison--square-picker .cup-comparison__number{
      width:24px;
      height:9px;
      color:#8f8b85;
      font-size:9px;
      line-height:9px;
      text-align:center;
      font-variant-numeric:tabular-nums;
    }
    .cup-comparison--square-picker .cup-comparison__number.is-placeholder{visibility:hidden}
    .cup-comparison--square-picker .cup-comparison__square{
      width:24px;
      height:24px;
      padding:0;
      box-sizing:border-box;
      border:1px solid #696969;
      border-radius:3px;
      background:#5b5b5b;
      color:transparent;
      font-size:0;
      line-height:0;
      cursor:pointer;
      box-shadow:none;
      transition:background-color .12s ease,border-color .12s ease,transform .12s ease,box-shadow .12s ease;
    }
    .cup-comparison--square-picker .cup-comparison__square[aria-pressed="true"]{
      border-color:#ffffff;
      background:#f4f4f4;
      color:transparent;
      box-shadow:0 0 0 1px rgba(255,255,255,.22);
    }
    .cup-comparison--square-picker .cup-comparison__square[data-required-by-defect="true"]{
      cursor:not-allowed;
    }
    .cup-comparison--square-picker .cup-comparison__square:active:not(:disabled){transform:scale(.92)}
    .cup-comparison--square-picker .cup-comparison__add-slot{flex-basis:26px;width:26px}
    .cup-comparison--square-picker .cup-comparison__add{
      width:26px;
      height:24px;
      display:grid;
      place-items:center;
      padding:0;
      border:0;
      background:transparent;
      color:#d6ad63;
      font:inherit;
      font-size:23px;
      font-weight:500;
      line-height:1;
      cursor:pointer;
      box-shadow:none;
    }
    .cup-comparison--square-picker .cup-comparison__square:disabled,
    .cup-comparison--square-picker .cup-comparison__add:disabled{opacity:.38;cursor:not-allowed}
    @media(max-width:390px){
      .cup-comparison.cup-comparison--square-picker{padding:8px!important}
      .cup-comparison--square-picker .cup-comparison__selector{grid-template-columns:66px minmax(0,1fr)!important;gap:8px!important}
      .cup-comparison--square-picker .cup-comparison__slots{gap:6px}
      .cup-comparison--square-picker .cup-comparison__slot,
      .cup-comparison--square-picker .cup-comparison__number{flex-basis:22px;width:22px}
      .cup-comparison--square-picker .cup-comparison__square{width:22px;height:22px}
      .cup-comparison--square-picker .cup-comparison__add-slot{flex-basis:24px;width:24px}
      .cup-comparison--square-picker .cup-comparison__add{width:24px;height:22px;font-size:21px}
    }
  `;
  document.head.append(style);
}

async function persistSelections(host: RendererInternals, updates: readonly SelectionUpdate[]): Promise<void> {
  const editor = host.root.querySelector<HTMLElement>(".cupping-main__editor");
  const scrollTop = editor?.scrollTop ?? 0;
  await host.run(async () => {
    for (const update of updates) {
      host.state = await host.controller.saveField(update.idsField, [...update.ids], host.options.now());
      host.state = await host.controller.saveField(update.countField, update.ids.length, host.options.now());
    }
  });
  requestAnimationFrame(() => {
    const nextEditor = host.root.querySelector<HTMLElement>(".cupping-main__editor");
    if (nextEditor) nextEditor.scrollTop = scrollTop;
  });
}

async function persistCapacity(host: RendererInternals, capacity: number): Promise<void> {
  const editor = host.root.querySelector<HTMLElement>(".cupping-main__editor");
  const scrollTop = editor?.scrollTop ?? 0;
  await host.run(async () => {
    host.state = await host.controller.saveField(SCA_CUP_CAPACITY_FIELD, capacity, host.options.now());
    host.state = await host.controller.saveField(LEGACY_SAMPLE_CUP_COUNT_FIELD, capacity, host.options.now());
  });
  requestAnimationFrame(() => {
    const nextEditor = host.root.querySelector<HTMLElement>(".cupping-main__editor");
    if (nextEditor) nextEditor.scrollTop = scrollTop;
  });
}

async function repairLegacySubset(
  host: RendererInternals,
  nonUniform: ReadonlySet<number>,
  defective: ReadonlySet<number>
): Promise<Set<number>> {
  const repaired = new Set(nonUniform);
  for (const index of defective) repaired.add(index);
  if (repaired.size === nonUniform.size) return repaired;
  const ids = sortedIds(repaired);
  host.state = await host.controller.saveField(SCA_NON_UNIFORM_CUP_IDS_FIELD, ids, host.options.now());
  host.state = await host.controller.saveField(SCA_NON_UNIFORM_CUPS_FIELD, ids.length, host.options.now());
  return repaired;
}

function cupNumber(index: number, placeholder = false): HTMLElement {
  const number = document.createElement("span");
  number.className = `cup-comparison__number${placeholder ? " is-placeholder" : ""}`;
  number.textContent = placeholder ? "0" : String(index);
  number.setAttribute("aria-hidden", "true");
  return number;
}

function setSquareState(root: HTMLElement, label: string, index: number, pressed: boolean, requiredByDefect = false): void {
  const control = root.querySelector<HTMLButtonElement>(`.cup-comparison__square[data-cup-index="${index}"]`);
  if (!control) return;
  control.setAttribute("aria-pressed", String(pressed));
  control.setAttribute("aria-label", `${label} 第 ${index} 杯${pressed ? "，有问题" : "，正常"}`);
  if (requiredByDefect) {
    control.dataset.requiredByDefect = "true";
    control.title = `第 ${index} 杯已标记为缺陷，必须同时保持非一致`;
  } else {
    delete control.dataset.requiredByDefect;
    control.title = `${label} · 第 ${index} 杯`;
  }
}

function buildCupSelector(options: CupSelectorOptions): HTMLElement {
  const { host, label, selected, capacity, locked, numberPosition, protectedIds, onChange } = options;
  const field = document.createElement("div");
  field.className = `cup-comparison__selector is-${numberPosition}-numbered`;

  const labelNode = document.createElement("span");
  labelNode.className = "cup-comparison__label";
  labelNode.textContent = label;

  const track = document.createElement("div");
  track.className = "cup-comparison__track";
  const slots = document.createElement("div");
  slots.className = "cup-comparison__slots";
  slots.setAttribute("role", "group");
  slots.setAttribute("aria-label", label);

  for (let index = 1; index <= capacity; index += 1) {
    const slot = document.createElement("span");
    slot.className = "cup-comparison__slot";

    const control = document.createElement("button");
    control.type = "button";
    control.className = "cup-comparison__square";
    control.textContent = "";
    control.dataset.cupIndex = String(index);
    control.disabled = locked;
    const pressed = selected.has(index);
    const requiredByDefect = Boolean(protectedIds?.has(index));
    control.setAttribute("aria-pressed", String(pressed));
    control.setAttribute("aria-label", `${label} 第 ${index} 杯${pressed ? "，有问题" : "，正常"}`);
    if (requiredByDefect) {
      control.dataset.requiredByDefect = "true";
      control.title = `第 ${index} 杯已标记为缺陷，必须同时保持非一致`;
    } else {
      control.title = `${label} · 第 ${index} 杯`;
    }
    control.addEventListener("click", () => {
      const nextPressed = !selected.has(index);
      if (!nextPressed && protectedIds?.has(index)) return;
      if (nextPressed) selected.add(index); else selected.delete(index);
      control.setAttribute("aria-pressed", String(nextPressed));
      control.setAttribute("aria-label", `${label} 第 ${index} 杯${nextPressed ? "，有问题" : "，正常"}`);
      onChange(index, nextPressed, sortedIds(selected));
    });

    const number = cupNumber(index);
    if (numberPosition === "top") slot.append(number, control);
    else slot.append(control, number);
    slots.append(slot);
  }

  const addSlot = document.createElement("span");
  addSlot.className = "cup-comparison__slot cup-comparison__add-slot";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "cup-comparison__add";
  add.textContent = "+";
  add.disabled = locked || capacity >= MAX_VISIBLE_CUPS;
  add.setAttribute("aria-label", "增加一个杯位");
  add.title = "增加杯位（两项同步）";
  add.addEventListener("click", () => {
    if (capacity >= MAX_VISIBLE_CUPS) return;
    void persistCapacity(host, capacity + 1)
      .catch((error) => console.error("AromaSense cup capacity save failed", error));
  });
  const spacer = cupNumber(0, true);
  if (numberPosition === "top") addSlot.append(spacer, add);
  else addSlot.append(add, spacer);
  slots.append(addSlot);

  track.append(slots);
  field.append(labelNode, track);
  return field;
}

async function applyCupSelectors(host: RendererInternals): Promise<void> {
  installStyles();
  const state = host.state;
  const active = state?.active;
  if (!state || !active) return;

  // cupping-input-ux-upgrade renders the visible slider block as .cup-comparison.
  // Replace that exact visible block after every render rather than editing the
  // hidden .final-assessment__cup-grid underneath it.
  const comparison = host.root.querySelector<HTMLElement>(".cup-comparison");
  if (!comparison) return;

  const observations = await host.summaryReader.listObservations(active.context.sampleId);
  const originalNonUniform = new Set(normalizedIds(
    latestValue(observations, SCA_NON_UNIFORM_CUP_IDS_FIELD),
    latestValue(observations, SCA_NON_UNIFORM_CUPS_FIELD)
  ));
  const defective = new Set(normalizedIds(
    latestValue(observations, SCA_DEFECTIVE_CUP_IDS_FIELD),
    latestValue(observations, SCA_DEFECTIVE_CUPS_FIELD)
  ));
  const storedCapacity = Number(latestValue(observations, SCA_CUP_CAPACITY_FIELD));
  const legacyCapacity = Number(latestValue(observations, LEGACY_SAMPLE_CUP_COUNT_FIELD));
  const locked = state.lockedSampleIds.includes(active.context.sampleId);
  const nonUniform = locked
    ? new Set([...originalNonUniform, ...defective])
    : await repairLegacySubset(host, originalNonUniform, defective);
  const capacity = Math.min(MAX_VISIBLE_CUPS, Math.max(
    5,
    Number.isInteger(storedCapacity) ? storedCapacity : 0,
    Number.isInteger(legacyCapacity) ? legacyCapacity : 0,
    sortedIds(nonUniform).at(-1) ?? 0,
    sortedIds(defective).at(-1) ?? 0
  ));

  comparison.classList.add("cup-comparison--square-picker");

  let nonUniformSelector: HTMLElement;
  nonUniformSelector = buildCupSelector({
    host,
    label: "非一致性",
    selected: nonUniform,
    capacity,
    locked,
    numberPosition: "top",
    protectedIds: defective,
    onChange: (_index, _pressed, ids) => {
      void persistSelections(host, [{
        idsField: SCA_NON_UNIFORM_CUP_IDS_FIELD,
        countField: SCA_NON_UNIFORM_CUPS_FIELD,
        ids
      }]).catch((error) => console.error("AromaSense non-uniform cup save failed", error));
    }
  });

  const defectiveSelector = buildCupSelector({
    host,
    label: "缺陷杯数",
    selected: defective,
    capacity,
    locked,
    numberPosition: "bottom",
    onChange: (index, pressed, defectIds) => {
      const updates: SelectionUpdate[] = [{
        idsField: SCA_DEFECTIVE_CUP_IDS_FIELD,
        countField: SCA_DEFECTIVE_CUPS_FIELD,
        ids: defectIds
      }];
      if (pressed) {
        nonUniform.add(index);
        const nonUniformIds = sortedIds(nonUniform);
        setSquareState(nonUniformSelector, "非一致性", index, true, true);
        updates.push({
          idsField: SCA_NON_UNIFORM_CUP_IDS_FIELD,
          countField: SCA_NON_UNIFORM_CUPS_FIELD,
          ids: nonUniformIds
        });
      } else {
        setSquareState(nonUniformSelector, "非一致性", index, nonUniform.has(index), false);
      }
      void persistSelections(host, updates)
        .catch((error) => console.error("AromaSense defective cup save failed", error));
    }
  });

  comparison.replaceChildren(nonUniformSelector, defectiveSelector);
}

function installPatch(): void {
  installStyles();
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;
  const originalRender = prototype.render;
  prototype.render = async function(): Promise<void> {
    await originalRender.call(this);
    await applyCupSelectors(this);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") installPatch();
