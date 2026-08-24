import type { StageId } from "../../shared/protocol/aromasense-v1";
import { fieldsForStage, type SensoryFieldDefinition } from "../core/sensory-dictionary-v1";

export type SensoryControlKind = "slider" | "score" | "toggle" | "text" | "tag-picker";

export interface SensoryControlSpec {
  fieldKey: string;
  label: string;
  kind: SensoryControlKind;
  required: boolean;
  min?: number;
  max?: number;
  step?: number;
}

function controlKind(field: SensoryFieldDefinition): SensoryControlKind {
  switch (field.valueKind) {
    case "intensity":
      return "slider";
    case "score":
      return "score";
    case "boolean":
      return "toggle";
    case "text":
      return "text";
    case "tags":
      return "tag-picker";
  }
}

export function controlsForStage(stageId: StageId): readonly SensoryControlSpec[] {
  return fieldsForStage(stageId).map((field) => ({
    fieldKey: field.key,
    label: field.label,
    kind: controlKind(field),
    required: field.required ?? false,
    min: field.min,
    max: field.max,
    step: field.step
  }));
}
