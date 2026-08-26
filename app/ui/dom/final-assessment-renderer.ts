import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import type { FlavorGroupPreferences } from "../flavor-group-preferences";
import type { RadarAxisValue } from "../sample-summary-model";
import { button, clearElement, element, setPressed } from "./dom-helpers";
import { renderRadarSummary } from "./radar-renderer";
import { renderSensoryEditor } from "./sensory-editor-renderer";

export type FinalAssessmentPhase = "flavor" | "overall" | "score";

export interface FinalAssessmentCallbacks {
  saveField(fieldKey: string, value: unknown): void | Promise<void>;
  setFlavorGroupCollapsed(groupId: string, collapsed: boolean): void | Promise<void>;
}

export interface FinalAssessmentInput {
  observations: readonly SensoryObservation[];
  flavorPreferences: FlavorGroupPreferences;
  callbacks: FinalAssessmentCallbacks;
}

const PROFILE_AXES = [
  ["profile_floral", "花香"],
  ["profile_fruit", "果香"],
  ["profile_tea", "茶感"],
  ["profile_nut", "坚果"],
  ["profile_ferment", "酵感"],
  ["profile_spice", "香料"]
] as const;

const QUALITY_AXES = [
  ["quality_flavor", "风味"],
  ["quality_aftertaste", "余韵"],
  ["quality_acidity", "酸质"],
  ["quality_sweetness", "甜感"],
  ["quality_body", "醇厚度"],
  ["quality_clean", "干净度"],
  ["quality_uniformity", "一致性"],
  ["quality_balance", "平衡性"]
] as const;

function values(observations: readonly SensoryObservation[]): Map<string, unknown> {
  return new Map(observations.map((item) => [item.fieldKey, item.value] as const));
}

