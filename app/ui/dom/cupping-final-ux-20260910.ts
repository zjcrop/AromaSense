import type { SensoryObservation, StageId } from "../../../shared/protocol/aromasense-v1";
import {
  calculateSCACVAScore,
  SCA_CVA_AFFECTIVE_FIELDS,
  SCA_DEFECTIVE_CUPS_FIELD,
  SCA_DEFECT_TYPES_VALIDATION_KEY,
  SCA_DEFECT_UNIFORMITY_VALIDATION_KEY,
  SCA_NON_UNIFORM_CUPS_FIELD,
  type SCACVAScoreResult
} from "../../core/sca-cva-score-engine";
import { deriveStageStatus, hasMeaningfulValue } from "../../core/cupping-progress-policy";
import { CuppingSessionController, type ActiveEditingState } from "../../core/cupping-session-controller";
import type { EditingContext, StageStatus } from "../../core/cupping-state-machine";
import { LocalCuppingRepository, type SQLiteDriver } from "../../storage/local-cupping-repository";
import { StageProgressReader, type SampleStageProgress } from "../../storage/stage-progress-reader";
import type { CuppingScreenController, CuppingScreenState } from "../cupping-screen-controller";
import { CuppingScreenRenderer } from "./cupping-screen-renderer";
import { button, element } from "./dom-helpers";

const UI_PATCH_FLAG = Symbol.for("aromasense.cupping.final-ux-20260910.v2");
const EDITOR_PATCH_FLAG = Symbol.for("aromasense.cupping.aroma-affective-source.v2");
const PROGRESS_PATCH_FLAG = Symbol.for("aromasense.cupping.aggregate-score-progress.v2");

export const AROMA_SCA_SCORE_FIELDS = [
  "final_sca_affective_fragrance",
  "final_sca_affective_aroma"
] as const;

const AROMA_SCORE_SET = new Set<string>(AROMA_SCA_SCORE_FIELDS);
const SCORE_LABELS = new Map<string, string>(
  SCA_CVA_AFFECTIVE_FIELDS.map((field) => [field.key, field.label] as const)
);

export function stableFlavorUnion(...sources: readonly (readonly string[])[]): string[] {
  return [...new Set(sources.flatMap((source) => [...source]))];
}

function preferredObservation(
  current: SensoryObservation | undefined,
  candidate: SensoryObservation,
  fieldKey: string
): SensoryObservation {
  if (!current) return candidate;
  if (AROMA_SCORE_SET.has(fieldKey)) {
    const currentAroma = current.stageId === "aroma";
    const candidateAroma = candidate.stageId === "aroma";
    if (candidateAroma !== currentAroma) return candidateAroma ? candidate : current;
  }
  return candidate.updatedAt >= current.updatedAt ? candidate : current;
}

export function latestObservationValue(observations: readonly SensoryObservation[], fieldKey: string): unknown {
  let selected: SensoryObservation | undefined;
  for (const observation of observations) {
    if (observation.fieldKey !== fieldKey) continue;
    selected = preferredObservation(selected, observation, fieldKey);
  }
  return selected?.value;
}

export function latestObservationsByField(observations: readonly SensoryObservation[]): SensoryObservation[] {
  const latest = new Map<string, SensoryObservation>();
  for (const observation of observations) {
    latest.set(observation.fieldKey, preferredObservation(latest.get(observation.fieldKey), observation, observation.fieldKey));
  }
  return [...latest.values()];
}

export function calculateAggregateSCAScore(observations: readonly SensoryObservation[]): SCACVAScoreResult {
  return calculateSCACVAScore(latestObservationsByField(observations));
}

function syntheticScoreObservation(fieldKey: string, source?: SensoryObservation): SensoryObservation {
  return {
    observationId: `overall-validation:${fieldKey}`,
    sessionId: source?.sessionId ?? "overall-validation",
    sampleId: source?.sampleId ?? "overall-validation",
    stageId: "overall",
    fieldKey,
    value: 5,
    dictionaryVersion: "sensory-flow/2.1",
    updatedAt: source?.updatedAt ?? "1970-01-01T00:00:00.000Z"
  };
}

