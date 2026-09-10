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
  high_temp: ["flavor_tags", "acidity_intensity", "sweetness_intensity", "bitterness_intensity", "mouthfeel_intensity"],
  mid_temp: ["flavor_tags", "acidity_intensity", "sweetness_intensity", "bitterness_intensity", "mouthfeel_intensity", "finish_intensity"],
  low_temp: ["flavor_tags", "acidity_intensity", "sweetness_intensity", "bitterness_intensity", "mouthfeel_intensity", "finish_intensity"],
  flavor: ["flavor_tags"],
  overall: QUALITY_KEYS,
  // Scoring is a derived/read-only result page. It never requires a second user confirmation.
  scoring: []
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
  if (stageId === "aroma") {
    // sensory-dictionary/1.3 separates pre-infusion dry fragrance from the wet
    // aroma released after infusion/break. Historical records used one shared
    // flavor_tags field; keep those records complete without rewriting them.
    const classifiedCapture = values.has("dry_fragrance_tags")
      || values.has("wet_aroma_tags")
      || observations.some((item) => item.dictionaryVersion === "sensory-dictionary/1.3"
        && ["dry_fragrance_intensity", "wet_aroma_intensity"].includes(item.fieldKey));
    const required = classifiedCapture
      ? ["dry_fragrance_intensity", "dry_fragrance_tags", "wet_aroma_intensity", "wet_aroma_tags"] as const
      : ["wet_aroma_intensity", "flavor_tags"] as const;
    const missing = required.filter((key) => key === "wet_aroma_tags"
      ? !values.has("wet_aroma_tags") && !values.has("flavor_tags")
      : !values.has(key));
    return { complete: missing.length === 0, observed: required.length - missing.length, required: required.length, missing };
  }
  if (stageId === "final") {
    // Legacy final pages are now derived from their flavor/overall/score sub-phase state.
    // No `final_score_confirmed` observation is required.
    return { complete: false, observed: 0, required: 0, missing: [] };
  }
  const required = REQUIRED_FIELDS[stageId] ?? [];
  const missing = required.filter((key) => !values.has(key));
  return { complete: missing.length === 0, observed: required.length - missing.length, required: required.length, missing };
}
