import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import {
  deriveFinalPhaseStatus,
  FINAL_PHASE_COMPLETION_HINTS,
  type FinalAssessmentPhase
} from "../../core/cupping-progress-policy";
import { scoreProfileForMode, type CuppingScoreProfile } from "../../core/cupping-score-profile";
import type { CuppingCompletionTiming } from "../../core/cupping-timing";
import type { FlavorGroupPreferences } from "../flavor-group-preferences";
import type { RadarAxisValue } from "../sample-summary-model";
import { button, clearElement, element, setPressed } from "./dom-helpers";
import { renderRadarSummary } from "./radar-renderer";
import { renderSensoryEditor } from "./sensory-editor-renderer";
import { DEFECT_ITEMS, defectPenalty } from "../../core/defect-dictionary";

export type { FinalAssessmentPhase } from "../../core/cupping-progress-policy";

export interface FinalAssessmentCallbacks {
  saveField(fieldKey: string, value: unknown): void | Promise<void>;
  setFlavorGroupCollapsed(groupId: string, collapsed: boolean): void | Promise<void>;
}

export interface FinalAssessmentInput {
  observations: readonly SensoryObservation[];
  flavorPreferences: FlavorGroupPreferences;
  callbacks: FinalAssessmentCallbacks;
  scoreProfile?: CuppingScoreProfile;
  phase?: FinalAssessmentPhase;
  completionTiming?: CuppingCompletionTiming;
}

const PROFILE_AXES = [
  ["profile_floral", "花香"], ["profile_fruit", "果香"], ["profile_tea", "茶感"],
  ["profile_nut", "坚果"], ["profile_ferment", "酵感"], ["profile_spice", "香料"]
] as const;

const QUALITY_AXES = [
  ["quality_flavor", "风味"], ["quality_aftertaste", "余韵"], ["quality_acidity", "酸质"], ["quality_sweetness", "甜感"],
  ["quality_body", "醇厚度"], ["quality_clean", "干净度"], ["quality_uniformity", "一致性"], ["quality_balance", "平衡性"]
] as const;

function ensureScoreConfirmationStyles(): void {
  if (document.head.querySelector("style[data-aromasense-score-confirmation]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseScoreConfirmation = "true";
  style.textContent = `
    .final-assessment__score-confirm{display:block;min-width:min(320px,90%);margin:24px auto 0;padding:14px 24px;text-align:center;font-size:18px!important;font-weight:800!important;letter-spacing:.04em}
    .final-assessment__score-confirm.is-confirmed{font-weight:800!important}
    .final-assessment__score-lock-note{display:block;margin:8px auto 0;max-width:520px;text-align:center;color:#989289;font-size:11px;line-height:1.55}
    .cupping-completion-stamp{margin:9px auto 0;padding:7px 10px;max-width:520px;text-align:center;border:1px solid rgba(185,153,90,.18);border-radius:8px;background:rgba(185,153,90,.05);color:#aaa398;font-size:11px;line-height:1.45}
    .cupping-completion-stamp strong{color:#c9bea4;font-weight:700}
  `;
  document.head.append(style);
}

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

function scoreFromMap(map: Map<string, unknown>): number {
  const quality = QUALITY_AXES.map(([key]) => numeric(map, key));
  const base = quality.length ? quality.reduce((sum, value) => sum + value, 0) / quality.length * 10 : 0;
  const overtPenalty = (map.get("defect_overt_mold") === true ? 5 : 0)
    + (map.get("defect_overt_bad_fermentation") === true ? 5 : 0);
  const latentPenalty = map.get("defect_latent_mild_astringency") === true ? 2 : 0;
  const offFlavorPenalty = map.get("off_flavor_present") === true ? 3 : 0;
  const canonicalDefectPenalty = defectPenalty(Array.isArray(map.get("defect_ids")) ? map.get("defect_ids") as string[] : []);
  return Math.max(0, Math.min(100, Math.round((base - overtPenalty - latentPenalty - offFlavorPenalty - canonicalDefectPenalty) * 10) / 10));
}

export function calculateCuppingScore(
  observations: readonly SensoryObservation[],
  profile: CuppingScoreProfile = scoreProfileForMode("open")
): number {
  if (profile.calculatorVersion !== "aromasense-quality-0.1c") throw new Error(`UNKNOWN_SCORE_CALCULATOR:${profile.calculatorVersion}`);
  return scoreFromMap(values(observations));
}

/** Backward-compatible public name used by existing reports/tests. */
export function calculateAromaSenseScore(observations: readonly SensoryObservation[]): number {
  return calculateCuppingScore(observations, scoreProfileForMode("open"));
}

function renderScale(
  map: Map<string, unknown>,
  key: string,
  label: string,
  callbacks: FinalAssessmentCallbacks,
  onLive?: (key: string, value: number) => void
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
    onLive?.(key, Number(input.value));
  });
  input.addEventListener("change", () => void callbacks.saveField(key, Number(input.value)));
  field.append(header, input, output);
  return field;
}

