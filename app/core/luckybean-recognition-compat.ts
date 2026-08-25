export const LUCKYBEAN_RECOGNITION_COMPAT_VERSION = "1.24B-compat.1";

const REMOTE_CODEBOOK_URL = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json";
const REMOTE_LABEL_LEXICON_URL = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_label_lexicon_v1.json";
const CACHE_KEY = "aromasense.luckybean-recognition-book.v1";

export type CoffeeCodebookRow = readonly unknown[];
export interface CoffeeRecognitionBook {
  countries?: readonly CoffeeCodebookRow[];
  regions?: readonly CoffeeCodebookRow[];
  entities?: readonly CoffeeCodebookRow[];
  varieties?: readonly CoffeeCodebookRow[];
  processes?: readonly CoffeeCodebookRow[];
  flavors?: readonly CoffeeCodebookRow[];
  labelLexicon?: {
    version?: string;
    fields?: Record<string, { aliases?: readonly string[] } | readonly string[]>;
  };
  version?: string | number;
}

export interface LuckyBeanSemanticResult {
  fields: Record<string, string>;
  confidence: Record<string, number>;
  evidence: Record<string, string>;
  source: "remote-codebook" | "cached-codebook" | "core-fallback";
  codebookVersion?: string;
}

const CORE_FALLBACK_BOOK: CoffeeRecognitionBook = {
  version: "core-fallback-1",
  countries: [
    ["CO-EA", "埃塞俄比亚", "Ethiopia", "埃塞"], ["CO-CO", "哥伦比亚", "Colombia"],
    ["CO-KE", "肯尼亚", "Kenya"], ["CO-PA", "巴拿马", "Panama"], ["CO-BR", "巴西", "Brazil"],
    ["CO-CR", "哥斯达黎加", "Costa Rica", "哥斯达"], ["CO-GT", "危地马拉", "Guatemala"],
    ["CO-RW", "卢旺达", "Rwanda"], ["CO-BU", "布隆迪", "Burundi"], ["CO-ID", "印度尼西亚", "Indonesia", "印尼"],
    ["CO-YE", "也门", "Yemen"], ["CO-CN", "中国", "China"]
  ],
  regions: [], entities: [],
  varieties: [
    ["VR-GES", "瑰夏", "Geisha / Gesha", "Gesha"], ["VR-TYP", "铁皮卡", "Typica"],
    ["VR-BOU", "波旁", "Bourbon"], ["VR-CAT", "卡杜拉", "Caturra"], ["VR-SL28", "SL28", "SL28"],
    ["VR-SL34", "SL34", "SL34"], ["VR-HEI", "原生种", "Heirloom", "Ethiopian Heirloom"]
  ],
  processes: [
    ["PR-W", "水洗", "Washed", "Fully Washed"], ["PR-N", "日晒", "Natural", "Dry Process"],
    ["PR-H", "蜜处理", "Honey"], ["PR-A", "厌氧", "Anaerobic"], ["PR-CM", "二氧化碳浸渍", "Carbonic Maceration"]
  ],
  flavors: []
};

