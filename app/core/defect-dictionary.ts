import seed from "../../shared/dictionaries/defect.seed.json";

export const DEFECT_DICTIONARY_VERSION = seed.schemaVersion;
export const DEFECT_ITEMS = seed.items as readonly {
  id: string;
  category: "off-flavor" | "tactile";
  severity: "overt" | "latent";
  names: { "zh-Hans": string; en: string; ja: string; ko: string };
  aliases: readonly string[];
}[];

export function defectPenalty(ids: readonly string[]): number {
  const selected = new Set(ids);
  return Math.min(15, DEFECT_ITEMS.filter((item) => selected.has(item.id)).reduce((sum, item) => sum + (item.severity === "overt" ? 5 : 2), 0));
}