export function overallEntryStatus(observations: readonly SensoryObservation[]): StageStatus {
  const normalized = latestObservationsByField(observations);
  const withoutAromaScores = normalized.filter((item) => !AROMA_SCORE_SET.has(item.fieldKey));
  const source = withoutAromaScores.at(-1);
  const validationInput = [
    ...withoutAromaScores,
    ...AROMA_SCA_SCORE_FIELDS.map((fieldKey) => syntheticScoreObservation(fieldKey, source))
  ];
  const score = calculateSCACVAScore(validationInput);
  const clean = latestObservationValue(withoutAromaScores, "quality_clean");
  const cleanComplete = typeof clean === "number" && Number.isFinite(clean) && clean >= 0 && clean <= 10;
  if (score.complete && cleanComplete) return "completed";

  const started = withoutAromaScores.some((item) => {
    if (!hasMeaningfulValue(item.value)) return false;
    return item.fieldKey.startsWith("final_sca_")
      || item.fieldKey.startsWith("quality_")
      || item.fieldKey.startsWith("defect_")
      || item.fieldKey.startsWith("off_flavor_")
      || item.fieldKey.startsWith("overall_");
  });
  return started ? "active" : "not_started";
}

export function aggregateScoringStatus(observations: readonly SensoryObservation[]): StageStatus {
  if (calculateAggregateSCAScore(observations).complete) return "completed";
  return observations.some((item) => item.fieldKey.startsWith("final_sca_") && hasMeaningfulValue(item.value))
    ? "active"
    : "not_started";
}

function replaceObservation(observations: readonly SensoryObservation[], next: SensoryObservation): SensoryObservation[] {
  return [...observations.filter((item) => item.fieldKey !== next.fieldKey), next]
    .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey));
}

interface EditingInternals {
  active?: ActiveEditingState;
  writeTail: Promise<void>;
  repository: LocalCuppingRepository;
  observationIdFactory(context: EditingContext, fieldKey: string): string;
}

interface EditingPrototype {
  [EDITOR_PATCH_FLAG]?: boolean;
  open(context: EditingContext, now: string): Promise<ActiveEditingState>;
  saveField(fieldKey: string, value: unknown, now: string): Promise<void>;
}

function setEditingStatus(host: EditingInternals, active: ActiveEditingState, status: StageStatus): ActiveEditingState {
  const next: ActiveEditingState = { ...active, slice: { ...active.slice, stageStatus: status } };
  if (
    host.active?.context.sessionId === active.context.sessionId
    && host.active.context.sampleId === active.context.sampleId
    && host.active.context.stageId === active.context.stageId
  ) host.active = next;
  return next;
}

async function persistOverallStatus(host: EditingInternals, now: string): Promise<void> {
  const active = host.active;
  if (!active || active.context.stageId !== "overall") return;
  const status = overallEntryStatus(active.slice.observations);
  await host.repository.setStageState(
    active.context.sessionId,
    active.context.sampleId,
    "overall",
    status,
    now,
    status === "not_started" ? undefined : now,
    status === "completed" ? now : undefined
  );
  setEditingStatus(host, active, status);
}

function installEditingPolicyPatch(): void {
  const prototype = CuppingSessionController.prototype as unknown as EditingPrototype;
  if (prototype[EDITOR_PATCH_FLAG]) return;
  prototype[EDITOR_PATCH_FLAG] = true;

  const originalOpen = prototype.open;
  prototype.open = async function(context: EditingContext, now: string): Promise<ActiveEditingState> {
    const active = await originalOpen.call(this, context, now);
    const host = this as unknown as EditingInternals;
    if (context.stageId === "overall") return setEditingStatus(host, active, overallEntryStatus(active.slice.observations));
    if (context.stageId === "scoring") {
      const aggregate = await host.repository.listObservationsForSample(context.sampleId);
      return setEditingStatus(host, active, aggregateScoringStatus(aggregate));
    }
    return active;
  };

  const originalSave = prototype.saveField;
  prototype.saveField = function(fieldKey: string, value: unknown, now: string): Promise<void> {
    const host = this as unknown as EditingInternals;
    const active = host.active;

    if (active?.context.stageId === "aroma" && AROMA_SCORE_SET.has(fieldKey)) {
      const observation: SensoryObservation = {
        observationId: host.observationIdFactory(active.context, fieldKey),
        sessionId: active.context.sessionId,
        sampleId: active.context.sampleId,
        stageId: "aroma",
        fieldKey,
        value,
        dictionaryVersion: "sensory-flow/2.1-aroma-affective",
        updatedAt: now
      };
      const previousTail = host.writeTail ?? Promise.resolve();
      const next = previousTail.then(async () => {
        await host.repository.saveObservation(observation);
        const current = host.active?.context.sessionId === observation.sessionId
          && host.active.context.sampleId === observation.sampleId
          && host.active.context.stageId === "aroma"
          ? host.active
          : active;
        const observations = replaceObservation(current.slice.observations, observation);
        const status = deriveStageStatus("aroma", observations);
        await host.repository.setStageState(
          observation.sessionId,
          observation.sampleId,
          "aroma",
          status,
          now,
          status === "not_started" ? undefined : now,
          status === "completed" ? now : undefined
        );
        setEditingStatus(host, { ...current, slice: { ...current.slice, observations } }, status);
      });
      host.writeTail = next.catch(() => undefined);
      return next;
    }

    return originalSave.call(this, fieldKey, value, now).then(async () => {
      if (host.active?.context.stageId === "overall") await persistOverallStatus(host, now);
    });
  };
}

