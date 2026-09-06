import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import {
  deriveFinalPhaseStatus,
  FINAL_PHASE_COMPLETION_HINTS,
  type FinalAssessmentPhase
} from "../../core/cupping-progress-policy";
import { scoreProfileForMode, type CuppingScoreProfile } from "../../core/cupping-score-profile";
import type { CuppingCompletionTiming } from "../../core/cupping-timing";
import {
  calculateSCACVAScore,
  SCA_CVA_AFFECTIVE_FIELDS,
  SCA_CVA_CALCULATOR_VERSION,
  SCA_DEFECTIVE_CUPS_FIELD,
  SCA_NON_UNIFORM_CUPS_FIELD
} from "../../core/sca-cva-score-engine";
import type { FlavorGroupPreferences } from "../flavor-group-preferences";
import { button, clearElement, element, setPressed } from "./dom-helpers";
import { renderSensoryEditor } from "./sensory-editor-renderer";
import { DEFECT_ITEMS, defectPenalty } from "../../core/defect-dictionary";
import { renderSensoryProfileConclusion } from "./sensory-profile-conclusion-renderer";

export type { FinalAssessmentPhase } from "../../core/cupping-progress-policy";

export interface FinalAssessmentCallbacks {
  saveField(fieldKey: string, value: unknown): void | Promise<void>;
  setFlavorGroupCollapsed(groupId: string, collapsed: boolean): void | Promise<void>;
}

export interface FinalAssessmentInput {
  observations: readonly SensoryObservation[];
  profileObservations?: readonly SensoryObservation[];
  flavorPreferences: FlavorGroupPreferences;
  callbacks: FinalAssessmentCallbacks;
  scoreProfile?: CuppingScoreProfile;
  phase?: FinalAssessmentPhase;
  completionTiming?: CuppingCompletionTiming;
}

const LEGACY_QUALITY_AXES = [
  "quality_flavor", "quality_aftertaste", "quality_acidity", "quality_sweetness",
  "quality_body", "quality_clean", "quality_uniformity", "quality_balance"
] as const;

