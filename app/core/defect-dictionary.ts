import seed from "../../shared/dictionaries/defect.seed.json";

export const DEFECT_DICTIONARY_VERSION = seed.schemaVersion;

type DefectItem = {
  id: string;
  category: "off-flavor" | "tactile";
  severity: "overt" | "latent";
  names: { "zh-Hans": string; en: string; ja: string; ko: string };
  aliases: readonly string[];
};

const FOUNDATION_DEFECT_ITEMS = seed.items as readonly DefectItem[];

/**
 * SCA-104 limits sensory defect types to Potato, Moldy and Phenolic.
 * Moldy/Phenolic already come from the shared Foundation seed; Potato is kept
 * here as an AromaSense scoring-form adapter so P1 does not fork or mutate the
 * shared canonical dictionary contract.
 */
const P1_SCA_DEFECT_ITEMS: readonly DefectItem[] = [
  {
    id: "defect-potato",
    category: "off-flavor",
    severity: "overt",
    names: { "zh-Hans": "马铃薯缺陷", en: "Potato", ja: "ポテト臭", ko: "감자 결점" },
    aliases: ["马铃薯味", "土豆味", "potato", "potato defect"]
  }
];

export const DEFECT_ITEMS = [...FOUNDATION_DEFECT_ITEMS, ...P1_SCA_DEFECT_ITEMS] as readonly DefectItem[];

/**
 * Legacy AromaSense penalties remain defined only by the shared defect seed.
 * The P1-only SCA form adapter must not silently alter the legacy score model.
 */
export function defectPenalty(ids: readonly string[]): number {
  const selected = new Set(ids);
  return Math.min(15, FOUNDATION_DEFECT_ITEMS.filter((item) => selected.has(item.id)).reduce((sum, item) => sum + (item.severity === "overt" ? 5 : 2), 0));
}