interface ProgressInternals { db: SQLiteDriver; }
interface ProgressPrototype {
  [PROGRESS_PATCH_FLAG]?: boolean;
  listForSession(sessionId: string): Promise<readonly SampleStageProgress[]>;
}

function latestTimestamp(observations: readonly SensoryObservation[]): string {
  return observations.map((item) => item.updatedAt).sort().at(-1) ?? "";
}

function installProgressPolicyPatch(): void {
  const prototype = StageProgressReader.prototype as unknown as ProgressPrototype;
  if (prototype[PROGRESS_PATCH_FLAG]) return;
  prototype[PROGRESS_PATCH_FLAG] = true;
  const originalList = prototype.listForSession;

  prototype.listForSession = async function(sessionId: string): Promise<readonly SampleStageProgress[]> {
    const original = [...await originalList.call(this, sessionId)];
    const host = this as unknown as ProgressInternals;
    const repository = new LocalCuppingRepository(host.db);
    const all = await repository.listObservationsForSession(sessionId);
    const bySample = new Map<string, SensoryObservation[]>();
    for (const observation of all) {
      const list = bySample.get(observation.sampleId) ?? [];
      list.push(observation);
      bySample.set(observation.sampleId, list);
    }

    const patched = original.map((item): SampleStageProgress => {
      const sampleObservations = bySample.get(item.sampleId) ?? [];
      if (item.stageId === "overall") {
        const stageObservations = sampleObservations.filter((observation) => observation.stageId === "overall");
        const status = overallEntryStatus(stageObservations);
        return {
          ...item,
          status,
          completedAt: status === "completed" ? item.completedAt ?? latestTimestamp(stageObservations) : undefined
        };
      }
      if (item.stageId === "scoring") {
        const status = aggregateScoringStatus(sampleObservations);
        return {
          ...item,
          status,
          completedAt: status === "completed" ? item.completedAt ?? latestTimestamp(sampleObservations) : undefined
        };
      }
      return item;
    });

    const existingScoring = new Set(patched.filter((item) => item.stageId === "scoring").map((item) => item.sampleId));
    for (const [sampleId, sampleObservations] of bySample) {
      if (existingScoring.has(sampleId)) continue;
      const status = aggregateScoringStatus(sampleObservations);
      if (status === "not_started") continue;
      const updatedAt = latestTimestamp(sampleObservations);
      patched.push({
        sampleId,
        stageId: "scoring",
        status,
        observationCount: latestObservationsByField(sampleObservations).filter((item) => hasMeaningfulValue(item.value)).length,
        startedAt: updatedAt || undefined,
        completedAt: status === "completed" ? updatedAt || undefined : undefined,
        updatedAt
      });
    }
    return patched;
  };
}

interface RendererInternals {
  root: HTMLElement;
  state?: CuppingScreenState;
  controller: CuppingScreenController;
  summaryReader: { listObservations(sampleId: string): Promise<readonly SensoryObservation[]> };
  options: { now(): string };
  run(work: () => Promise<void>): Promise<void>;
  render(): Promise<void>;
}