function renderOverall(root: HTMLElement, input: FinalAssessmentInput): void {
  const map = values(input.observations);
  const profile = input.scoreProfile ?? scoreProfileForMode("open");
  const liveScore = element("section", "final-assessment__live-score");
  const liveValue = element("strong", "final-assessment__live-score-value", scoreFromMap(map).toFixed(1));
  liveScore.append(
    element("span", "final-assessment__live-score-label", `实时总分 · ${profile.label}`),
    liveValue,
    element("small", "final-assessment__live-score-note", `${profile.scoreNote} 缺陷与异味在确认后同步扣减。`)
  );
  root.append(liveScore);

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

  const profileSection = element("section", "final-assessment__section");
  profileSection.append(element("h3", "final-assessment__section-title", "风味倾向"));
  const profileGrid = element("div", "final-assessment__scale-grid");
  for (const [key, label] of PROFILE_AXES) {
    profileGrid.append(renderScale(map, key, label, input.callbacks, (fieldKey, next) => map.set(fieldKey, next)));
  }
  profileSection.append(profileGrid);
  root.append(profileSection);

  const quality = element("section", "final-assessment__section");
  quality.append(element("h3", "final-assessment__section-title", "综合质量"));
  const qualityGrid = element("div", "final-assessment__scale-grid");
  for (const [key, label] of QUALITY_AXES) {
    qualityGrid.append(renderScale(map, key, label, input.callbacks, (fieldKey, next) => {
      map.set(fieldKey, next);
      liveValue.textContent = scoreFromMap(map).toFixed(1);
    }));
  }
  quality.append(qualityGrid);
  root.append(quality);

  const defect = element("section", "final-assessment__section final-assessment__defects");
  defect.append(element("h3", "final-assessment__section-title", "缺陷与异味"));
  const selectedDefects = new Set(Array.isArray(map.get("defect_ids")) ? map.get("defect_ids") as string[] : []);
  const canonical = element("div", "final-assessment__choice-group");
  canonical.append(element("strong", "final-assessment__choice-heading", "基座缺陷词典"));
  for (const item of DEFECT_ITEMS) {
    const control = button("final-assessment__choice", item.names["zh-Hans"], () => {
      if (selectedDefects.has(item.id)) selectedDefects.delete(item.id); else selectedDefects.add(item.id);
      void input.callbacks.saveField("defect_ids", [...selectedDefects]);
    });
    setPressed(control, selectedDefects.has(item.id));
    canonical.append(control);
  }
  const offNotes = element("textarea", "final-assessment__notes");
  offNotes.rows = 2;
  offNotes.placeholder = "缺陷 / 异味补充说明（可选）";
  offNotes.value = typeof map.get("off_flavor_notes") === "string" ? String(map.get("off_flavor_notes")) : "";
  offNotes.addEventListener("change", () => void input.callbacks.saveField("off_flavor_notes", offNotes.value));
  defect.append(canonical, offNotes);
  root.append(defect);

  const summary = element("section", "final-assessment__section");
  summary.append(element("h3", "final-assessment__section-title", "总结行"));
  const textArea = element("textarea", "final-assessment__notes");
  textArea.rows = 3;
  textArea.placeholder = "用一句或数句总结本样品的综合表现";
  textArea.value = typeof map.get("overall_summary") === "string" ? String(map.get("overall_summary")) : "";
  textArea.addEventListener("change", () => void input.callbacks.saveField("overall_summary", textArea.value));
  summary.append(textArea);
  root.append(summary);
}

