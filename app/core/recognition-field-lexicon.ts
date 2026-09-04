export type RecognitionFieldKey =
  | "country" | "origin" | "region" | "farm" | "producer" | "station" | "cooperative"
  | "variety" | "species" | "process" | "roastDate" | "productionDate" | "packDate"
  | "bestBefore" | "expiryDate" | "harvest" | "altitude" | "flavor" | "aroma" | "roast"
  | "roastColor" | "weight" | "lot" | "grade" | "roaster";

export const RECOGNITION_FIELD_ALIASES: Readonly<Record<RecognitionFieldKey, readonly string[]>> = {
  country: ["国家", "产国", "原产国", "生产国", "咖啡产国", "國家", "產國", "原產國", "country", "country of origin", "origin country", "生産国", "原産国", "原産地", "생산국", "원산국", "원산지"],
  origin: ["产地", "原产地", "来源", "产地信息", "咖啡产地", "產地", "原產地", "來源", "origin", "coffee origin", "産地", "生産地", "原産地", "산지", "생산지", "원산지"],
  region: ["产区", "地区", "区域", "种植区", "生产区", "微产区", "子产区", "次产区", "產區", "地區", "region", "growing region", "producing region", "area", "zone", "district", "province", "terroir", "地域", "生産地域", "生産地", "地区", "지역", "생산 지역", "산지"],
  farm: ["庄园", "农场", "农园", "农庄", "咖啡庄园", "莊園", "農場", "farm", "estate", "finca", "fazenda", "hacienda", "農園", "農場", "エステート", "농장", "농원", "에스테이트"],
  producer: ["生产者", "农户", "种植者", "庄园主", "生产单位", "生產者", "農戶", "producer", "farmer", "grower", "produced by", "生産者", "農家", "栽培者", "생산자", "농가", "재배자"],
  station: ["水洗站", "处理站", "加工站", "处理厂", "咖啡处理站", "處理站", "processing station", "washing station", "wet mill", "dry mill", "factory", "ウォッシングステーション", "精製所", "処理場", "ミル", "워싱 스테이션", "가공소", "정제소", "밀"],
  cooperative: ["合作社", "小农合作社", "農民合作社", "cooperative", "co-op", "coop", "協同組合", "生産者組合", "農協", "협동조합", "생산자 조합", "농협"],
  variety: ["品种", "豆种", "树种", "咖啡品种", "栽培种", "品種", "豆種", "variety", "varietal", "cultivar", "botanical variety", "var.", "var", "cv.", "cv", "栽培品種", "品種名", "コーヒー品種", "품종", "재배 품종", "커피 품종"],
  species: ["种属", "物种", "咖啡种", "種屬", "物種", "species", "種", "コーヒー種", "커피 종", "종"],
  process: ["处理法", "处理方式", "精制法", "后制处理", "后制法", "加工法", "加工方式", "发酵方式", "处理工艺", "處理法", "process", "processing", "processing method", "post-harvest process", "proc.", "proc", "method", "fermentation", "精製方法", "精製法", "加工方法", "処理方法", "発酵方法", "가공 방식", "가공법", "프로세싱", "정제 방식", "발효 방식"],
  roastDate: ["烘焙日期", "烘焙日", "烘豆日期", "烘焙时间", "出炉日期", "焙炒日期", "烘烤日期", "烘焙時間", "出爐日期", "roast date", "roasted on", "roasting date", "date roasted", "roast on", "rst date", "rst dt", "rd", "焙煎日", "焙煎日付", "焙煎年月日", "ロースト日", "로스팅 날짜", "로스팅일", "배전일"],
  productionDate: ["生产日期", "制造日期", "生產日期", "製造日期", "production date", "prod date", "manufactured on", "mfg date", "mfd", "製造日", "製造年月日", "生産日", "제조일", "생산일", "제조 날짜"],
  packDate: ["包装日期", "分装日期", "包裝日期", "分裝日期", "pack date", "packed on", "packing date", "pkd", "包装日", "包装年月日", "パック日", "포장일", "포장 날짜"],
  bestBefore: ["最佳赏味期", "最佳飲用期", "建议饮用日期", "賞味期限", "best before", "best by", "bbe", "おすすめ飲用期限", "상미기한", "권장 음용기한", "베스트 비포"],
  expiryDate: ["到期日", "有效期至", "保质期至", "有效期限", "expiry", "expiration date", "use by", "exp", "消費期限", "有効期限", "期限", "소비기한", "유효기한", "만료일"],
  harvest: ["产季", "收获季", "采收季", "采收年份", "收获年份", "年度", "生豆产季", "產季", "收穫季", "採收季", "crop", "crop year", "harvest", "harvest year", "season", "crop season", "cy", "クロップ", "クロップ年", "収穫年", "収穫年度", "収穫期", "収穫シーズン", "크롭", "크롭 연도", "수확 연도", "수확기", "수확 시즌"],
  altitude: ["海拔", "种植海拔", "海拔高度", "种植高度", "種植海拔", "高度", "altitude", "elevation", "elev.", "elev", "alt.", "alt", "masl", "m.a.s.l.", "meters above sea level", "metres above sea level", "ft asl", "feet above sea level", "標高", "栽培標高", "고도", "재배 고도"],
  flavor: ["风味", "风味描述", "风味笔记", "杯测风味", "杯测描述", "风味标签", "品鉴笔记", "風味", "風味描述", "杯測風味", "flavor notes", "flavour notes", "tasting notes", "cup notes", "cupping notes", "sensory notes", "風味特性", "テイスティングノート", "カッピングノート", "味わい", "풍미", "테이스팅 노트", "커핑 노트", "향미"],
  aroma: ["香气", "干香", "湿香", "香氣", "乾香", "濕香", "aroma", "fragrance", "香り", "アロマ", "フレグランス", "향", "향기", "아로마"],
  roast: ["烘焙度", "焙度", "烘焙程度", "roast level", "roast profile", "roast", "焙煎度", "ローストレベル", "焼き加減", "배전도", "로스팅 정도", "로스트 레벨"],
  roastColor: ["烘焙色值", "色值", "艾格壮", "艾格壯", "agtron", "gourmet agtron", "commercial agtron", "roast color", "colour value", "color value", "アグトロン", "焙煎色", "배전 색도", "아그트론"],
  weight: ["净含量", "净重", "重量", "规格", "克重", "包裝重量", "淨含量", "淨重", "net weight", "net wt", "net wt.", "n.w.", "nw", "内容量", "正味重量", "ネットウェイト", "순중량", "내용량"],
  lot: ["批次", "批号", "批次号", "批次编号", "地块批次", "批號", "批次編號", "lot", "lot no", "lot number", "batch", "batch no", "ロット", "ロット番号", "マイクロロット", "로트", "로트 번호", "마이크로 로트"],
  grade: ["等级", "分级", "等級", "分級", "grade", "screen size", "screen", "cup score", "score", "スクリーン", "カップスコア", "등급", "스크린", "커핑 점수"],
  roaster: ["烘焙商", "烘焙厂", "烘焙品牌", "烘焙者", "品牌", "烘焙廠", "roaster", "roasted by", "roast house", "roastery", "ロースター", "焙煎所", "焙煎者", "로스터", "로스터리", "배전소"]
};

const OCR_ALIAS_NORMALIZATION: Readonly<Record<string, string>> = {
  "烘培日期": "烘焙日期",
  "烘焙曰期": "烘焙日期",
  "烘焙日朗": "烘焙日期",
  "处埋法": "处理法",
  "處埋法": "處理法",
  "產區": "产区",
  "產地": "产地",
  "焙煎曰": "焙煎日",
  "口一スト日": "ロースト日",
  "로스팅 날자": "로스팅 날짜",
  "생산지억": "생산 지역"
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
  .filter((item) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(item.normalized) || anchorKey(item.normalized).length >= 3)
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