interface RendererPrototype {
  [UI_PATCH_FLAG]?: boolean;
  render(this: RendererInternals): Promise<void>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function latestStageValue(observations: readonly SensoryObservation[], stageId: StageId, fieldKey: string): unknown {
  return latestObservationValue(observations.filter((item) => item.stageId === stageId), fieldKey);
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cupping-final-ux-20260910]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCuppingFinalUx20260910 = "true";
  style.textContent = `
    .flavor-tag{
      border:0.8px solid rgba(154,157,160,.72)!important;
      border-radius:7px!important;
      background:transparent!important;
      color:#d4d1ca!important;
      box-shadow:none!important;
      cursor:pointer!important;
    }
    .flavor-tag[aria-pressed="true"]{
      border-color:rgba(154,157,160,.92)!important;
      background:transparent!important;
      color:#e1c98f!important;
      font-weight:750!important;
      box-shadow:none!important;
    }

    .aroma-dual-entry__targets{grid-template-columns:minmax(0,1fr) 32px minmax(0,1fr)!important;gap:0!important}
    .aroma-dual-entry__bridge{width:32px!important;margin:0 -1px!important;gap:0!important;align-content:center!important}
    .aroma-dual-entry__bridge button{
      width:100%!important;height:40px!important;min-height:40px!important;padding:0!important;margin:0!important;
      border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;
      color:#d6bd82!important;font-size:25px!important;font-weight:900!important;line-height:1!important;
    }
    .aroma-dual-entry__bridge button:disabled{opacity:.32!important}

    .aroma-affective-score{display:grid;grid-template-columns:34px minmax(0,1fr) 26px;gap:7px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07)}
    .aroma-affective-score__label{font-size:11px;color:#aaa39a}
    .aroma-affective-score__input{width:100%;accent-color:var(--as-gold,#b9995a)}
    .aroma-affective-score__value{text-align:center;color:#d9c28f;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}
    .aroma-affective-score.is-unset .aroma-affective-score__value{color:#74716c}

    .flavor-replication{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:0 0 10px;padding:0}
    .flavor-replication__button{min-height:40px;padding:6px 8px;border:1px solid rgba(154,157,160,.52);border-radius:7px;background:transparent;color:#d6d1c7;font:inherit;font-size:11px;font-weight:700}
    .flavor-replication__button:disabled{opacity:.32}

    .floating-note-trigger{border:0!important;background:var(--as-gold,#b9995a)!important;color:#111!important;box-shadow:0 6px 22px rgba(0,0,0,.34)!important}

    .cupping-main__stage-strip .cupping-stage-step{justify-items:center!important;text-align:center!important;padding-left:0!important;padding-right:0!important}
    .cupping-main__stage-strip .cupping-stage-step__status-dot,
    .cupping-main__stage-strip .cupping-stage-step__label,
    .cupping-main__stage-strip .cupping-stage-step__index{justify-self:center!important;margin-left:auto!important;margin-right:auto!important}
    .cupping-main__stage-strip .cupping-stage-step__label{width:max-content!important;max-width:1.4em!important;text-align:center!important}

    .cupping-main__footer.is-two-action{grid-template-columns:1fr 1fr!important;align-items:center!important}
    .cupping-main__footer.is-two-action .cupping-nav--previous{grid-column:1!important}
    .cupping-main__footer.is-two-action .cupping-nav--next{grid-column:2!important}
    .cupping-main__footer.is-two-action .cupping-nav--previous,
    .cupping-main__footer.is-two-action .cupping-nav--next{
      min-height:38px!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;padding:0!important;
      font-size:0!important;color:transparent!important;overflow:visible!important;
    }
    .cupping-main__footer.is-two-action .cupping-nav--previous::before,
    .cupping-main__footer.is-two-action .cupping-nav--next::before{
      display:inline-block;font-size:18px;line-height:1;letter-spacing:1px;font-weight:900;
      -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
    }
    .cupping-main__footer.is-two-action .cupping-nav--previous::before{
      content:"◀◀◀◀◀";
      background-image:linear-gradient(to right,#f0ebe1 0%,#d5c9b1 25%,#ae9e7f 50%,#87795f 75%,#625949 100%);
    }
    .cupping-main__footer.is-two-action .cupping-nav--next::before{
      content:"▶▶▶▶▶";
      background-image:linear-gradient(to right,#625949 0%,#87795f 25%,#ae9e7f 50%,#d5c9b1 75%,#f0ebe1 100%);
    }

    @media(max-width:720px){
      .flavor-replication{grid-template-columns:repeat(2,minmax(0,1fr))}
      .aroma-dual-entry__targets{grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr)!important}
      .aroma-dual-entry__bridge{width:28px!important}
      .aroma-dual-entry__bridge button{height:38px!important;min-height:38px!important;font-size:23px!important}
      .cupping-main__footer.is-two-action .cupping-nav--previous::before,
      .cupping-main__footer.is-two-action .cupping-nav--next::before{font-size:16px;letter-spacing:0}
    }
  `;
  document.head.append(style);
}