function ensureScoreConfirmationStyles(): void {
  if (document.head.querySelector("style[data-aromasense-score-confirmation]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseScoreConfirmation = "true";
  style.textContent = `
    .final-assessment__score-confirm{display:block;min-width:min(320px,90%);margin:24px auto 0;padding:14px 24px;text-align:center;font-size:18px!important;font-weight:800!important;letter-spacing:.04em}
    .final-assessment__score-confirm.is-confirmed{font-weight:800!important}.final-assessment__score-confirm:disabled:not(.is-confirmed){opacity:.42}
    .final-assessment__score-lock-note{display:block;margin:8px auto 0;max-width:620px;text-align:center;color:#989289;font-size:11px;line-height:1.55}
    .final-assessment__sca-note{margin:6px 0 0;color:#9a958d;font-size:10px;line-height:1.5}.final-assessment__sca-note.is-warning{color:#c8a57d}
    .final-assessment__sca-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 16px}.final-assessment__sca-scale{display:grid;grid-template-columns:72px minmax(0,1fr) 34px;gap:8px;align-items:center;padding:7px 0}
    .final-assessment__sca-scale-label{font-size:11px;color:#cfc8bc}.final-assessment__sca-scale-input{width:100%}.final-assessment__sca-scale-value{text-align:center;font-variant-numeric:tabular-nums;color:#d9c28f}.final-assessment__sca-scale.is-unset .final-assessment__sca-scale-value,.final-assessment__scale.is-unset .final-assessment__scale-value{color:#6e6a64}
    .final-assessment__cup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;margin-top:10px}.final-assessment__cup-field{display:grid;gap:5px;font-size:11px;color:#b6afa4}.final-assessment__cup-field select{min-height:38px;border:1px solid rgba(185,153,90,.32);border-radius:7px;background:#151515;color:#eee;padding:6px 8px}
    .final-assessment__zero-cups{margin-top:9px;border:1px solid rgba(185,153,90,.3);border-radius:7px;background:transparent;color:#d6c49e;padding:8px 11px}
    .cupping-completion-stamp{margin:9px auto 0;padding:7px 10px;max-width:520px;text-align:center;border:1px solid rgba(185,153,90,.18);border-radius:8px;background:rgba(185,153,90,.05);color:#aaa398;font-size:11px;line-height:1.45}.cupping-completion-stamp strong{color:#c9bea4;font-weight:700}
    @media(max-width:620px){.final-assessment__sca-grid,.final-assessment__cup-grid{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

function values(observations: readonly SensoryObservation[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const item of observations) map.set(item.fieldKey, item.value);
  return map;
}

function numeric(map: ReadonlyMap<string, unknown>, key: string): number {
  const value = map.get(key);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function finalAssessmentPhase(observations: readonly SensoryObservation[]): FinalAssessmentPhase {
  const raw = observations.find((item) => item.fieldKey === "final_phase")?.value;
  return raw === "overall" || raw === "score" ? raw : "flavor";
}

function legacyScoreFromMap(map: ReadonlyMap<string, unknown>): number {
  const quality = LEGACY_QUALITY_AXES.map((key) => numeric(map, key));
  const base = quality.length ? quality.reduce((sum, value) => sum + value, 0) / quality.length * 10 : 0;
  const overtPenalty = (map.get("defect_overt_mold") === true ? 5 : 0)
    + (map.get("defect_overt_bad_fermentation") === true ? 5 : 0);
  const latentPenalty = map.get("defect_latent_mild_astringency") === true ? 2 : 0;
  const offFlavorPenalty = map.get("off_flavor_present") === true ? 3 : 0;
  const canonicalDefectPenalty = defectPenalty(Array.isArray(map.get("defect_ids")) ? map.get("defect_ids") as string[] : []);
  return Math.max(0, Math.min(100, Math.round((base - overtPenalty - latentPenalty - offFlavorPenalty - canonicalDefectPenalty) * 10) / 10));
}

export function calculateAromaSenseScore(observations: readonly SensoryObservation[]): number {
  return legacyScoreFromMap(values(observations));
}

export function calculateCuppingScore(
  observations: readonly SensoryObservation[],
  profile: CuppingScoreProfile = scoreProfileForMode("open")
): number {
  if (profile.calculatorVersion === "aromasense-quality-0.1c") return calculateAromaSenseScore(observations);
  if (profile.calculatorVersion !== SCA_CVA_CALCULATOR_VERSION) throw new Error(`UNKNOWN_SCORE_CALCULATOR:${profile.calculatorVersion}`);
  const result = calculateSCACVAScore(observations);
  if (!result.complete || result.score === undefined) throw new Error(`SCA_CVA_AFFECTIVE_INCOMPLETE:${[...result.missing, ...result.invalid].join(",")}`);
  return result.score;
}

function renderStructureScale(map: ReadonlyMap<string, unknown>, callbacks: FinalAssessmentCallbacks): HTMLElement {
  const current = map.get("quality_clean");
  const hasValue = typeof current === "number" && Number.isFinite(current) && current >= 0 && current <= 10;
  const field = element("label", `final-assessment__scale${hasValue ? "" : " is-unset"}`);
  field.dataset.fieldKey = "quality_clean";
  const header = element("span", "final-assessment__scale-label", "洁净度 · 香迹结构");
  const output = element("output", "final-assessment__scale-value", hasValue ? String(current) : "—");
  const input = element("input", "final-assessment__scale-input");
  input.type = "range"; input.min = "0"; input.max = "10"; input.step = "0.5";
  input.value = hasValue ? String(current) : "5";
  input.addEventListener("input", () => { output.value = input.value; field.classList.remove("is-unset"); });
  input.addEventListener("change", () => void callbacks.saveField("quality_clean", Number(input.value)));
  field.append(header, input, output);
  return field;
}

function renderSCAScale(map: ReadonlyMap<string, unknown>, key: string, label: string, callbacks: FinalAssessmentCallbacks): HTMLElement {
  const current = map.get(key);
  const hasValue = typeof current === "number" && Number.isInteger(current) && current >= 1 && current <= 9;
  const field = element("label", `final-assessment__sca-scale${hasValue ? "" : " is-unset"}`);
  field.dataset.fieldKey = key;
  const caption = element("span", "final-assessment__sca-scale-label", label);
  const output = element("output", "final-assessment__sca-scale-value", hasValue ? String(current) : "—");
  const range = element("input", "final-assessment__sca-scale-input");
  range.type = "range"; range.min = "1"; range.max = "9"; range.step = "1"; range.value = hasValue ? String(current) : "5";
  range.addEventListener("input", () => { output.value = range.value; field.classList.remove("is-unset"); });
  range.addEventListener("change", () => void callbacks.saveField(key, Number(range.value)));
  field.append(caption, range, output);
  return field;
}

function renderCupCount(map: ReadonlyMap<string, unknown>, key: string, label: string, callbacks: FinalAssessmentCallbacks): HTMLLabelElement {
  const wrapper = element("label", "final-assessment__cup-field");
  wrapper.append(element("span", "", label));
  const select = element("select", "");
  select.append(new Option("未记录", ""));
  for (let value = 0; value <= 5; value += 1) select.append(new Option(String(value), String(value)));
  const current = map.get(key);
  select.value = typeof current === "number" && Number.isInteger(current) && current >= 0 && current <= 5 ? String(current) : "";
  select.addEventListener("change", () => { if (select.value !== "") void callbacks.saveField(key, Number(select.value)); });
  wrapper.append(select);
  return wrapper;
}

function renderOverall(root: HTMLElement, input: FinalAssessmentInput): void {
  const map = values(input.observations);
  const profile = input.scoreProfile ?? scoreProfileForMode("open");
  const score = calculateSCACVAScore(input.observations);
  const liveScore = element("section", "final-assessment__live-score");
  liveScore.append(
    element("span", "final-assessment__live-score-label", `SCA CVA · ${profile.label}`),
    element("strong", "final-assessment__live-score-value", score.complete && score.score !== undefined ? score.score.toFixed(2) : "—"),
    element("small", `final-assessment__live-score-note${score.complete ? "" : " is-warning"}`, score.complete
      ? "SCA-104 Affective Assessment：8项1–9分 + 非一致杯/缺陷杯扣分。"
      : `待完成：${score.missing.length + score.invalid.length} 项；缺失不会按0自动计入。`)
  );
  root.append(liveScore);

  const sca = element("section", "final-assessment__section");
  sca.append(
    element("h3", "final-assessment__section-title", "SCA CVA Affective Assessment"),
    element("p", "final-assessment__sca-note", "以下8项均使用1–9分最终情感/质量评价。酸甜苦等描述性强度与风味标签不会直接改变SCA得分。")
  );
  const grid = element("div", "final-assessment__sca-grid");
  for (const field of SCA_CVA_AFFECTIVE_FIELDS) grid.append(renderSCAScale(map, field.key, field.label, input.callbacks));
  sca.append(grid);
  const cups = element("div", "final-assessment__cup-grid");
  cups.append(
    renderCupCount(map, SCA_NON_UNIFORM_CUPS_FIELD, "非一致杯数（每杯 −2）", input.callbacks),
    renderCupCount(map, SCA_DEFECTIVE_CUPS_FIELD, "缺陷杯数（每杯 −4）", input.callbacks)
  );
  sca.append(cups, button("final-assessment__zero-cups", "两项均为 0", async () => {
    await input.callbacks.saveField(SCA_NON_UNIFORM_CUPS_FIELD, 0);
    await input.callbacks.saveField(SCA_DEFECTIVE_CUPS_FIELD, 0);
  }));
  root.append(sca);

  const structure = element("section", "final-assessment__section");
  structure.append(
    element("h3", "final-assessment__section-title", "香迹结构补充"),
    element("p", "final-assessment__sca-note", "洁净度进入风味结构雷达图，但不进入SCA总分；平衡感不设独立轴，由酸、甜、苦结构关系体现。"),
    renderStructureScale(map, input.callbacks)
  );
  root.append(structure);

  const defect = element("section", "final-assessment__section final-assessment__defects");
  defect.append(
    element("h3", "final-assessment__section-title", "具体缺陷 / 异味记录"),
    element("p", "final-assessment__sca-note", "具体缺陷标签用于侧写与追溯，不直接代替SCA缺陷杯数扣分。")
  );
  const selectedDefects = new Set(Array.isArray(map.get("defect_ids")) ? map.get("defect_ids") as string[] : []);
  const canonical = element("div", "final-assessment__choice-group");
  for (const item of DEFECT_ITEMS) {
    const control = button("final-assessment__choice", item.names["zh-Hans"], () => {
      if (selectedDefects.has(item.id)) selectedDefects.delete(item.id); else selectedDefects.add(item.id);
      void input.callbacks.saveField("defect_ids", [...selectedDefects]);
    });
    setPressed(control, selectedDefects.has(item.id)); canonical.append(control);
  }
  const offNotes = element("textarea", "final-assessment__notes");
  offNotes.rows = 2; offNotes.placeholder = "缺陷 / 异味补充说明（可选）";
  offNotes.value = typeof map.get("off_flavor_notes") === "string" ? String(map.get("off_flavor_notes")) : "";
  offNotes.addEventListener("change", () => void input.callbacks.saveField("off_flavor_notes", offNotes.value));
  defect.append(canonical, offNotes); root.append(defect);

  const summary = element("section", "final-assessment__section");
  summary.append(element("h3", "final-assessment__section-title", "总结"));
  const textArea = element("textarea", "final-assessment__notes");
  textArea.rows = 3; textArea.placeholder = "用一句或数句总结本样品的综合表现";
  textArea.value = typeof map.get("overall_summary") === "string" ? String(map.get("overall_summary")) : "";
  textArea.addEventListener("change", () => void input.callbacks.saveField("overall_summary", textArea.value));
  summary.append(textArea); root.append(summary);
}

function renderScore(root: HTMLElement, input: FinalAssessmentInput): void {
  const map = values(input.observations);
  const profile = input.scoreProfile ?? scoreProfileForMode("open");
  const score = calculateSCACVAScore(input.observations);
  const hero = element("section", "final-assessment__score-hero");
  hero.append(
    element("span", "final-assessment__score-label", profile.scoreLabel),
    element("strong", "final-assessment__score-value", score.complete && score.score !== undefined ? score.score.toFixed(2) : "—"),
    element("small", `final-assessment__score-note${score.complete ? "" : " is-warning"}`, score.complete
      ? `SCA-104 · ${score.calculatorVersion} · 非一致杯 −${score.nonUniformPenalty ?? 0} · 缺陷杯 −${score.defectivePenalty ?? 0}`
      : `SCA输入未完成：${[...score.missing, ...score.invalid].join("、") || "未知字段"}`)
  );
  root.append(hero);

  const list = element("div", "final-assessment__score-list");
  for (const field of SCA_CVA_AFFECTIVE_FIELDS) {
    const row = element("div", "final-assessment__score-row");
    const value = map.get(field.key);
    row.append(element("span", "final-assessment__score-name", field.label), element("strong", "final-assessment__score-number", typeof value === "number" ? value.toFixed(0) : "—"));
    list.append(row);
  }
  root.append(list);

  const source = input.profileObservations ?? input.observations;
  renderSensoryProfileConclusion(root, source);

  const confirmationKey = input.phase === "score" ? "score_confirmed" : "final_score_confirmed";
  const confirmed = map.get(confirmationKey) === true;
  const confirm = button(
    `final-assessment__next final-assessment__score-confirm${confirmed ? " is-confirmed" : ""}`,
    confirmed ? "得分已确认" : score.complete ? "确认 SCA 得分" : "SCA 输入未完成",
    () => void input.callbacks.saveField(confirmationKey, true)
  );
  confirm.disabled = confirmed || !score.complete;
  confirm.setAttribute("aria-pressed", String(confirmed));
  confirm.title = confirmed ? "得分已确认；本样品杯测记录已锁定为只读" : score.complete ? FINAL_PHASE_COMPLETION_HINTS.score : "返回综评补全SCA评分字段与异常杯数";
  root.append(confirm, element("small", "final-assessment__score-lock-note", score.complete
    ? "确认后锁定本样品。香迹雷达图与温度—风味演化图仅用于结构侧写，不参与SCA得分。"
    : "SCA字段未完成时不能确认得分；缺失值不会被自动当作0。"));
  if (input.completionTiming) {
    const stamp = element("div", "cupping-completion-stamp");
    stamp.append(element("strong", "", "本分支完成"), document.createTextNode(` · ${input.completionTiming.elapsedLabel} · ${input.completionTiming.clockLabel}`));
    root.append(stamp);
  }
}

export function renderFinalAssessment(root: HTMLElement, input: FinalAssessmentInput): void {
  ensureScoreConfirmationStyles(); clearElement(root);
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
  const body = element("div", "final-assessment__body"); root.append(body);

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
      ); body.append(actions);
    }
    return;
  }
  renderScore(body, input);
  if (!input.phase) body.append(button("final-assessment__previous", "返回综评", () => void input.callbacks.saveField("final_phase", "overall")));
}