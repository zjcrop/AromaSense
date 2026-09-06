import type { SensoryObservation, StageId } from "../../shared/protocol/aromasense-v1";

export type FlavorFamilyId =
  | "white_floral" | "floral" | "citrus" | "berry" | "stone_fruit" | "tropical"
  | "tea" | "sweet" | "nut_cocoa" | "fermented" | "spice_herbal" | "neutral";

export interface SensoryRadarAxis {
  key: string;
  label: string;
  value: number;
  max: number;
  recorded: boolean;
}

export interface TemperatureFlavorPoint {
  stageId: "high_temp" | "mid_temp" | "low_temp";
  label: string;
  acidity?: number;
  sweetness?: number;
  bitterness?: number;
  tags: string[];
  flavorFamily: FlavorFamilyId;
  flavorFamilyLabel: string;
}

export interface SensoryProfileConclusion {
  radar: SensoryRadarAxis[];
  temperature: TemperatureFlavorPoint[];
}

const TEMP_STAGES = [
  ["high_temp", "高温"], ["mid_temp", "中温"], ["low_temp", "低温"]
] as const;

const FAMILY_LABELS: Record<FlavorFamilyId, string> = {
  white_floral: "白花", floral: "花香", citrus: "柑橘", berry: "莓果", stone_fruit: "核果",
  tropical: "热带水果", tea: "茶感", sweet: "甜香", nut_cocoa: "坚果 / 可可",
  fermented: "发酵果香", spice_herbal: "香料 / 草本", neutral: "未标注"
};

const FAMILY_IDS: Readonly<Record<Exclude<FlavorFamilyId, "neutral">, ReadonlySet<string>>> = {
  white_floral: new Set(["white_floral", "jasmine", "orange_blossom", "gardenia", "chamomile", "tea_flower"]),
  floral: new Set(["rose", "violet", "osmanthus", "lavender"]),
  citrus: new Set(["citrus", "bergamot", "lemon", "lime", "orange", "grapefruit", "tangerine"]),
  berry: new Set(["berry", "strawberry", "blueberry", "blackberry", "raspberry", "blackcurrant", "grape"]),
  stone_fruit: new Set(["stone_fruit", "peach", "apricot", "plum", "cherry", "apple", "pear"]),
  tropical: new Set(["tropical_fruit", "pineapple", "mango", "passionfruit", "papaya", "melon"]),
  tea: new Set(["black_tea", "oolong_tea", "green_tea", "earl_grey", "tea_broth"]),
  sweet: new Set(["honey", "caramel", "brown_sugar", "maple_syrup", "syrup", "toffee", "vanilla", "candy", "molasses"]),
  nut_cocoa: new Set(["nutty", "almond", "hazelnut", "peanut", "cocoa", "chocolate", "malt", "toast", "grain", "smoky"]),
  fermented: new Set(["winey", "fermented", "rum_like", "brandy_like", "dried_fruit", "raisin", "date_fruit"]),
  spice_herbal: new Set(["spice", "cinnamon", "clove", "pepper", "ginger", "cardamom", "herbal", "mint", "fresh_green"])
};

function latestObservation(observations: readonly SensoryObservation[], stageId: StageId, fieldKey: string): SensoryObservation | undefined {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const item = observations[index];
    if (item?.stageId === stageId && item.fieldKey === fieldKey) return item;
  }
  return undefined;
}

function latestAnyStage(observations: readonly SensoryObservation[], fieldKey: string): SensoryObservation | undefined {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const item = observations[index];
    if (item?.fieldKey === fieldKey) return item;
  }
  return undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stageNumber(observations: readonly SensoryObservation[], stageId: StageId, fieldKey: string): number | undefined {
  return finite(latestObservation(observations, stageId, fieldKey)?.value);
}

function meanState(values: readonly (number | undefined)[]): { value: number; recorded: boolean } {
  const present = values.filter((value): value is number => value !== undefined);
  return {
    value: present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : 0,
    recorded: present.length > 0
  };
}

function tagsForStage(observations: readonly SensoryObservation[], stageId: StageId): string[] {
  const raw = latestObservation(observations, stageId, "flavor_tags")?.value;
  return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
}

export function flavorFamilyForTags(tags: readonly string[]): FlavorFamilyId {
  const counts = new Map<FlavorFamilyId, number>();
  for (const tag of tags) {
    let matched: FlavorFamilyId | undefined;
    for (const [family, ids] of Object.entries(FAMILY_IDS) as [Exclude<FlavorFamilyId, "neutral">, ReadonlySet<string>][]) {
      if (ids.has(tag)) { matched = family; break; }
    }
    if (matched) counts.set(matched, (counts.get(matched) ?? 0) + 1);
  }
  if (!counts.size) return "neutral";
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || tags.findIndex((tag) => FAMILY_IDS[a[0] as Exclude<FlavorFamilyId, "neutral">]?.has(tag)) - tags.findIndex((tag) => FAMILY_IDS[b[0] as Exclude<FlavorFamilyId, "neutral">]?.has(tag)))[0]![0];
}

export function flavorFamilyLabel(family: FlavorFamilyId): string {
  return FAMILY_LABELS[family];
}

export function deriveSensoryProfileConclusion(observations: readonly SensoryObservation[]): SensoryProfileConclusion {
  const acidity = TEMP_STAGES.map(([stage]) => stageNumber(observations, stage, "acidity_intensity"));
  const sweetness = TEMP_STAGES.map(([stage]) => stageNumber(observations, stage, "sweetness_intensity"));
  const bitterness = TEMP_STAGES.map(([stage]) => stageNumber(observations, stage, "bitterness_intensity"));
  const mouthfeel = TEMP_STAGES.map(([stage]) => stageNumber(observations, stage, "mouthfeel_intensity"));
  const finish = [stageNumber(observations, "mid_temp", "finish_intensity"), stageNumber(observations, "low_temp", "finish_intensity")];
  const aroma = meanState([
    stageNumber(observations, "preparation", "dry_fragrance_intensity"),
    stageNumber(observations, "aroma", "dry_fragrance_intensity"),
    stageNumber(observations, "aroma", "wet_aroma_intensity")
  ]);
  const acidityState = meanState(acidity);
  const sweetnessState = meanState(sweetness);
  const bitternessState = meanState(bitterness);
  const mouthfeelState = meanState(mouthfeel);
  const finishState = meanState(finish);
  const cleanValue = finite(latestAnyStage(observations, "quality_clean")?.value);
  const clean = { value: cleanValue ?? 0, recorded: cleanValue !== undefined };

  return {
    radar: [
      { key: "aroma", label: "香气", ...aroma, max: 15 },
      { key: "acidity", label: "酸质", ...acidityState, max: 15 },
      { key: "sweetness", label: "甜感", ...sweetnessState, max: 15 },
      { key: "bitterness", label: "苦味", ...bitternessState, max: 15 },
      { key: "mouthfeel", label: "口感", ...mouthfeelState, max: 15 },
      { key: "finish", label: "余韵", ...finishState, max: 15 },
      { key: "cleanliness", label: "洁净度", ...clean, max: 10 }
    ],
    temperature: TEMP_STAGES.map(([stageId, label], index) => {
      const tags = tagsForStage(observations, stageId);
      const flavorFamily = flavorFamilyForTags(tags);
      return {
        stageId,
        label,
        acidity: acidity[index],
        sweetness: sweetness[index],
        bitterness: bitterness[index],
        tags,
        flavorFamily,
        flavorFamilyLabel: flavorFamilyLabel(flavorFamily)
      };
    })
  };
}