function setBridgeSymbols(root: HTMLElement): void {
  for (const control of root.querySelectorAll<HTMLButtonElement>(".aroma-dual-entry__bridge-button")) {
    const label = `${control.getAttribute("aria-label") ?? ""} ${control.title}`;
    if (label.includes("互换")) control.textContent = "⇄";
    else if (label.includes("湿香复制到干香")) control.textContent = "←";
    else if (label.includes("干香复制到湿香")) control.textContent = "→";
  }
}

function saveRendererField(renderer: RendererInternals, fieldKey: string, value: unknown, restoreScroll?: number): void {
  void renderer.run(async () => {
    renderer.state = await renderer.controller.saveField(fieldKey, value, renderer.options.now());
  }).then(() => {
    if (restoreScroll === undefined) return;
    requestAnimationFrame(() => {
      const editor = renderer.root.querySelector<HTMLElement>(".cupping-main__editor");
      if (editor) editor.scrollTop = restoreScroll;
    });
  }).catch((error) => console.error("AromaSense final UX save failed", error));
}

function scoreField(
  renderer: RendererInternals,
  key: typeof AROMA_SCA_SCORE_FIELDS[number],
  value: unknown,
  locked: boolean
): HTMLElement {
  const valid = typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9;
  const field = element("label", `aroma-affective-score${valid ? "" : " is-unset"}`);
  field.dataset.aromaScaScore = key;
  field.append(element("span", "aroma-affective-score__label", "评分"));
  const input = element("input", "aroma-affective-score__input");
  input.type = "range";
  input.min = "1";
  input.max = "9";
  input.step = "1";
  input.value = valid ? String(value) : "5";
  input.disabled = locked;
  const output = element("output", "aroma-affective-score__value", valid ? String(value) : "—");
  input.addEventListener("input", () => { output.value = input.value; field.classList.remove("is-unset"); });
  input.addEventListener("change", () => saveRendererField(renderer, key, Number(input.value)));
  field.append(input, output);
  return field;
}

function installAromaScores(renderer: RendererInternals, observations: readonly SensoryObservation[], locked: boolean): void {
  const dry = renderer.root.querySelector<HTMLElement>(".aroma-target--dry");
  const wet = renderer.root.querySelector<HTMLElement>(".aroma-target--wet");
  if (!dry || !wet) return;
  dry.querySelector("[data-aroma-sca-score]")?.remove();
  wet.querySelector("[data-aroma-sca-score]")?.remove();
  dry.append(scoreField(renderer, AROMA_SCA_SCORE_FIELDS[0], latestObservationValue(observations, AROMA_SCA_SCORE_FIELDS[0]), locked));
  wet.append(scoreField(renderer, AROMA_SCA_SCORE_FIELDS[1], latestObservationValue(observations, AROMA_SCA_SCORE_FIELDS[1]), locked));
}

function installFlavorReplication(renderer: RendererInternals, observations: readonly SensoryObservation[], locked: boolean): void {
  const editor = renderer.root.querySelector<HTMLElement>(".cupping-main__editor");
  if (!editor || editor.querySelector(".flavor-replication")) return;
  const firstPicker = editor.querySelector<HTMLElement>(".flavor-groups");
  if (!firstPicker) return;

  const high = stringArray(latestStageValue(observations, "high_temp", "flavor_tags"));
  const mid = stringArray(latestStageValue(observations, "mid_temp", "flavor_tags"));
  const low = stringArray(latestStageValue(observations, "low_temp", "flavor_tags"));
  const all = stableFlavorUnion(high, mid, low);
  const sources: ReadonlyArray<[string, readonly string[]]> = [
    ["加载高温风味", high],
    ["加载中温风味", mid],
    ["加载低温风味", low],
    ["全部加载", all]
  ];
  const controls = element("section", "flavor-replication");
  controls.setAttribute("aria-label", "复刻温度节点风味");
  for (const [label, tags] of sources) {
    const control = button("flavor-replication__button", label, () => saveRendererField(renderer, "flavor_tags", [...tags]));
    control.disabled = locked || tags.length === 0;
    control.title = tags.length ? `复刻 ${tags.length} 个风味标签` : "对应温度节点尚无风味标签";
    controls.append(control);
  }
  firstPicker.before(controls);
}