export const DEFAULT_LABEL_LEXICON: Readonly<Record<string, readonly string[]>> = Object.freeze({
  country: ["产地国","原产国","原产地","国家","产地","origin","country of origin","origin country","country"],
  region: ["产区","地区","区域","省","州","县","region","growing region","origin region","zone","district","province","terroir"],
  entity: ["庄园","农场","生产者","农户","合作社","处理站","水洗站","处理厂","磨坊","工厂","producer","farmer","grower","farm","estate","finca","hacienda","cooperative","co-op","coop","washing station","ws","wet mill","dry mill","mill","factory"],
  variety: ["豆种","品种","咖啡品种","栽培种","种属","variety","varietal","cultivar","var.","var","cv.","cv","species","botanical variety"],
  process: ["处理法","处理方式","处理","加工法","加工方式","发酵方式","处理工艺","process","processing","processing method","post-harvest process","proc.","proc","method","fermentation"],
  roast: ["烘焙度","烘焙程度","焙度","roast level","roast profile","roast"],
  roastDate: ["烘焙日期","烘焙时间","烘焙日","烘豆日期","焙炒日期","烘烤日期","出炉日期","roast date","roasted on","roasting date","date roasted","roast on","rst date","rst dt","rd"],
  productionDate: ["生产日期","制造日期","production date","prod date","manufactured on","mfg date","mfd"],
  packDate: ["包装日期","分装日期","pack date","packed on","packing date","pkd"],
  bestBefore: ["最佳赏味期","最佳饮用期","建议饮用日期","best before","best by","bbe"],
  expiryDate: ["到期日","有效期至","保质期至","use by","expiry","expiration date","exp"],
  roaster: ["烘焙商","烘焙厂","烘焙品牌","烘焙者","品牌","roaster","roasted by","roast house","roastery"],
  harvest: ["产季","收获季","收获年份","采收季","采收年份","生豆产季","crop","crop year","harvest","harvest year","season","crop season","cy"],
  flavor: ["风味","风味描述","风味笔记","杯测风味","风味标签","品鉴笔记","香气","flavor notes","flavour notes","tasting notes","cup notes","cupping notes","sensory notes","aroma"],
  altitude: ["海拔","种植海拔","高度","elevation","altitude","elev.","elev","alt.","alt","masl","m.a.s.l.","meters above sea level","metres above sea level","ft asl","feet above sea level"],
  roastColor: ["烘焙色值","色值","艾格壮","艾格壯","agtron","gourmet agtron","commercial agtron","roast color","colour value","color value","whole bean color","ground color"],
  weight: ["净重","净含量","重量","克重","包装重量","net weight","net wt","net wt.","n.w.","nw"],
  lot: ["批次","批号","批次号","批次编号","地块批次","lot","lot no","lot number","batch","batch no"],
  grade: ["等级","分级","grade","screen size","screen","cup score","score"]
});

const OCR_NORMALIZATION: Readonly<Record<string, string>> = Object.freeze({
  "烘培日期": "烘焙日期", "烘焙曰期": "烘焙日期", "烘焙日朗": "烘焙日期",
  "处埋法": "处理法", "處埋法": "處理法", "產區": "产区", "產地": "产地"
});

