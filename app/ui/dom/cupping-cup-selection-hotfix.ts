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

const PATCH_FLAG = Symbol.for("aromasense.cupping.cup-selection-hotfix.20260911.v3");
const MAX_VISIBLE_CUPS = 40;

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

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cup-selection-hotfix]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCupSelectionHotfix = "true";
  style.textContent = `
    .sample-rail__item.is-active::before,.sample-rail__active-tab{
      border:0!important;
      box-shadow:0 4px 14px rgba(0,0,0,.24)!important;
    }
    .final-assessment__cup-grid{grid-template-columns:1fr!important;gap:7px!important;margin-top:12px!important}
    .final-assessment__cup-field--indexed{
      display:grid!important;grid-template-columns:72px minmax(0,1fr)!important;gap:10px!important;
      align-items:center!important;min-height:46px!important;
    }
    .final-assessment__cup-label{display:block;color:#c8c0b5;font-size:11px;line-height:1.2;white-space:nowrap}
    .final-assessment__cup-track{
      min-width:0;overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain;touch-action:pan-x;
    }
    .final-assessment__cup-track::-webkit-scrollbar{display:none}
    .final-assessment__cup-index-row,.final-assessment__cup-number-row{
      display:flex;align-items:center;gap:7px;width:max-content;min-width:max-content;
    }
    .final-assessment__cup-index-row{padding:2px 0}
    .final-assessment__cup-number-row{padding:0 0 2px;color:#8f8b85;font-size:9px;line-height:1;font-variant-numeric:tabular-nums}
    .final-assessment__cup-number-row.is-bottom{padding:2px 0 0}
    .final-assessment__cup-number{
      flex:0 0 24px;width:24px;text-align:center;box-sizing:border-box;
    }
    .final-assessment__cup-number-spacer{flex:0 0 26px;width:26px;height:1px}
    .final-assessment__cup-index{
      flex:0 0 24px;width:24px;height:24px;padding:0;box-sizing:border-box;
      border:1px solid #696969;border-radius:3px;background:#5b5b5b;color:transparent;
      font-size:0;line-height:0;cursor:pointer;box-shadow:none;
      transition:background-color .12s ease,border-color .12s ease,transform .12s ease,box-shadow .12s ease;
    }
    .final-assessment__cup-index[aria-pressed="true"]{
      border-color:#ffffff;background:#f4f4f4;color:transparent;box-shadow:0 0 0 1px rgba(255,255,255,.22);
    }
    .final-assessment__cup-index:active:not(:disabled){transform:scale(.92)}
    .final-assessment__cup-add{
      flex:0 0 26px;width:26px;height:26px;display:grid;place-items:center;padding:0;margin-left:1px;
      border:0;background:transparent;color:#d6ad63;font:inherit;font-size:23px;font-weight:500;line-height:1;cursor:pointer;box-shadow:none;
    }
    .final-assessment__cup-index:disabled,.final-assessment__cup-add:disabled{opacity:.38;cursor:not-allowed}
    .final-assessment__zero-cups{display:none!important}
    @media(max-width:390px){
      .final-assessment__cup-field--indexed{grid-template-columns:66px minmax(0,1fr)!important;gap:8px!important}
      .final-assessment__cup-index-row,.final-assessment__cup-number-row{gap:6px}
      .final-assessment__cup-index,.final-assessment__cup-number{flex-basis:22px;width:22px}
      .final-assessment__cup-index{height:22px;border-radius:3px}
      .final-assessment__cup-number-spacer{flex-basis:24px;width:24px}
      .final-assessment__cup-add{flex-basis:24px;width:24px;height:24px;font-size:21px}
    }
  `;
  document.head.append(style);
}

async function persistSelection(
  host: RendererInternals,
  idsField: string,
  countField: string,
  ids: readonly number[]
): Promise<void> {
  const editor = host.root.querySelector<HTMLElement>(".cupping-main__editor");
  const scrollTop = editor?.scrollTop ?? 0;
  await host.run(async () => {
    host.state = await host.controller.saveField(idsField, [...ids], host.options.now());
    host.state = await host.controller.saveField(countField, ids.length, host.options.now());
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
  });
  requestAnimationFrame(() => {
    const nextEditor = host.root.querySelector<HTMLElement>(".cupping-main__editor");
    if (nextEditor) nextEditor.scrollTop = scrollTop;
  });
}