function removeLegacyPhaseNav(editor: HTMLElement): void {
  for (const nav of editor.querySelectorAll(".final-assessment__phase-nav")) nav.remove();
}

function updateOverallPage(editor: HTMLElement, observations: readonly SensoryObservation[]): void {
  for (const key of AROMA_SCA_SCORE_FIELDS) editor.querySelector<HTMLElement>(`[data-field-key="${key}"]`)?.remove();
  const section = [...editor.querySelectorAll<HTMLElement>(".final-assessment__section")]
    .find((node) => node.querySelector(".final-assessment__section-title")?.textContent?.includes("SCA CVA"));
  const note = section?.querySelector<HTMLElement>(".final-assessment__sca-note");
  if (note) note.textContent = "此页只录入其余 6 项 Affective 评分；干香与湿香分值直接取香气节点，不再重复录入。";

  const score = calculateAggregateSCAScore(observations);
  const value = editor.querySelector<HTMLElement>(".final-assessment__live-score-value");
  if (value) value.textContent = score.complete && score.score !== undefined ? score.score.toFixed(2) : "—";
  const status = editor.querySelector<HTMLElement>(".final-assessment__live-score-note");
  if (status) {
    status.textContent = score.complete
      ? "SCA-104：香气节点干香/湿香 2 项 + 综评节点 6 项，并计入非一致杯 / 缺陷杯扣分。"
      : `待完成：${score.missing.length + score.invalid.length} 项；干香与湿香分值从香气节点读取。`;
    status.classList.toggle("is-warning", !score.complete);
  }
}

function scoreMissingLabel(fieldKey: string): string {
  if (fieldKey === AROMA_SCA_SCORE_FIELDS[0]) return "（香气/干香评分）";
  if (fieldKey === AROMA_SCA_SCORE_FIELDS[1]) return "（香气/湿香评分）";
  if (fieldKey === SCA_NON_UNIFORM_CUPS_FIELD) return "（综评/非一致性杯数）";
  if (fieldKey === SCA_DEFECTIVE_CUPS_FIELD) return "（综评/缺陷杯数）";
  if (fieldKey === SCA_DEFECT_TYPES_VALIDATION_KEY) return "（综评/缺陷类型）";
  if (fieldKey === SCA_DEFECT_UNIFORMITY_VALIDATION_KEY) return "（综评/杯间一致性）";
  return `（综评/${SCORE_LABELS.get(fieldKey) ?? fieldKey}）`;
}

function updateScoringPage(editor: HTMLElement, observations: readonly SensoryObservation[]): void {
  const normalized = latestObservationsByField(observations);
  const score = calculateSCACVAScore(normalized);
  const map = new Map<string, unknown>(normalized.map((item) => [item.fieldKey, item.value] as const));
  const value = editor.querySelector<HTMLElement>(".final-assessment__score-value");
  if (value) value.textContent = score.complete && score.score !== undefined ? score.score.toFixed(2) : "—";
  const note = editor.querySelector<HTMLElement>(".final-assessment__score-note");
  if (note) {
    note.textContent = score.complete
      ? `SCA-104 · 香气节点干香/湿香分值直接计入 · 非一致杯 −${score.nonUniformPenalty ?? 0} · 缺陷杯 −${score.defectivePenalty ?? 0}`
      : "评分输入尚未完整";
    note.classList.toggle("is-warning", !score.complete);
  }

  const rows = [...editor.querySelectorAll<HTMLElement>(".final-assessment__score-row")];
  SCA_CVA_AFFECTIVE_FIELDS.forEach((field, index) => {
    const output = rows[index]?.querySelector<HTMLElement>(".final-assessment__score-number");
    const raw = map.get(field.key);
    if (output) output.textContent = typeof raw === "number" && Number.isFinite(raw) ? raw.toFixed(0) : "—";
  });

  editor.querySelector(".final-assessment__score-confirm")?.remove();
  editor.querySelector(".final-assessment__score-lock-note")?.remove();
  editor.querySelector(".scoring-missing-fields")?.remove();
  if (!score.complete) {
    const issues = [...new Set([...score.missing, ...score.invalid])].map(scoreMissingLabel);
    if (issues.length) editor.prepend(element("div", "scoring-missing-fields", `未完成：${issues.join("")}`));
  }
}

