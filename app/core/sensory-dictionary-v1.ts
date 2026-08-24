import type { StageId } from "../../shared/protocol/aromasense-v1";

export const SENSORY_DICTIONARY_VERSION = "sensory-dictionary/1.1" as const;

export type SensoryValueKind = "boolean" | "intensity" | "score" | "text" | "tags";
export type SensoryAssessmentLayer = "descriptive" | "affective" | "process" | "notes";

export interface SensoryFieldDefinition {
  key: string;
  label: string;
  valueKind: SensoryValueKind;
  assessmentLayer: SensoryAssessmentLayer;
  stages: readonly StageId[];
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

export interface DescriptorDefinition {
  id: string;
  label: string;
  groupId: string;
}

export interface DescriptorGroupDefinition {
  id: string;
  label: string;
  defaultCollapsed: boolean;
  descriptors: readonly DescriptorDefinition[];
}

const TEMPERATURE_STAGES = ["high_temp", "mid_temp", "low_temp"] as const satisfies readonly StageId[];
const DESCRIPTIVE_SCALE = { min: 0, max: 15, step: 0.5 } as const;
const AFFECTIVE_SCALE = { min: 1, max: 9, step: 1 } as const;

/**
 * AromaSense keeps descriptive intensity and affective quality impression in
 * separate persisted fields. Temperature-stage repetition is an AromaSense
 * workflow extension; it must not be interpreted as an SCA-prescribed scoring
 * schedule.
 */
export const SENSORY_FIELDS_V1: readonly SensoryFieldDefinition[] = [
  {
    key: "dry_fragrance_intensity",
    label: "干香强度",
    valueKind: "intensity",
    assessmentLayer: "descriptive",
    stages: ["preparation", "aroma"],
    ...DESCRIPTIVE_SCALE
  },
  {
    key: "wet_aroma_intensity",
    label: "湿香强度",
    valueKind: "intensity",
    assessmentLayer: "descriptive",
    stages: ["aroma"],
    ...DESCRIPTIVE_SCALE
  },
  {
    key: "flavor_tags",
    label: "风味描述",
    valueKind: "tags",
    assessmentLayer: "descriptive",
    stages: ["aroma", ...TEMPERATURE_STAGES, "final"]
  },
  {
    key: "acidity_intensity",
    label: "酸质强度",
    valueKind: "intensity",
    assessmentLayer: "descriptive",
    stages: TEMPERATURE_STAGES,
    ...DESCRIPTIVE_SCALE
  },
  {
    key: "sweetness_intensity",
    label: "甜感强度",
    valueKind: "intensity",
    assessmentLayer: "descriptive",
    stages: TEMPERATURE_STAGES,
    ...DESCRIPTIVE_SCALE
  },
  {
    key: "bitterness_intensity",
    label: "苦味强度",
    valueKind: "intensity",
    assessmentLayer: "descriptive",
    stages: TEMPERATURE_STAGES,
    ...DESCRIPTIVE_SCALE
  },
  {
    key: "mouthfeel_intensity",
    label: "口感 / 质地强度",
    valueKind: "intensity",
    assessmentLayer: "descriptive",
    stages: TEMPERATURE_STAGES,
    ...DESCRIPTIVE_SCALE
  },
  {
    key: "finish_intensity",
    label: "余韵强度",
    valueKind: "intensity",
    assessmentLayer: "descriptive",
    stages: ["mid_temp", "low_temp", "final"],
    ...DESCRIPTIVE_SCALE
  },
  {
    key: "defect_present",
    label: "感官缺陷存在",
    valueKind: "boolean",
    assessmentLayer: "descriptive",
    stages: ["aroma", ...TEMPERATURE_STAGES, "final"]
  },
  {
    key: "affective_fragrance_aroma",
    label: "香气质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "affective_flavor_aftertaste",
    label: "风味 / 余韵质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "affective_acidity",
    label: "酸质质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "affective_sweetness",
    label: "甜感质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "affective_mouthfeel",
    label: "口感质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "notes",
    label: "备注",
    valueKind: "text",
    assessmentLayer: "notes",
    stages: ["preparation", "aroma", ...TEMPERATURE_STAGES, "final"]
  }
] as const;

function descriptors(groupId: string, items: readonly [string, string][]): readonly DescriptorDefinition[] {
  return items.map(([id, label]) => ({ id, label, groupId }));
}

export const DESCRIPTOR_GROUPS_V1: readonly DescriptorGroupDefinition[] = [
  {
    id: "floral",
    label: "花香",
    defaultCollapsed: true,
    descriptors: descriptors("floral", [
      ["jasmine", "茉莉"], ["rose", "玫瑰"], ["orange_blossom", "橙花"], ["tea_flower", "茶花感"]
    ])
  },
  {
    id: "fruit",
    label: "水果",
    defaultCollapsed: true,
    descriptors: descriptors("fruit", [
      ["citrus", "柑橘"], ["berry", "莓果"], ["stone_fruit", "核果"], ["tropical_fruit", "热带水果"], ["dried_fruit", "干果"]
    ])
  },
  {
    id: "sweet",
    label: "甜香",
    defaultCollapsed: true,
    descriptors: descriptors("sweet", [
      ["honey", "蜂蜜"], ["caramel", "焦糖"], ["brown_sugar", "红糖"], ["vanilla", "香草"]
    ])
  },
  {
    id: "roast_nut_cocoa",
    label: "烘烤 / 坚果 / 可可",
    defaultCollapsed: true,
    descriptors: descriptors("roast_nut_cocoa", [
      ["nutty", "坚果"], ["cocoa", "可可"], ["toast", "烘烤"], ["smoky", "烟熏"]
    ])
  },
  {
    id: "fermentation_spice",
    label: "发酵 / 香料",
    defaultCollapsed: true,
    descriptors: descriptors("fermentation_spice", [
      ["winey", "酒香"], ["fermented", "发酵感"], ["spice", "香料"], ["herbal", "草本"]
    ])
  },
  {
    id: "defect",
    label: "缺陷",
    defaultCollapsed: true,
    descriptors: descriptors("defect", [
      ["phenolic", "酚类 / 药味"], ["musty", "霉味 / 陈味"], ["earthy", "土味"],
      ["rubbery", "橡胶味"], ["overfermented", "过度发酵"], ["astringent", "明显涩感"]
    ])
  }
] as const;

const fieldByKey = new Map(SENSORY_FIELDS_V1.map((field) => [field.key, field] as const));
const descriptorById = new Map(
  DESCRIPTOR_GROUPS_V1.flatMap((group) => group.descriptors).map((descriptor) => [descriptor.id, descriptor] as const)
);

export function sensoryFieldDefinition(key: string): SensoryFieldDefinition | undefined {
  return fieldByKey.get(key);
}

export function descriptorDefinition(id: string): DescriptorDefinition | undefined {
  return descriptorById.get(id);
}

export function fieldsForStage(stageId: StageId): readonly SensoryFieldDefinition[] {
  return SENSORY_FIELDS_V1.filter((field) => field.stages.includes(stageId));
}
