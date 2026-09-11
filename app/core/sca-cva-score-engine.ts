import type { SensoryObservation } from "../../shared/protocol/aromasense-v1";

export const SCA_CVA_CALCULATOR_VERSION = "sca-cva-affective-104-2024" as const;

export const SCA_CVA_AFFECTIVE_FIELDS = [
  { key: "final_sca_affective_fragrance", label: "干香", shortLabel: "干香" },
  { key: "final_sca_affective_aroma", label: "湿香", shortLabel: "湿香" },
  { key: "final_sca_affective_flavor", label: "风味", shortLabel: "风味" },
  { key: "final_sca_affective_aftertaste", label: "余韵", shortLabel: "余韵" },
  { key: "final_sca_affective_acidity", label: "酸质", shortLabel: "酸质" },
  { key: "final_sca_affective_sweetness", label: "甜感", shortLabel: "甜感" },
  { key: "final_sca_affective_mouthfeel", label: "口感", shortLabel: "口感" },
  { key: "final_sca_affective_overall", label: "总体", shortLabel: "总体" }
] as const;

export const SCA_NON_UNIFORM_CUPS_FIELD = "final_sca_non_uniform_cups" as const;
export const SCA_DEFECTIVE_CUPS_FIELD = "final_sca_defective_cups" as const;
export const SCA_NON_UNIFORM_CUP_IDS_FIELD = "final_sca_non_uniform_cup_ids" as const;
export const SCA_DEFECTIVE_CUP_IDS_FIELD = "final_sca_defective_cup_ids" as const;
export const SCA_CUP_CAPACITY_FIELD = "final_sca_cup_capacity" as const;
export const SCA_DEFECT_TYPES_VALIDATION_KEY = "final_sca_defect_types" as const;
export const SCA_DEFECT_UNIFORMITY_VALIDATION_KEY = "final_sca_defect_uniformity_consistency" as const;
export const SCA_CVA_DEFECT_TYPE_IDS = ["defect-potato", "defect-mold", "defect-phenolic"] as const;
export const SCA_CVA_REQUIRED_FIELD_KEYS = [
  ...SCA_CVA_AFFECTIVE_FIELDS.map((field) => field.key),
  SCA_NON_UNIFORM_CUPS_FIELD,
  SCA_DEFECTIVE_CUPS_FIELD
] as const;

export interface SCACVAScoreResult {
  calculatorVersion: typeof SCA_CVA_CALCULATOR_VERSION;
  complete: boolean;
  score?: number;
  rawScore?: number;
  affectiveSum?: number;
  nonUniformCups?: number;
  defectiveCups?: number;
  defectTypes?: string[];
  nonUniformPenalty?: number;
  defectivePenalty?: number;
  missing: string[];
  invalid: string[];
}

function lastValue(observations: readonly SensoryObservation[], fieldKey: string): unknown {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    if (observations[index]?.fieldKey === fieldKey) return observations[index]?.value;
  }
  return undefined;
}

function affectiveScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9 ? value : undefined;
}

function cupCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function optionalCupCount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return 0;
  return cupCount(value);
}

function cupCapacity(observations: readonly SensoryObservation[], nonUniformCups: number | undefined, defectiveCups: number | undefined): number {
  const raw = lastValue(observations, SCA_CUP_CAPACITY_FIELD);
  const explicit = typeof raw === "number" && Number.isInteger(raw) && raw >= 5 ? raw : 5;
  return Math.max(5, explicit, nonUniformCups ?? 0, defectiveCups ?? 0);
}

function roundToQuarter(value: number): number {
  return Math.round((value + Number.EPSILON) * 4) / 4;
}

function selectedSCADefectTypes(observations: readonly SensoryObservation[]): string[] {
  const raw = lastValue(observations, "defect_ids");
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(SCA_CVA_DEFECT_TYPE_IDS);
  return [...new Set(raw.filter((value): value is string => typeof value === "string" && allowed.has(value)))];
}

/**
 * Implements the SCA-104 Affective Assessment total-score equation.
 * Eight 1–9 final affective scores are converted to the 0–100 base score,
 * then 2 points are deducted per non-uniform cup and 4 per defective cup.
 * Cup selectors are optional: no selected cup is equivalent to zero penalty.
 * Affective scores remain mandatory and are never silently replaced with zero.
 */
export function calculateSCACVAScore(observations: readonly SensoryObservation[]): SCACVAScoreResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const scores: number[] = [];

  for (const field of SCA_CVA_AFFECTIVE_FIELDS) {
    const raw = lastValue(observations, field.key);
    if (raw === undefined || raw === null || raw === "") {
      missing.push(field.key);
      continue;
    }
    const value = affectiveScore(raw);
    if (value === undefined) invalid.push(field.key);
    else scores.push(value);
  }

  const nonUniformRaw = lastValue(observations, SCA_NON_UNIFORM_CUPS_FIELD);
  const defectiveRaw = lastValue(observations, SCA_DEFECTIVE_CUPS_FIELD);
  const nonUniformCups = optionalCupCount(nonUniformRaw);
  const defectiveCups = optionalCupCount(defectiveRaw);
  const defectTypes = selectedSCADefectTypes(observations);
  const capacity = cupCapacity(observations, nonUniformCups, defectiveCups);

  if (nonUniformCups === undefined) invalid.push(SCA_NON_UNIFORM_CUPS_FIELD);
  if (defectiveCups === undefined) invalid.push(SCA_DEFECTIVE_CUPS_FIELD);

  if (defectiveCups !== undefined && defectiveCups > 0 && defectTypes.length === 0) {
    invalid.push(SCA_DEFECT_TYPES_VALIDATION_KEY);
  }
  if (
    defectiveCups !== undefined
    && nonUniformCups !== undefined
    && defectiveCups > nonUniformCups
    && defectiveCups !== capacity
  ) {
    invalid.push(SCA_DEFECT_UNIFORMITY_VALIDATION_KEY);
  }

  if (missing.length || invalid.length || scores.length !== SCA_CVA_AFFECTIVE_FIELDS.length || nonUniformCups === undefined || defectiveCups === undefined) {
    return { calculatorVersion: SCA_CVA_CALCULATOR_VERSION, complete: false, nonUniformCups, defectiveCups, defectTypes, missing, invalid };
  }

  const affectiveSum = scores.reduce((sum, value) => sum + value, 0);
  const nonUniformPenalty = nonUniformCups * 2;
  const defectivePenalty = defectiveCups * 4;
  const rawScore = 52.75 + 0.65625 * affectiveSum - nonUniformPenalty - defectivePenalty;
  return {
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION,
    complete: true,
    score: roundToQuarter(rawScore),
    rawScore,
    affectiveSum,
    nonUniformCups,
    defectiveCups,
    defectTypes,
    nonUniformPenalty,
    defectivePenalty,
    missing,
    invalid
  };
}

export function isSCAScoreField(fieldKey: string): boolean {
  return (SCA_CVA_REQUIRED_FIELD_KEYS as readonly string[]).includes(fieldKey);
}