function numeric(map: Map<string, unknown>, key: string): number {
  const value = map.get(key);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function finalAssessmentPhase(observations: readonly SensoryObservation[]): FinalAssessmentPhase {
  const raw = observations.find((item) => item.fieldKey === "final_phase")?.value;
  return raw === "overall" || raw === "score" ? raw : "flavor";
}

function axisValues(map: Map<string, unknown>, axes: readonly (readonly [string, string])[]): RadarAxisValue[] {
  return axes.map(([key, label]) => ({ key, label, value: numeric(map, key), max: 10 }));
}

export function calculateAromaSenseScore(observations: readonly SensoryObservation[]): number {
  const map = values(observations);
  const quality = QUALITY_AXES.map(([key]) => numeric(map, key));
  const base = quality.length ? quality.reduce((sum, value) => sum + value, 0) / quality.length * 10 : 0;
  const overtPenalty = (map.get("defect_overt_mold") === true ? 5 : 0)
    + (map.get("defect_overt_bad_fermentation") === true ? 5 : 0);
  const latentPenalty = map.get("defect_latent_mild_astringency") === true ? 2 : 0;
  const offFlavorPenalty = map.get("off_flavor_present") === true ? 3 : 0;
  return Math.max(0, Math.min(100, Math.round((base - overtPenalty - latentPenalty - offFlavorPenalty) * 10) / 10));
}

function renderScale(
  map: Map<string, unknown>,
  key: string,
  label: string,
  callbacks: FinalAssessmentCallbacks,
  onLive?: () => void
): HTMLElement {
  const field = element("label", "final-assessment__scale");
  field.dataset.fieldKey = key;
  const header = element("span", "final-assessment__scale-label", label);
  const output = element("output", "final-assessment__scale-value");
  const input = element("input", "final-assessment__scale-input");
  input.type = "range";
  input.min = "0";
  input.max = "10";
  input.step = "0.5";
  input.value = String(numeric(map, key));
  output.value = input.value;
  input.addEventListener("input", () => {
    output.value = input.value;
    onLive?.();
  });
  input.addEventListener("change", () => void callbacks.saveField(key, Number(input.value)));
  field.append(header, input, output);
  return field;
}

function renderChoice(
  map: Map<string, unknown>,
  key: string,
  label: string,
  callbacks: FinalAssessmentCallbacks
): HTMLButtonElement {
  const selected = map.get(key) === true;
  const control = button("final-assessment__choice", label, () => {
    void callbacks.saveField(key, control.getAttribute("aria-pressed") !== "true");
  });
  setPressed(control, selected);
  control.dataset.choiceKey = key;
  return control;
}

function renderOverall(root: HTMLElement, input: FinalAssessmentInput): void {
  const map = values(input.observations);
  const radarGrid = element("div", "final-assessment__radars");
  const flavorRadar = element("div", "final-assessment__radar");
  const qualityRadar = element("div", "final-assessment__radar");
  renderRadarSummary(flavorRadar, axisValues(map, PROFILE_AXES), {
    title: "风味倾向雷达图",
    ariaLabel: "花香、果香、茶感、坚果、酵感、香料风味倾向雷达图"
  });
  renderRadarSummary(qualityRadar, axisValues(map, QUALITY_AXES), {
    title: "感官质量雷达图",
    ariaLabel: "风味、余韵、酸质、甜感、醇厚度、干净度、一致性、平衡性感官质量雷达图"
  });
  radarGrid.append(flavorRadar, qualityRadar);
  root.append(radarGrid);

  const profile = element("section", "final-assessment__section");
  profile.append(element("h3", "final-assessment__section-title", "风味倾向"));
  const profileGrid = element("div", "final-assessment__scale-grid");
  for (const [key, label] of PROFILE_AXES) profileGrid.append(renderScale(map, key, label, input.callbacks));
  profile.append(profileGrid);
  root.append(profile);

  const quality = element("section", "final-assessment__section");
  quality.append(element("h3", "final-assessment__section-title", "综合质量"));
  const qualityGrid = element("div", "final-assessment__scale-grid");
  for (const [key, label] of QUALITY_AXES) qualityGrid.append(renderScale(map, key, label, input.callbacks));
  quality.append(qualityGrid);
  root.append(quality);

  const defect = element("section", "final-assessment__section final-assessment__defects");
  defect.append(element("h3", "final-assessment__section-title", "缺陷与异味"));
  const overt = element("div", "final-assessment__choice-group");
  overt.append(
    element("strong", "final-assessment__choice-heading", "明缺陷"),
    renderChoice(map, "defect_overt_mold", "霉腐", input.callbacks),
    renderChoice(map, "defect_overt_bad_fermentation", "坏发酵", input.callbacks)
  );
  const latent = element("div", "final-assessment__choice-group");
  latent.append(
    element("strong", "final-assessment__choice-heading", "暗缺陷"),
    renderChoice(map, "defect_latent_mild_astringency", "轻微涩", input.callbacks)
  );
  const off = element("div", "final-assessment__choice-group");
  off.append(
    element("strong", "final-assessment__choice-heading", "异味"),
    renderChoice(map, "off_flavor_present", "存在异味", input.callbacks)
  );
  const offNotes = element("textarea", "final-assessment__notes");
  offNotes.rows = 2;
  offNotes.placeholder = "异味说明（可选）";
  offNotes.value = typeof map.get("off_flavor_notes") === "string" ? String(map.get("off_flavor_notes")) : "";
  offNotes.addEventListener("change", () => void input.callbacks.saveField("off_flavor_notes", offNotes.value));
  defect.append(overt, latent, off, offNotes);
  root.append(defect);

  const summary = element("section", "final-assessment__section");
  summary.append(element("h3", "final-assessment__section-title", "总结行"));
  const text = element("textarea", "final-assessment__notes");
  text.rows = 3;
  text.placeholder = "用一句或数句总结本样品的综合表现";
  text.value = typeof map.get("overall_summary") === "string" ? String(map.get("overall_summary")) : "";
  text.addEventListener("change", () => void input.callbacks.saveField("overall_summary", text.value));
  summary.append(text);
  root.append(summary);
}

function renderScore(root: HTMLElement, input: FinalAssessmentInput): void {
  const map = values(input.observations);
  const score = calculateAromaSenseScore(input.observations);
  const hero = element("section", "final-assessment__score-hero");
  hero.append(
    element("span", "final-assessment__score-label", "AromaSense 总分"),
    element("strong", "final-assessment__score-value", score.toFixed(1)),
    element("small", "final-assessment__score-note", "依据本次综合质量分项实时计算；缺陷与异味按 0.1C 规则扣减。")
  );
  root.append(hero);

  const list = element("div", "final-assessment__score-list");
  for (const [key, label] of QUALITY_AXES) {
    const row = element("div", "final-assessment__score-row");
    row.append(element("span", "final-assessment__score-name", label), element("strong", "final-assessment__score-number", numeric(map, key).toFixed(1)));
    list.append(row);
  }
  root.append(list);

  const penalties = element("div", "final-assessment__penalties");
  if (map.get("defect_overt_mold") === true) penalties.append(element("span", "final-assessment__penalty", "霉腐 −5"));
  if (map.get("defect_overt_bad_fermentation") === true) penalties.append(element("span", "final-assessment__penalty", "坏发酵 −5"));
  if (map.get("defect_latent_mild_astringency") === true) penalties.append(element("span", "final-assessment__penalty", "轻微涩 −2"));
  if (map.get("off_flavor_present") === true) penalties.append(element("span", "final-assessment__penalty", "异味 −3"));
  if (!penalties.childElementCount) penalties.append(element("span", "final-assessment__penalty is-none", "无缺陷扣分"));
  root.append(penalties);
}

export function renderFinalAssessment(root: HTMLElement, input: FinalAssessmentInput): void {
  clearElement(root);
  const phase = finalAssessmentPhase(input.observations);
  const nav = element("nav", "final-assessment__phase-nav");
  const phaseSpec: Array<[FinalAssessmentPhase, string]> = [["flavor", "风味描述"], ["overall", "综评"], ["score", "评分"]];
  for (const [id, label] of phaseSpec) {
    const item = button(`final-assessment__phase${phase === id ? " is-current" : ""}`, label, () => void input.callbacks.saveField("final_phase", id));
    item.setAttribute("aria-current", phase === id ? "step" : "false");
    nav.append(item);
  }
  root.append(nav);

  const body = element("div", "final-assessment__body");
  root.append(body);

  if (phase === "flavor") {
    renderSensoryEditor(body, {
      stageId: "final",
      observations: input.observations,
      flavorPreferences: input.flavorPreferences,
      callbacks: input.callbacks,
      fieldFilter: new Set(["flavor_tags"])
    });
    body.append(button("final-assessment__next", "下一环节 · 综评", () => void input.callbacks.saveField("final_phase", "overall")));
    return;
  }

  if (phase === "overall") {
    renderOverall(body, input);
    const actions = element("div", "final-assessment__phase-actions");
    actions.append(
      button("final-assessment__previous", "返回风味描述", () => void input.callbacks.saveField("final_phase", "flavor")),
      button("final-assessment__next", "下一环节 · 评分", () => void input.callbacks.saveField("final_phase", "score"))
    );
    body.append(actions);
    return;
  }

  renderScore(body, input);
  body.append(button("final-assessment__previous", "返回综评", () => void input.callbacks.saveField("final_phase", "overall")));
}
