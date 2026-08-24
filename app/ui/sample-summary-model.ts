import type { SummaryObservation } from "../storage/sample-summary-reader";

export interface RadarAxisValue {
  key: string;
  label: string;
  value: number;
  max: number;
}

const AXES: readonly { key: string; label: string; max: number }[] = [
  { key: "acidity_intensity", label: "酸质", max: 10 },
  { key: "sweetness_intensity", label: "甜感", max: 10 },
  { key: "bitterness_intensity", label: "苦味", max: 10 },
  { key: "mouthfeel_intensity", label: "口感", max: 10 },
  { key: "finish_intensity", label: "余韵", max: 10 }
];

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildRadarSummary(observations: readonly SummaryObservation[]): readonly RadarAxisValue[] {
  return AXES.map((axis) => {
    const values = observations
      .filter((item) => item.fieldKey === axis.key && typeof item.value === "number" && Number.isFinite(item.value))
      .map((item) => item.value as number);
    return { ...axis, value: mean(values) };
  });
}

export function collectFlavorTags(observations: readonly SummaryObservation[]): readonly string[] {
  const tags = new Set<string>();
  for (const observation of observations) {
    if (observation.fieldKey !== "flavor_tags" || !Array.isArray(observation.value)) continue;
    for (const value of observation.value) {
      if (typeof value === "string") tags.add(value);
    }
  }
  return [...tags];
}
