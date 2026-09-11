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

const PATCH_FLAG = Symbol.for("aromasense.cupping.cup-selection-hotfix.20260911.v1");
const MAX_VISIBLE_CUPS = 40;

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
    .final-assessment__cup-grid{grid-template-columns:1fr!important;gap:12px!important}
    .final-assessment__cup-field--indexed{display:grid!important;gap:7px!important}
    .final-assessment__cup-label{display:flex;align-items:baseline;gap:8px;color:#c8c0b5;font-size:11px}
    .final-assessment__cup-hint{color:#77716a;font-size:10px;font-weight:500}
    .final-assessment__cup-index-row{display:flex;align-items:center;gap:7px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:1px 0 3px}
    .final-assessment__cup-index-row::-webkit-scrollbar{display:none}
    .final-assessment__cup-index,.final-assessment__cup-add{
      flex:0 0 38px;width:38px;height:38px;display:grid;place-items:center;box-sizing:border-box;
      border:1px solid rgba(154,157,160,.52);border-radius:7px;background:transparent;color:#c9c5be;
      font:inherit;font-size:12px;font-weight:800;line-height:1;cursor:pointer;box-shadow:none;
    }
    .final-assessment__cup-index[aria-pressed="true"]{border-color:#b9995a;background:#b9995a;color:#111}
    .final-assessment__cup-add{border-color:rgba(185,153,90,.36);color:#d6ad63;font-size:20px;font-weight:500}
    .final-assessment__cup-index:disabled,.final-assessment__cup-add:disabled{opacity:.38;cursor:not-allowed}
    .final-assessment__zero-cups{display:none!important}
    @media(max-width:390px){
      .final-assessment__cup-index-row{gap:5px}
      .final-assessment__cup-index,.final-assessment__cup-add{flex-basis:34px;width:34px;height:34px;border-radius:6px;font-size:11px}
      .final-assessment__cup-add{font-size:18px}
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

function buildCupSelector(
  host: RendererInternals,
  field: HTMLElement,
  label: string,
  countField: string,
  idsField: string,
  selectedIds: readonly number[],
  capacity: number,
  locked: boolean
): void {
  const selected = new Set(selectedIds);
  field.className = "final-assessment__cup-field final-assessment__cup-field--indexed";
  field.replaceChildren();

  const labelRow = document.createElement("span");
  labelRow.className = "final-assessment__cup-label";
  labelRow.append(document.createTextNode(label));
  const hint = document.createElement("small");
  hint.className = "final-assessment__cup-hint";
  hint.textContent = "未选择即为 0";
  labelRow.append(hint);

  const row = document.createElement("div");
  row.className = "final-assessment__cup-index-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);

  for (let index = 1; index <= capacity; index += 1) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "final-assessment__cup-index";
    control.textContent = String(index);
    control.disabled = locked;
    control.setAttribute("aria-pressed", String(selected.has(index)));
    control.setAttribute("aria-label", `${label} 第 ${index} 杯`);
    control.addEventListener("click", () => {
      if (selected.has(index)) selected.delete(index); else selected.add(index);
      control.setAttribute("aria-pressed", String(selected.has(index)));
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
  add.setAttribute("aria-label", "增加一杯");
  add.addEventListener("click", () => {
    if (capacity >= MAX_VISIBLE_CUPS) return;
    void persistCapacity(host, capacity + 1).catch((error) => console.error("AromaSense cup capacity save failed", error));
  });
  row.append(add);
  field.append(labelRow, row);
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

  buildCupSelector(host, fields[0], "非一致性杯（每杯 −2）", SCA_NON_UNIFORM_CUPS_FIELD, SCA_NON_UNIFORM_CUP_IDS_FIELD, nonUniform, capacity, locked);
  buildCupSelector(host, fields[1], "缺陷杯（每杯 −4）", SCA_DEFECTIVE_CUPS_FIELD, SCA_DEFECTIVE_CUP_IDS_FIELD, defective, capacity, locked);
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
