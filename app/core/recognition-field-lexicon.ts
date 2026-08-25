export type RecognitionFieldKey =
  | "country" | "origin" | "region" | "farm" | "producer" | "station" | "cooperative"
  | "variety" | "species" | "process" | "roastDate" | "productionDate" | "packDate"
  | "bestBefore" | "expiryDate" | "harvest" | "altitude" | "flavor" | "aroma" | "roast"
  | "roastColor" | "weight" | "lot" | "grade" | "roaster";

export const RECOGNITION_FIELD_ALIASES: Readonly<Record<RecognitionFieldKey, readonly string[]>> = {
  country: ["国家", "产国", "原产国", "生产国", "咖啡产国", "國家", "產國", "原產國", "country", "country of origin", "origin country"],
  origin: ["产地", "原产地", "来源", "产地信息", "咖啡产地", "產地", "原產地", "來源", "origin", "coffee origin"],
  region: ["产区", "地区", "区域", "种植区", "生产区", "微产区", "子产区", "次产区", "產區", "地區", "region", "growing region", "producing region", "area", "zone", "district", "province", "terroir"],
  farm: ["庄园", "农场", "农园", "农庄", "咖啡庄园", "莊園", "農場", "farm", "estate", "finca", "fazenda", "hacienda"],
  producer: ["生产者", "农户", "种植者", "庄园主", "生产单位", "生產者", "農戶", "producer", "farmer", "grower", "produced by"],
  station: ["水洗站", "处理站", "加工站", "处理厂", "咖啡处理站", "處理站", "processing station", "washing station", "wet mill", "dry mill", "factory"],
  cooperative: ["合作社", "小农合作社", "農民合作社", "cooperative", "co-op", "coop"],
  variety: ["品种", "豆种", "树种", "咖啡品种", "栽培种", "品種", "豆種", "variety", "varietal", "cultivar", "botanical variety", "var.", "var", "cv.", "cv"],
  species: ["种属", "物种", "咖啡种", "種屬", "物種", "species"],
  process: ["处理法", "处理方式", "精制法", "后制处理", "后制法", "加工法", "加工方式", "发酵方式", "处理工艺", "處理法", "process", "processing", "processing method", "post-harvest process", "proc.", "proc", "method", "fermentation"],
  roastDate: ["烘焙日期", "烘焙日", "烘豆日期", "烘焙时间", "出炉日期", "焙炒日期", "烘烤日期", "烘焙時間", "出爐日期", "roast date", "roasted on", "roasting date", "date roasted", "roast on", "rst date", "rst dt", "rd"],
  productionDate: ["生产日期", "制造日期", "生產日期", "製造日期", "production date", "prod date", "manufactured on", "mfg date", "mfd"],
  packDate: ["包装日期", "分装日期", "包裝日期", "分裝日期", "pack date", "packed on", "packing date", "pkd"],
  bestBefore: ["最佳赏味期", "最佳飲用期", "建议饮用日期", "賞味期限", "best before", "best by", "bbe"],
  expiryDate: ["到期日", "有效期至", "保质期至", "有效期限", "expiry", "expiration date", "use by", "exp"],
  harvest: ["产季", "收获季", "采收季", "采收年份", "收获年份", "年度", "生豆产季", "產季", "收穫季", "採收季", "crop", "crop year", "harvest", "harvest year", "season", "crop season", "cy"],
  altitude: ["海拔", "种植海拔", "海拔高度", "种植高度", "種植海拔", "高度", "altitude", "elevation", "elev.", "elev", "alt.", "alt", "masl", "m.a.s.l.", "meters above sea level", "metres above sea level", "ft asl", "feet above sea level"],
  flavor: ["风味", "风味描述", "风味笔记", "杯测风味", "杯测描述", "风味标签", "品鉴笔记", "風味", "風味描述", "杯測風味", "flavor notes", "flavour notes", "tasting notes", "cup notes", "cupping notes", "sensory notes"],
  aroma: ["香气", "干香", "湿香", "香氣", "乾香", "濕香", "aroma", "fragrance"],
  roast: ["烘焙度", "焙度", "烘焙程度", "roast level", "roast profile", "roast"],
  roastColor: ["烘焙色值", "色值", "艾格壮", "艾格壯", "agtron", "gourmet agtron", "commercial agtron", "roast color", "colour value", "color value"],
  weight: ["净含量", "净重", "重量", "规格", "克重", "包裝重量", "淨含量", "淨重", "net weight", "net wt", "net wt.", "n.w.", "nw"],
  lot: ["批次", "批号", "批次号", "批次编号", "地块批次", "批號", "批次編號", "lot", "lot no", "lot number", "batch", "batch no"],
  grade: ["等级", "分级", "等級", "分級", "grade", "screen size", "screen", "cup score", "score"],
  roaster: ["烘焙商", "烘焙厂", "烘焙品牌", "烘焙者", "品牌", "烘焙廠", "roaster", "roasted by", "roast house", "roastery"]
};

