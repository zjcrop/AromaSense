import type { StageId, SensoryObservation } from "../../shared/protocol/aromasense-v1";
import type { StageStatus } from "./cupping-state-machine";
import { completionForStage } from "./completion-engine";
import { calculateSCACVAScore } from "./sca-cva-score-engine";

export const FINAL_ASSESSMENT_PHASES = ["flavor", "overall", "score"] as const;
export type FinalAssessmentPhase = (typeof FINAL_ASSESSMENT_PHASES)[number];

export interface FinalPhaseProgress {
  phase: FinalAssessmentPhase;
  status: StageStatus;
  completionHint: string;
}

export const STAGE_COMPLETION_HINTS: Readonly<Record<Exclude<StageId, "final">, string>> = {
  preparation: "记录干香强度",
  aroma: "分别完成注水前干香与注水破渣后湿香的强度和描述",
  high_temp: "完成风味、酸质、甜感、苦味与口感强度",
  mid_temp: "完成风味、酸质、甜感、苦味、口感与余韵强度",
  low_temp: "完成风味、酸质、甜感、苦味、口感与余韵强度",
  flavor: "选择至少一个最终风味描述",
  overall: "完成SCA 8项Affective评分、杯数/缺陷类型一致性与香迹洁净度",
  scoring: "查看SCA得分与风味侧写后主动确认"
};

const CONTROL_FIELDS = new Set(["final_phase"]);

export const FINAL_PHASE_COMPLETION_HINTS: Readonly<Record<FinalAssessmentPhase, string>> = {
  flavor: "选择至少一个最终风味描述",
  overall: "完成SCA 8项Affective评分、杯数/缺陷类型一致性与香迹洁净度",
  score: "查看SCA得分、结构雷达与温度—风味演化后主动确认"
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
    const sca = calculateSCACVAScore(observations);
    if (sca.complete && hasMeaningfulValue(map.get("quality_clean"))) return "completed";
    const started = anyObservation(observations, (fieldKey) =>
      fieldKey.startsWith("final_sca_")
      || fieldKey.startsWith("profile_")
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
    ? "最终SCA得分确认后，本样品即视为完成"
    : STAGE_COMPLETION_HINTS[stageId];
}

export function meaningfulObservationCount(observations: readonly SensoryObservation[]): number {
  return observations.filter((observation) =>
    !CONTROL_FIELDS.has(observation.fieldKey) && hasMeaningfulValue(observation.value)
  ).length;
}

export function scoreAffectingField(fieldKey: string): boolean {
  return fieldKey.startsWith("final_sca_")
    || fieldKey.startsWith("quality_")
    || fieldKey.startsWith("defect_")
    || fieldKey.startsWith("off_flavor_");
}