function renderScore(root: HTMLElement, input: FinalAssessmentInput): void {
  const map = values(input.observations);
  const profile = input.scoreProfile ?? scoreProfileForMode("open");
  const score = scoreFromMap(map);
  const hero = element("section", "final-assessment__score-hero");
  hero.append(
    element("span", "final-assessment__score-label", profile.scoreLabel),
    element("strong", "final-assessment__score-value", score.toFixed(1)),
    element("small", "final-assessment__score-note", `${profile.scoreNote} 当前使用 ${profile.calculatorVersion}。`)
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
  const selectedDefects = Array.isArray(map.get("defect_ids")) ? map.get("defect_ids") as string[] : [];
  for (const item of DEFECT_ITEMS.filter((candidate) => selectedDefects.includes(candidate.id))) {
    penalties.append(element("span", "final-assessment__penalty", `${item.names["zh-Hans"]} −${item.severity === "overt" ? 5 : 2}`));
  }
  if (!penalties.childElementCount) penalties.append(element("span", "final-assessment__penalty is-none", "无缺陷扣分"));
  root.append(penalties);

  const confirmationKey = input.phase === "score" ? "score_confirmed" : "final_score_confirmed";
  const confirmed = map.get(confirmationKey) === true;
  const confirm = button(
    `final-assessment__next final-assessment__score-confirm${confirmed ? " is-confirmed" : ""}`,
    confirmed ? "得分已确认" : "确认得分",
    () => void input.callbacks.saveField(confirmationKey, true)
  );
  confirm.disabled = confirmed;
  confirm.setAttribute("aria-pressed", String(confirmed));
  confirm.title = confirmed ? "得分已确认；本样品杯测记录已锁定为只读" : FINAL_PHASE_COMPLETION_HINTS.score;
  root.append(
    confirm,
    element("small", "final-assessment__score-lock-note", "确认得分后，本样品杯测记录将被锁定，无法修改。")
  );
  if (input.completionTiming) {
    const stamp = element("div", "cupping-completion-stamp");
    stamp.append(
      element("strong", "", "本分支完成"),
      document.createTextNode(` · ${input.completionTiming.elapsedLabel} · ${input.completionTiming.clockLabel}`)
    );
    root.append(stamp);
  }
}

export function renderFinalAssessment(root: HTMLElement, input: FinalAssessmentInput): void {
  ensureScoreConfirmationStyles();
  clearElement(root);
  const phase = input.phase ?? finalAssessmentPhase(input.observations);
  const nav = element("nav", "final-assessment__phase-nav");
  const phaseSpec: Array<[FinalAssessmentPhase, string]> = [["flavor", "风味描述"], ["overall", "综评"], ["score", "评分"]];
  for (const [id, label] of phaseSpec) {
    const status = deriveFinalPhaseStatus(id, input.observations);
    const item = button(`final-assessment__phase is-${status}${phase === id ? " is-current" : ""}`, label, () => void input.callbacks.saveField("final_phase", id));
    if (input.phase) item.disabled = true;
    item.setAttribute("aria-current", phase === id ? "step" : "false");
    item.title = `${status === "completed" ? "已完成" : status === "active" ? "已开始" : "未开始"}；完成标准：${FINAL_PHASE_COMPLETION_HINTS[id]}`;
    nav.append(item);
  }
  root.append(nav);

  const body = element("div", "final-assessment__body");
  root.append(body);

  if (phase === "flavor") {
    renderSensoryEditor(body, {
      stageId: input.phase === "flavor" ? "flavor" : "final",
      observations: input.observations,
      flavorPreferences: input.flavorPreferences,
      callbacks: input.callbacks,
      fieldFilter: new Set(["flavor_tags"])
    });
    if (!input.phase) body.append(button("final-assessment__next", "下一环节 · 综评", () => void input.callbacks.saveField("final_phase", "overall")));
    return;
  }

  if (phase === "overall") {
    renderOverall(body, input);
    if (!input.phase) {
      const actions = element("div", "final-assessment__phase-actions");
      actions.append(
        button("final-assessment__previous", "返回风味描述", () => void input.callbacks.saveField("final_phase", "flavor")),
        button("final-assessment__next", "下一环节 · 评分", () => void input.callbacks.saveField("final_phase", "score"))
      );
      body.append(actions);
    }
    return;
  }

  renderScore(body, input);
  if (!input.phase) {
    body.append(button("final-assessment__previous", "返回综评", () => void input.callbacks.saveField("final_phase", "overall")));
  }
}
