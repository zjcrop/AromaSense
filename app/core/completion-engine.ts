import type { SensoryObservation, StageId } from "../../shared/protocol/aromasense-v1";

export interface CompletionResult {
  complete: boolean;
  observed: number;
  required: number;
  missing: readonly string[];
}

const QUALITY_KEYS = ["quality_flavor", "quality_aftertaste", "quality_acidity", "quality_sweetness", "quality_body", "quality_clean", "quality_uniformity", "quality_balance"] as const;
const REQUIRED_FIELDS: Partial<Record<StageId, readonly string[]>> = {
  preparation: ["dry_fragrance_intensity"],
  aroma: ["wet_aroma_intensity", "flavor_tags"],
  high_temp: ["flavor_tags", "acidity_intensity", "sweetness_intensity", "bitterness_intensity", "mouthfeel_intensity"],
  mid_temp: ["flavor_tags", "acidity_intensity", "sweetness_intensity", "bitterness_intensity", "mouthfeel_intensity", "finish_intensity"],
  low_temp: ["flavor_tags", "acidity_intensity", "sweetness_intensity", "bitterness_intensity", "mouthfeel_intensity", "finish_intensity"],
  flavor: ["flavor_tags"],
  overall: QUALITY_KEYS,
  scoring: ["score_confirmed"]
};

function meaningful(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

export function completionForStage(stageId: StageId, observations: readonly SensoryObservation[]): CompletionResult {
  const values = new Map(observations.filter((item) => meaningful(item.value)).map((item) => [item.fieldKey, item.value] as const));
  if (stageId === "final") {
    const required = ["final_score_confirmed"] as const;
    const missing = required.filter((key) => values.get(key) !== true);
    return { complete: missing.length === 0, observed: required.length - missing.length, required: required.length, missing };
  }
  const required = REQUIRED_FIELDS[stageId] ?? [];
  const missing = required.filter((key) => key === "score_confirmed" ? values.get(key) !== true : !values.has(key));
  return { complete: missing.length === 0, observed: required.length - missing.length, required: required.length, missing };
}
