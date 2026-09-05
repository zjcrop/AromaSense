import type { StageId } from "../../shared/protocol/aromasense-v1";

export const SENSORY_DICTIONARY_VERSION = "sensory-dictionary/1.2" as const;

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
    stages: ["aroma", ...TEMPERATURE_STAGES, "flavor", "final"]
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
    stages: ["mid_temp", "low_temp", "overall", "final"],
    ...DESCRIPTIVE_SCALE
  },
  {
    key: "defect_present",
    label: "感官缺陷存在",
    valueKind: "boolean",
    assessmentLayer: "descriptive",
    stages: ["aroma", ...TEMPERATURE_STAGES, "overall", "final"]
  },
  {
    key: "affective_fragrance_aroma",
    label: "香气质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["overall", "final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "affective_flavor_aftertaste",
    label: "风味 / 余韵质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["overall", "final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "affective_acidity",
    label: "酸质质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["overall", "final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "affective_sweetness",
    label: "甜感质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["overall", "final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "affective_mouthfeel",
    label: "口感质量印象",
    valueKind: "score",
    assessmentLayer: "affective",
    stages: ["overall", "final"],
    ...AFFECTIVE_SCALE
  },
  {
    key: "notes",
    label: "备注",
    valueKind: "text",
    assessmentLayer: "notes",
    stages: ["preparation", "aroma", ...TEMPERATURE_STAGES, "flavor", "overall", "final"]
  }
] as const;

function descriptors(groupId: string, items: readonly [string, string][]): readonly DescriptorDefinition[] {
  return items.map(([id, label]) => ({ id, label, groupId }));
}

/**
 * Stable descriptor ids are persisted. Existing 1.1 ids are deliberately kept
 * when the 1.2 vocabulary becomes more specific, so historical observations do
 * not lose meaning. Coarse ids such as citrus/berry/stone_fruit remain valid as
 * umbrella choices alongside their specific children.
 *
 * Vocabulary is restored from AromaSense/LuckyBean's existing sensory/codebook
 * concepts (including the legacy flavor mapping) rather than treating a broad
 * family name as a substitute for a specific perceived aroma.
 */
export const DESCRIPTOR_GROUPS_V1: readonly DescriptorGroupDefinition[] = [
  {
    id: "floral",
    label: "花香",
    defaultCollapsed: true,
    descriptors: descriptors("floral", [
      ["white_floral", "白花"],
      ["jasmine", "茉莉"],
      ["orange_blossom", "橙花"],
      ["rose", "玫瑰"],
      ["violet", "紫罗兰"],
      ["gardenia", "栀子"],
      ["chamomile", "洋甘菊"],
      ["osmanthus", "桂花"],
      ["lavender", "薰衣草"],
      ["tea_flower", "茶花感"]
    ])
  },
  {
    id: "fruit",
    label: "果香",
    defaultCollapsed: true,
    descriptors: descriptors("fruit", [
      ["citrus", "柑橘类"],
      ["bergamot", "佛手柑"],
      ["lemon", "柠檬"],
      ["lime", "青柠 / 莱姆"],
      ["orange", "橙"],
      ["grapefruit", "葡萄柚 / 西柚"],
      ["tangerine", "橘 / 柑"],
      ["berry", "莓果类"],
      ["strawberry", "草莓"],
      ["blueberry", "蓝莓"],
      ["blackberry", "黑莓"],
      ["raspberry", "覆盆子"],
      ["blackcurrant", "黑加仑"],
      ["grape", "葡萄"],
      ["stone_fruit", "核果类"],
      ["peach", "桃"],
      ["apricot", "杏"],
      ["plum", "李子"],
      ["cherry", "樱桃"],
      ["apple", "苹果"],
      ["pear", "梨"],
      ["tropical_fruit", "热带水果"],
      ["pineapple", "菠萝"],
      ["mango", "芒果"],
      ["passionfruit", "百香果"],
      ["papaya", "木瓜"],
      ["melon", "瓜果"],
      ["dried_fruit", "干果"],
      ["raisin", "葡萄干"],
      ["date_fruit", "椰枣 / 枣干"]
    ])
  },
  {
    id: "tea",
    label: "茶感",
    defaultCollapsed: true,
    descriptors: descriptors("tea", [
      ["black_tea", "红茶"],
      ["oolong_tea", "乌龙茶"],
      ["green_tea", "绿茶"],
      ["earl_grey", "伯爵茶"],
      ["tea_broth", "茶汤感"]
    ])
  },
  {
    id: "sweet",
    label: "甜香",
    defaultCollapsed: true,
    descriptors: descriptors("sweet", [
      ["honey", "蜂蜜"],
      ["caramel", "焦糖"],
      ["brown_sugar", "红糖 / 黑糖"],
      ["maple_syrup", "枫糖"],
      ["syrup", "糖浆"],
      ["toffee", "太妃糖"],
      ["vanilla", "香草"],
      ["candy", "糖果"],
      ["molasses", "糖蜜"]
    ])
  },
  {
    id: "roast_nut_cocoa",
    label: "坚果 / 可可 / 烘烤",
    defaultCollapsed: true,
    descriptors: descriptors("roast_nut_cocoa", [
      ["nutty", "坚果类"],
      ["almond", "杏仁"],
      ["hazelnut", "榛子"],
      ["peanut", "花生"],
      ["cocoa", "可可"],
      ["chocolate", "巧克力"],
      ["malt", "麦芽"],
      ["toast", "烤面包 / 烘烤"],
      ["grain", "谷物"],
      ["smoky", "烟熏"]
    ])
  },
  {
    id: "fermentation_spice",
    label: "发酵 / 香料 / 草本",
    defaultCollapsed: true,
    descriptors: descriptors("fermentation_spice", [
      ["winey", "酒香"],
      ["fermented", "发酵感"],
      ["rum_like", "朗姆酒感"],
      ["brandy_like", "白兰地感"],
      ["spice", "香料"],
      ["cinnamon", "肉桂"],
      ["clove", "丁香"],
      ["pepper", "胡椒"],
      ["ginger", "姜"],
      ["cardamom", "豆蔻"],
      ["herbal", "草本"],
      ["mint", "薄荷"],
      ["fresh_green", "鲜绿 / 青草"]
    ])
  },
  {
    id: "defect",
    label: "缺陷 / 异味",
    defaultCollapsed: true,
    descriptors: descriptors("defect", [
      ["phenolic", "酚类 / 药味"],
      ["musty", "霉味 / 陈味"],
      ["earthy", "土味"],
      ["woody", "木质"],
      ["papery", "纸板 / 纸味"],
      ["rubbery", "橡胶味"],
      ["burnt", "焦糊"],
      ["overfermented", "过度发酵"],
      ["astringent", "明显涩感"]
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