function clean(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeLabelValue(value: unknown): string {
  const base = clean(value)
    .replace(/^[\s【\[]*(?:正面主体|背面参数|侧面补充|日期标签)[】\]]?\s*/i, "")
    .replace(/^[-—–•·*]+\s*/, "")
    .replace(/[﹕︰]/g, ":")
    .replace(/[｜丨]/g, "|")
    .trim();
  return OCR_NORMALIZATION[base] ?? base;
}

function normalizeCodeSource(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toUpperCase()
    .replace(/[‐‑‒–—―−﹣－]/g, "-").replace(/\s*-\s*/g, "-").replace(/[\t\r]+/g, " ");
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function lexiconTerms(book: CoffeeRecognitionBook | undefined, field: string): string[] {
  const defaults = DEFAULT_LABEL_LEXICON[field] ?? [];
  const external = book?.labelLexicon?.fields?.[field];
  const aliases = Array.isArray(external) ? external : external?.aliases ?? [];
  return [...new Set([...defaults, ...aliases].map(clean).filter(Boolean))];
}

function labeledFieldValues(source: string, book?: CoffeeRecognitionBook): Record<string, string> {
  const order = ["roastDate","productionDate","packDate","bestBefore","expiryDate","roastColor","country","region","entity","variety","process","roast","roaster","harvest","flavor","altitude","weight","lot","grade"];
  const definitions = order.map((field) => [field, new RegExp(`^(?:${lexiconTerms(book, field).sort((a,b)=>b.length-a.length).map(escapeRegex).join("|")})\\s*(?:[:：=]|-\\s+)?\\s*(.+)$`, "i")] as const);
  const result: Record<string, string> = {};
  const lines = source.replace(/\r/g, "").split(/\n+/).map(normalizeLabelValue).filter(Boolean);
  for (const line of lines) {
    for (const [field, regex] of definitions) {
      const match = line.match(regex);
      if (match && !result[field]) { result[field] = normalizeLabelValue(match[1]); break; }
    }
  }
  return result;
}

interface TableMatch { code: string; alias: string; row: CoffeeCodebookRow; direct: boolean }
function directCodeMatch(source: string, rows: readonly CoffeeCodebookRow[] = []): TableMatch | undefined {
  for (const row of rows) {
    const code = normalizeCodeSource(row[0]); if (!code) continue;
    const index = source.indexOf(code); if (index < 0) continue;
    const before = source[index - 1] ?? ""; const after = source[index + code.length] ?? "";
    if (/[A-Z0-9]/.test(before) || /[A-Z0-9]/.test(after)) continue;
    return { code: String(row[0]), alias: String(row[0]), row, direct: true };
  }
  return undefined;
}

function bestTableMatch(value: string, rows: readonly CoffeeCodebookRow[] = []): TableMatch | undefined {
  const source = normalizeLabelValue(value); if (!source) return undefined;
  const directMatches = rows.map((row) => directCodeMatch(normalizeCodeSource(source), [row])).filter((item): item is TableMatch => Boolean(item));
  if (directMatches.length === 1) return directMatches[0];
  if (directMatches.length > 1) return undefined;
  const lower = source.toLocaleLowerCase("zh-CN");
  const fragments = lower.split(/[\\/、,，;；|]+/).map((item) => item.trim()).filter(Boolean);
  const exact: TableMatch[] = [];
  for (const row of rows) {
    const aliases = row.slice(1).filter((item): item is string => typeof item === "string")
      .flatMap((item) => item.split(/[\\/、,，;；|]/)).map((item) => item.toLocaleLowerCase("zh-CN").trim()).filter(Boolean);
    const alias = aliases.find((item) => fragments.includes(item));
    if (alias) exact.push({ code: String(row[0]), alias, row, direct: false });
  }
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  let best: TableMatch | undefined;
  for (const row of rows) {
    const aliases = row.slice(1).filter((item): item is string => typeof item === "string" && !["active","candidate"].includes(item))
      .flatMap((item) => item.split(/[\\/、,，;；|]/)).map((item) => item.trim()).filter(Boolean);
    for (const alias of aliases) {
      const needle = alias.toLocaleLowerCase("zh-CN");
      if ((lower === needle || lower.includes(needle) || needle.includes(lower)) && (!best || needle.length > best.alias.length)) {
        best = { code: String(row[0]), alias, row, direct: false };
      }
    }
  }
  return best;
}

function rowDisplay(table: string, row: CoffeeCodebookRow | undefined): string {
  if (!row) return "";
  const index = table === "regions" ? 2 : table === "entities" ? 3 : table === "flavors" && row.length >= 9 ? 4 : 1;
  return clean(row[index] ?? row[1] ?? row[0]);
}

function validIsoDate(year: unknown, month: unknown, day: unknown): string {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` : "";
}

const MONTH: Readonly<Record<string, number>> = Object.freeze({ jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 });
function fullYear(value: string): number { const number = Number(value); return number < 100 ? 2000 + number : number; }

export function parseCoffeeDateValue(value: unknown): { value: string; candidates: string[]; confidence: number } {
  const text = normalizeLabelValue(value).replace(/[,，]/g," ").trim(); let m: RegExpMatchArray | null;
  m = text.match(/(?:^|\D)(20\d{2})年(\d{1,2})月(\d{1,2})日?(?:\D|$)/); if (m) { const v=validIsoDate(m[1],m[2],m[3]); if(v)return {value:v,candidates:[v],confidence:.995}; }
  m = text.match(/(?:^|\D)(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/); if (m) { const v=validIsoDate(m[1],m[2],m[3]); if(v)return {value:v,candidates:[v],confidence:.995}; }
  m = text.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/); if (m) { const v=validIsoDate(m[1],m[2],m[3]); if(v)return {value:v,candidates:[v],confidence:.99}; }
  m = text.match(/(?:^|\D)(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2}|\d{2})(?:\D|$)/i); if (m && MONTH[m[2].toLowerCase()]) { const v=validIsoDate(fullYear(m[3]),MONTH[m[2].toLowerCase()],m[1]); if(v)return {value:v,candidates:[v],confidence:.98}; }
  m = text.match(/(?:^|\D)([A-Za-z]{3,9})\s+(\d{1,2})\s+(20\d{2}|\d{2})(?:\D|$)/i); if (m && MONTH[m[1].toLowerCase()]) { const v=validIsoDate(fullYear(m[3]),MONTH[m[1].toLowerCase()],m[2]); if(v)return {value:v,candidates:[v],confidence:.98}; }
  m = text.match(/(?:^|\D)(\d{2})(\d{2})(\d{2})(?:\D|$)/); if (m) { const v=validIsoDate(fullYear(m[1]),m[2],m[3]); if(v)return {value:v,candidates:[v],confidence:.96}; }
  m = text.match(/(?:^|\D)(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|20\d{2})(?:\D|$)/);
  if (m) {
    const year=fullYear(m[3]), dmy=validIsoDate(year,m[2],m[1]), mdy=validIsoDate(year,m[1],m[2]);
    const candidates=[...new Set([dmy,mdy].filter(Boolean))];
    return candidates.length===1 ? {value:candidates[0],candidates,confidence:.91} : {value:"",candidates,confidence:.45};
  }
  return { value:"", candidates:[], confidence:0 };
}

function attachLabelLexicon(book: CoffeeRecognitionBook, lexicon: unknown): CoffeeRecognitionBook {
  if (!lexicon || typeof lexicon !== "object" || Array.isArray(lexicon)) return book;
  const fields = (lexicon as { fields?: Record<string, unknown> }).fields ?? {};
  const mapped: Record<string, { aliases: string[] }> = {};
  for (const [key, raw] of Object.entries(fields)) {
    const aliases = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { aliases?: unknown[] }).aliases)) ? (raw as { aliases: unknown[] }).aliases : [];
    mapped[key === "roastLevel" ? "roast" : key] = { aliases: aliases.map(clean).filter(Boolean) };
  }
  const entityAliases = ["producer","farm","cooperative","station"].flatMap((key) => mapped[key]?.aliases ?? []);
  if (entityAliases.length) mapped.entity = { aliases: [...new Set(entityAliases)] };
  return { ...book, labelLexicon: { version: String((lexicon as { version?: unknown }).version ?? "unknown"), fields: mapped } };
}

async function fetchJson(url: string, timeoutMs = 4500): Promise<unknown> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { cache: "no-store", signal: controller.signal }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
  finally { clearTimeout(timer); }
}

function cachedBook(): CoffeeRecognitionBook | undefined {
  try { const raw = globalThis.localStorage?.getItem(CACHE_KEY); return raw ? JSON.parse(raw) as CoffeeRecognitionBook : undefined; } catch { return undefined; }
}
function cacheBook(book: CoffeeRecognitionBook): void { try { globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(book)); } catch { /* cache is optional */ } }
let bookPromise: Promise<{ book: CoffeeRecognitionBook; source: LuckyBeanSemanticResult["source"] }> | undefined;

export function loadLuckyBeanRecognitionBook(): Promise<{ book: CoffeeRecognitionBook; source: LuckyBeanSemanticResult["source"] }> {
  if (bookPromise) return bookPromise;
  bookPromise = (async () => {
    const cached = cachedBook();
    try {
      const [bookValue, lexicon] = await Promise.all([fetchJson(REMOTE_CODEBOOK_URL), fetchJson(REMOTE_LABEL_LEXICON_URL).catch(() => undefined)]);
      const book = attachLabelLexicon(bookValue as CoffeeRecognitionBook, lexicon); cacheBook(book);
      return { book, source: "remote-codebook" as const };
    } catch {
      if (cached) return { book: cached, source: "cached-codebook" as const };
      return { book: CORE_FALLBACK_BOOK, source: "core-fallback" as const };
    }
  })();
  return bookPromise;
}

function fieldConfidence(labeled: boolean, match?: TableMatch): number { return match?.direct ? .995 : labeled ? .96 : match ? Math.min(.94,.62+match.alias.length/20) : 0; }

export function parseLuckyBeanSemanticText(sourceText: string, book: CoffeeRecognitionBook, source: LuckyBeanSemanticResult["source"] = "core-fallback"): LuckyBeanSemanticResult {
  const sourceTextClean = String(sourceText ?? "").trim(); const labeled = labeledFieldValues(sourceTextClean, book);
  const unlabelled = sourceTextClean.split(/\n+/).map((line)=>line.trim()).filter((line)=>line && !/^[^:：]{1,48}[:：]/.test(line)).join("\n");
  const inferenceSource = Object.keys(labeled).length ? unlabelled : sourceTextClean;
  const lower = inferenceSource.toLocaleLowerCase("zh-CN"), normalizedCodes = normalizeCodeSource(inferenceSource);
  const fields: Record<string,string> = {}, confidence: Record<string,number> = {}, evidence: Record<string,string> = {}; const used = new Set<string>();
  const definitions: readonly [keyof CoffeeRecognitionBook,string,string,string][] = [
    ["countries","country","country","country"], ["regions","region","region","region"], ["entities","farm","entity","farm"],
    ["varieties","variety","variety","variety"], ["processes","process","process","process"]
  ];
  for (const [table, outField, labelKey] of definitions) {
    const rows = book[table] ?? []; const labeledValue = labeled[labelKey] ?? ""; let match: TableMatch | undefined;
    if (labeledValue) match = bestTableMatch(labeledValue, rows);
    else {
      match = directCodeMatch(normalizedCodes, rows);
      if (!match) {
        for (const row of rows) {
          const aliases = row.slice(1).filter((item):item is string=>typeof item==="string" && !["active","candidate"].includes(item))
            .flatMap((item)=>item.split(/[\\/、,，;；|]/)).map((item)=>item.trim()).filter((item)=>item.length>=2);
          for (const alias of aliases) { const needle=alias.toLocaleLowerCase("zh-CN"); if (lower.includes(needle) && (!match || needle.length>match.alias.length)) match={code:String(row[0]),alias,row,direct:false}; }
        }
      }
    }
    const aliasKey = normalizeLabelValue(match?.alias).toLocaleLowerCase("zh-CN"); if (aliasKey && used.has(aliasKey)) match=undefined;
    if (match) { fields[outField]=rowDisplay(String(table),match.row); confidence[outField]=fieldConfidence(Boolean(labeledValue),match); evidence[outField]=labeledValue || match.alias; if(aliasKey)used.add(aliasKey); }
    else if (labeledValue) { fields[outField]=labeledValue; confidence[outField]=.72; evidence[outField]=labeledValue; }
  }

  const roastSource=labeled.roast||inferenceSource; const roastMap: readonly [RegExp,string,string][]=[
    [/极浅|超浅|lightest/i,"极浅烘","RL-L0"], [/浅中|medium\s*light/i,"浅中烘","RL-L2"], [/浅烘|浅度|light/i,"浅烘","RL-L1"],
    [/中深|medium\s*dark/i,"中深烘","RL-L4"], [/中烘|中度|medium/i,"中烘","RL-L3"], [/极深|法式|very\s*dark/i,"极深烘","RL-L6"], [/深烘|深度|dark/i,"深烘","RL-L5"]
  ];
  for (const [regex,label] of roastMap) if (regex.test(roastSource)) { fields.roast=label; confidence.roast=labeled.roast?.length?.95:.88; evidence.roast=roastSource.match(regex)?.[0]??label; break; }

  const dateFields=["roastDate","productionDate","packDate","bestBefore","expiryDate"] as const;
  for (const field of dateFields) if (labeled[field]) { const parsed=parseCoffeeDateValue(labeled[field]); if(parsed.value){fields[field]=parsed.value;confidence[field]=parsed.confidence;evidence[field]=labeled[field];} }
  if (labeled.harvest) { const m=labeled.harvest.match(/(?:^|\D)(20\d{2}|\d{2})(?:\s*[-–—\/]\s*(20\d{2}|\d{2}))?/); if(m){const a=fullYear(m[1]),b=m[2]?fullYear(m[2]):undefined;fields.harvest=b?`${a}/${b}`:String(a);confidence.harvest=.97;evidence.harvest=labeled.harvest;} }
  const altitudeSource=labeled.altitude||inferenceSource; const altitude=labeled.altitude?altitudeSource.match(/(\d{3,4})(?:\s*[-~至到]\s*(\d{3,4}))?\s*(?:m|米|masl)?/i):altitudeSource.match(/(\d{3,4})(?:\s*[-~至到]\s*(\d{3,4}))?\s*(?:m(?:asl)?\b|米)/i);
  if(altitude){fields.altitude=altitude[2]?`${altitude[1]}–${altitude[2]} m`:`${altitude[1]} m`;confidence.altitude=labeled.altitude?.length?.97:.84;evidence.altitude=labeled.altitude||altitude[0];}
  if(labeled.roastColor){const values=[...labeled.roastColor.matchAll(/(?:agtron\s*)?(\d{2,3}(?:\.\d+)?)/ig)].map((m)=>Number(m[1])).filter((v)=>v>=20&&v<=120);if(values.length){fields.roastColor=`Agtron ${values[0]}`;confidence.roastColor=values.length===1?.98:.76;evidence.roastColor=labeled.roastColor;}}
  const weightSource=labeled.weight||inferenceSource; const weight=labeled.weight?weightSource.match(/(\d{1,5}(?:\.\d+)?)\s*(?:g|克|grams?)?/i):weightSource.match(/(\d{1,5}(?:\.\d+)?)\s*(?:g(?:rams?)?\b|克)/i);
  if(weight){fields.weight=`${weight[1]} g`;confidence.weight=labeled.weight?.length?.95:.79;evidence.weight=labeled.weight||weight[0];}
  if(labeled.roaster){fields.roaster=labeled.roaster;confidence.roaster=.97;evidence.roaster=labeled.roaster;}
  if(labeled.lot){fields.lot=labeled.lot;confidence.lot=.96;evidence.lot=labeled.lot;} if(labeled.grade){fields.grade=labeled.grade;confidence.grade=.94;evidence.grade=labeled.grade;}

  const flavorSource=labeled.flavor||""; if(flavorSource){const flavorLower=flavorSource.toLocaleLowerCase("zh-CN"), names:string[]=[];for(const row of book.flavors??[]){const aliases=(row.length>=9?[row[4],row[5],row[6],row[7]]:[row[1],row[2],row[3]]).filter((v):v is string=>typeof v==="string").flatMap((v)=>v.split(/[/、,，;；|]/)).map((v)=>v.trim()).filter(Boolean);const hit=aliases.sort((a,b)=>b.length-a.length).find((alias)=>alias.length>=2&&flavorLower.includes(alias.toLocaleLowerCase("zh-CN")));if(hit)names.push(rowDisplay("flavors",row));}fields.flavorNotes=[...new Set(names)].join("、")||flavorSource;confidence.flavorNotes=names.length?.91:.72;evidence.flavorNotes=flavorSource;}
  return { fields, confidence, evidence, source, codebookVersion: String(book.version ?? "") };
}