function openOverallQuickRecord(renderer: RendererInternals, initial: string): void {
  renderer.root.querySelector(".floating-note-overlay")?.remove();
  const editor = renderer.root.querySelector<HTMLElement>(".cupping-main__editor");
  const scrollTop = editor?.scrollTop ?? 0;
  const overlay = element("div", "floating-note-overlay");
  const panel = element("section", "floating-note-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "综评快速记录");
  const text = element("textarea", "floating-note-panel__textarea");
  text.value = initial;
  const actions = element("div", "floating-note-panel__actions");
  const clear = button("floating-note-panel__clear", "🗑︎", () => { text.value = ""; text.focus(); });
  clear.title = "清空";
  clear.setAttribute("aria-label", "清空综评快速记录");
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    const next = text.value;
    overlay.remove();
    saveRendererField(renderer, "overall_summary", next, scrollTop);
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

function installOverallQuickRecord(renderer: RendererInternals, observations: readonly SensoryObservation[], locked: boolean): void {
  if (locked || renderer.root.querySelector(".floating-note-trigger")) return;
  const current = latestObservationValue(observations, "overall_summary");
  const trigger = button("floating-note-trigger", "✍︎", () => openOverallQuickRecord(renderer, typeof current === "string" ? current : ""));
  trigger.title = "综评快速记录";
  trigger.setAttribute("aria-label", "综评快速记录");
  renderer.root.append(trigger);
}

function applyTriangleNavigation(renderer: RendererInternals): void {
  const steps = [...renderer.root.querySelectorAll<HTMLButtonElement>(".cupping-main__stage-strip .cupping-stage-step")];
  const currentIndex = steps.findIndex((step) => step.classList.contains("is-current"));
  if (currentIndex < 0) return;
  const previous = renderer.root.querySelector<HTMLButtonElement>(".cupping-main__footer .cupping-nav--previous");
  const next = renderer.root.querySelector<HTMLButtonElement>(".cupping-main__footer .cupping-nav--next");
  if (previous) {
    previous.textContent = "←";
    previous.setAttribute("aria-label", "上一步");
    previous.style.display = currentIndex === 0 ? "none" : "block";
  }
  if (next) {
    next.textContent = "→";
    next.setAttribute("aria-label", "下一步");
    next.style.display = currentIndex === steps.length - 1 ? "none" : "block";
  }
}

async function applyFinalUx(renderer: RendererInternals): Promise<void> {
  installStyles();
  const state = renderer.state;
  const active = state?.active;
  if (!state || !active) return;
  const locked = state.lockedSampleIds.includes(active.context.sampleId);
  const observations = await renderer.summaryReader.listObservations(active.context.sampleId);
  const editor = renderer.root.querySelector<HTMLElement>(".cupping-main__editor");
  if (!editor) return;

  setBridgeSymbols(renderer.root);
  if (active.context.stageId === "aroma") installAromaScores(renderer, observations, locked);
  if (active.context.stageId === "flavor") installFlavorReplication(renderer, observations, locked);
  if (active.context.stageId === "overall") {
    removeLegacyPhaseNav(editor);
    updateOverallPage(editor, observations);
    installOverallQuickRecord(renderer, observations, locked);
  }
  if (active.context.stageId === "scoring") {
    removeLegacyPhaseNav(editor);
    updateScoringPage(editor, observations);
  }
  applyTriangleNavigation(renderer);
}

function installRendererPatch(): void {
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[UI_PATCH_FLAG]) return;
  prototype[UI_PATCH_FLAG] = true;
  const originalRender = prototype.render;
  prototype.render = async function(): Promise<void> {
    await originalRender.call(this);
    await applyFinalUx(this);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installEditingPolicyPatch();
  installProgressPolicyPatch();
  installRendererPatch();
}
