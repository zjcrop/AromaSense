import type { StageId, SensoryObservation } from "../../shared/protocol/aromasense-v1";
import type { StageStatus } from "./cupping-state-machine";
import { completionForStage } from "./completion-engine";

export const FINAL_ASSESSMENT_PHASES = ["flavor", "overall", "score"] as const;
export type FinalAssessmentPhase = (typeof FINAL_ASSESSMENT_PHASES)[number];

export interface FinalPhaseProgress {
  phase: FinalAssessmentPhase;
  status: StageStatus;
  completionHint: string;
}

export const STAGE_COMPLETION_HINTS: Readonly<Record<Exclude<StageId, "final">, string>> = {
  preparation: "记录干香强度",
  aroma: "记录湿香强度并选择至少一个风味描述",
  high_temp: "完成风味、酸质、甜感、苦味与口感强度",
  mid_temp: "完成风味、酸质、甜感、苦味、口感与余韵强度",
  low_temp: "完成风味、酸质、甜感、苦味、口感与余韵强度",
  flavor: "选择至少一个最终风味描述",
  overall: "完成风味、余韵、酸质、甜感、醇厚度、干净度、一致性与平衡性八项综评",
  scoring: "查看计算结果后主动确认评分"
};

const FINAL_OVERALL_REQUIRED_FIELDS = [
  "quality_flavor",
  "quality_aftertaste",
  "quality_acidity",
  "quality_sweetness",
  "quality_body",
  "quality_clean",
  "quality_uniformity",
  "quality_balance"
] as const;

const CONTROL_FIELDS = new Set(["final_phase"]);

export const FINAL_PHASE_COMPLETION_HINTS: Readonly<Record<FinalAssessmentPhase, string>> = {
  flavor: "选择至少一个最终风味描述",
  overall: "完成风味、余韵、酸质、甜感、醇厚度、干净度、一致性与平衡性八项综评",
  score: "查看计算结果后主动确认评分"
};

export function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function observationMap(observations: readonly SensoryObservation[]): Map<string, unknown> {
  return new Map(observations.map((observation) => [observation.fieldKey, observation.value] as const));
}

function allPresent(map: ReadonlyMap<string, unknown>, fieldKeys: readonly string[]): boolean {
  return fieldKeys.every((fieldKey) => hasMeaningfulValue(map.get(fieldKey)));
}

function anyObservation(
  observations: readonly SensoryObservation[],
  predicate: (fieldKey: string) => boolean = () => true
): boolean {
  return observations.some((observation) =>
    !CONTROL_FIELDS.has(observation.fieldKey)
    && predicate(observation.fieldKey)
    && hasMeaningfulValue(observation.value)
  );
}

export function deriveFinalPhaseStatus(
  phase: FinalAssessmentPhase,
  observations: readonly SensoryObservation[]
): StageStatus {
  const map = observationMap(observations);
  if (phase === "flavor") {
    if (hasMeaningfulValue(map.get("flavor_tags"))) return "completed";
    return "not_started";
  }

  if (phase === "overall") {
    if (allPresent(map, FINAL_OVERALL_REQUIRED_FIELDS)) return "completed";
    const started = anyObservation(observations, (fieldKey) =>
      fieldKey.startsWith("profile_")
      || fieldKey.startsWith("quality_")
      || fieldKey.startsWith("defect_")
      || fieldKey.startsWith("off_flavor_")
      || fieldKey.startsWith("overall_")
    );
    return started ? "active" : "not_started";
  }

  const confirmation = map.get("final_score_confirmed");
  if (confirmation === true) return "completed";
  if (confirmation === false) return "active";
  return "not_started";
}

export function finalPhaseProgress(observations: readonly SensoryObservation[]): readonly FinalPhaseProgress[] {
  return FINAL_ASSESSMENT_PHASES.map((phase) => ({
    phase,
    status: deriveFinalPhaseStatus(phase, observations),
    completionHint: FINAL_PHASE_COMPLETION_HINTS[phase]
  }));
}

export function deriveStageStatus(stageId: StageId, observations: readonly SensoryObservation[]): StageStatus {
  if (stageId === "final") {
    const phases = finalPhaseProgress(observations);
    const score = phases.find((phase) => phase.phase === "score");
    if (score?.status === "completed") return "completed";
    return phases.some((phase) => phase.status !== "not_started") ? "active" : "not_started";
  }

  if (completionForStage(stageId, observations).complete) return "completed";
  return anyObservation(observations) ? "active" : "not_started";
}

export function stageCompletionHint(stageId: StageId): string {
  return stageId === "final"
    ? "最终得分确认后，本样品即视为完成"
    : STAGE_COMPLETION_HINTS[stageId];
}

export function meaningfulObservationCount(observations: readonly SensoryObservation[]): number {
  return observations.filter((observation) =>
    !CONTROL_FIELDS.has(observation.fieldKey) && hasMeaningfulValue(observation.value)
  ).length;
}

export function scoreAffectingField(fieldKey: string): boolean {
  return fieldKey.startsWith("quality_")
    || fieldKey.startsWith("defect_")
    || fieldKey.startsWith("off_flavor_");
}