const OCR_ALIAS_NORMALIZATION: Readonly<Record<string, string>> = {
  "烘培日期": "烘焙日期",
  "烘焙曰期": "烘焙日期",
  "烘焙日朗": "烘焙日期",
  "处埋法": "处理法",
  "處埋法": "處理法",
  "產區": "产区",
  "產地": "产地"
};

export function cleanRecognitionText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function semanticText(value: unknown): string {
  const cleaned = cleanRecognitionText(value).replace(/[﹕︰]/g, ":").replace(/[｜丨]/g, "|");
  return OCR_ALIAS_NORMALIZATION[cleaned] ?? cleaned;
}

function anchorKey(value: unknown): string {
  return semanticText(value)
    .toLocaleLowerCase("zh-CN")
    .replace(/^[\s【\[(]+|[\s】\])]+$/g, "")
    .replace(/[\s:：=|｜;；.。]+$/g, "")
    .trim();
}

const ALIAS_INDEX = (() => {
  const map = new Map<string, { field: RecognitionFieldKey; alias: string }>();
  for (const [field, aliases] of Object.entries(RECOGNITION_FIELD_ALIASES) as [RecognitionFieldKey, readonly string[]][]) {
    for (const alias of aliases) {
      const key = anchorKey(alias);
      if (key && !map.has(key)) map.set(key, { field, alias });
    }
  }
  return map;
})();

export interface FieldAnchor {
  field: RecognitionFieldKey;
  alias: string;
  confidence: number;
}

export function detectFieldAnchor(value: unknown): FieldAnchor | undefined {
  const key = anchorKey(value);
  if (!key) return undefined;
  const exact = ALIAS_INDEX.get(key);
  if (exact) return { ...exact, confidence: 1 };
  for (const [aliasKey, match] of ALIAS_INDEX) {
    if (key.length < 3 || aliasKey.length < 3) continue;
    if (!(key.startsWith(aliasKey) || aliasKey.startsWith(key))) continue;
    if (Math.abs(key.length - aliasKey.length) <= 1) return { ...match, confidence: 0.86 };
  }
  const leading = splitLeadingFieldPair(value);
  return leading ? { field: leading.field, alias: leading.alias, confidence: leading.confidence } : undefined;
}

export interface InlineFieldPair extends FieldAnchor {
  label: string;
  value: string;
  labelSide: "left" | "right";
}

export function splitInlineFieldPair(value: unknown): InlineFieldPair | undefined {
  const text = semanticText(value);
  if (!text) return undefined;
  for (const separator of [/:|：|=|\||｜/, /\s+[–—-]\s+/]) {
    const match = separator.exec(text);
    if (!match || match.index <= 0) continue;
    const left = cleanRecognitionText(text.slice(0, match.index));
    const right = cleanRecognitionText(text.slice(match.index + match[0].length));
    if (!left || !right) continue;
    const leftAnchor = detectFieldAnchor(left);
    const rightAnchor = detectFieldAnchor(right);
    if (leftAnchor && !rightAnchor) return { ...leftAnchor, label: left, value: right, labelSide: "left" };
    if (rightAnchor && !leftAnchor) return { ...rightAnchor, label: right, value: left, labelSide: "right" };
  }
  return undefined;
}

export interface LeadingFieldPair extends FieldAnchor {
  label: string;
  value: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LEADING_FIELD_ALIASES = (Object.entries(RECOGNITION_FIELD_ALIASES) as [RecognitionFieldKey, readonly string[]][])
  .flatMap(([field, aliases]) => aliases.map((alias) => ({ field, alias, normalized: semanticText(alias) })))
  .filter((item) => /[\u3400-\u9fff]/u.test(item.normalized) || anchorKey(item.normalized).length >= 3)
  .sort((a, b) => b.normalized.length - a.normalized.length);

export function splitLeadingFieldPair(value: unknown): LeadingFieldPair | undefined {
  const text = semanticText(value);
  if (!text || /[:：=|｜]/.test(text)) return undefined;
  for (const item of LEADING_FIELD_ALIASES) {
    const match = text.match(new RegExp(`^(${escapeRegex(item.normalized)})\\s+(.+)$`, "i"));
    if (!match) continue;
    const remainder = cleanRecognitionText(match[2]);
    if (!remainder) continue;
    const remainderKey = anchorKey(remainder);
    if (ALIAS_INDEX.has(remainderKey)) continue;
    return {
      field: item.field,
      alias: item.alias,
      confidence: 0.97,
      label: cleanRecognitionText(match[1]),
      value: remainder
    };
  }
  return undefined;
}

export function fieldAliasCount(value: unknown): number {
  const text = cleanRecognitionText(value);
  if (!text) return 0;
  let count = 0;
  for (const aliases of Object.values(RECOGNITION_FIELD_ALIASES)) {
    if (aliases.some((alias) => text.toLocaleLowerCase("zh-CN").includes(alias.toLocaleLowerCase("zh-CN")))) count += 1;
  }
  return count;
}