function buildNumberRow(capacity: number, position: NumberPosition): HTMLElement {
  const numbers = document.createElement("div");
  numbers.className = `final-assessment__cup-number-row is-${position}`;
  numbers.setAttribute("aria-hidden", "true");
  for (let index = 1; index <= capacity; index += 1) {
    const number = document.createElement("span");
    number.className = "final-assessment__cup-number";
    number.textContent = String(index);
    numbers.append(number);
  }
  const spacer = document.createElement("span");
  spacer.className = "final-assessment__cup-number-spacer";
  numbers.append(spacer);
  return numbers;
}

function buildCupSelector(
  host: RendererInternals,
  field: HTMLElement,
  label: string,
  countField: string,
  idsField: string,
  selectedIds: readonly number[],
  capacity: number,
  locked: boolean,
  numberPosition: NumberPosition
): void {
  const selected = new Set(selectedIds);
  field.className = "final-assessment__cup-field final-assessment__cup-field--indexed";
  field.replaceChildren();

  const labelNode = document.createElement("span");
  labelNode.className = "final-assessment__cup-label";
  labelNode.textContent = label;

  const row = document.createElement("div");
  row.className = "final-assessment__cup-index-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);

  for (let index = 1; index <= capacity; index += 1) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "final-assessment__cup-index";
    control.textContent = "";
    control.dataset.cupIndex = String(index);
    control.disabled = locked;
    control.setAttribute("aria-pressed", String(selected.has(index)));
    control.setAttribute("aria-label", `${label} 第 ${index} 杯${selected.has(index) ? "，有问题" : "，未标记"}`);
    control.title = `第 ${index} 杯`;
    control.addEventListener("click", () => {
      if (selected.has(index)) selected.delete(index); else selected.add(index);
      const pressed = selected.has(index);
      control.setAttribute("aria-pressed", String(pressed));
      control.setAttribute("aria-label", `${label} 第 ${index} 杯${pressed ? "，有问题" : "，未标记"}`);
      const ids = [...selected].sort((a, b) => a - b);
      void persistSelection(host, idsField, countField, ids).catch((error) => console.error("AromaSense cup selection save failed", error));
    });
    row.append(control);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "final-assessment__cup-add";
  add.textContent = "+";
  add.disabled = locked || capacity >= MAX_VISIBLE_CUPS;
  add.setAttribute("aria-label", "增加一个杯位");
  add.title = "增加杯位（两项同步）";
  add.addEventListener("click", () => {
    if (capacity >= MAX_VISIBLE_CUPS) return;
    void persistCapacity(host, capacity + 1).catch((error) => console.error("AromaSense cup capacity save failed", error));
  });
  row.append(add);

  const track = document.createElement("div");
  track.className = "final-assessment__cup-track";
  const numbers = buildNumberRow(capacity, numberPosition);
  if (numberPosition === "top") track.append(numbers, row);
  else track.append(row, numbers);

  field.append(labelNode, track);
}

async function applyCupSelectors(host: RendererInternals): Promise<void> {
  installStyles();
  const state = host.state;
  const active = state?.active;
  if (!state || !active || active.context.stageId !== "overall") return;
  const grid = host.root.querySelector<HTMLElement>(".final-assessment__cup-grid");
  if (!grid) return;
  const fields = [...grid.querySelectorAll<HTMLElement>(".final-assessment__cup-field")];
  if (fields.length < 2) return;

  const observations = await host.summaryReader.listObservations(active.context.sampleId);
  const nonUniform = normalizedIds(
    latestValue(observations, SCA_NON_UNIFORM_CUP_IDS_FIELD),
    latestValue(observations, SCA_NON_UNIFORM_CUPS_FIELD)
  );
  const defective = normalizedIds(
    latestValue(observations, SCA_DEFECTIVE_CUP_IDS_FIELD),
    latestValue(observations, SCA_DEFECTIVE_CUPS_FIELD)
  );
  const storedCapacity = Number(latestValue(observations, SCA_CUP_CAPACITY_FIELD));
  const capacity = Math.min(MAX_VISIBLE_CUPS, Math.max(
    5,
    Number.isInteger(storedCapacity) ? storedCapacity : 0,
    nonUniform.at(-1) ?? 0,
    defective.at(-1) ?? 0
  ));
  const locked = state.lockedSampleIds.includes(active.context.sampleId);

  buildCupSelector(host, fields[0], "非一致性", SCA_NON_UNIFORM_CUPS_FIELD, SCA_NON_UNIFORM_CUP_IDS_FIELD, nonUniform, capacity, locked, "top");
  buildCupSelector(host, fields[1], "缺陷杯数", SCA_DEFECTIVE_CUPS_FIELD, SCA_DEFECTIVE_CUP_IDS_FIELD, defective, capacity, locked, "bottom");
  host.root.querySelector(".final-assessment__zero-cups")?.remove();
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
