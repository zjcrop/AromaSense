import type { CuppingSessionMetadata } from "./session-metadata";

export const IMPORT_BUNDLE_SCHEMA = "aromasense-import/1" as const;

export type ImportSourceKind = "text" | "spreadsheet" | "json" | "link" | "qr";

export interface ImportSource {
  kind: ImportSourceKind;
  name?: string;
}

export interface ImportSampleDraft {
  label: string;
  metadata: Record<string, unknown>;
  rawText?: string;
  sourceRow?: number;
  requiresReview: boolean;
}

export interface ImportSessionDraft {
  sourceGroup: string;
  title?: string;
  metadata: Partial<CuppingSessionMetadata>;
  samples: ImportSampleDraft[];
}

export interface ImportBundle {
  schema: typeof IMPORT_BUNDLE_SCHEMA;
  source: ImportSource;
  sessions: ImportSessionDraft[];
  warnings: string[];
}

const SAMPLE_LABEL_ALIASES = new Set([
  "name", "sample", "sample name", "coffee", "bean", "label",
  "名称", "样品", "样品名", "咖啡", "咖啡豆", "豆名", "编号"
]);

const GROUP_ALIASES = new Set([
  "group", "session", "session id", "sessionid", "cupping", "cupping group", "batch",
  "杯测组", "组", "分组", "杯测", "场次", "批次组"
]);

const SESSION_FIELD_ALIASES: Readonly<Record<string, keyof CuppingSessionMetadata>> = Object.freeze({
  date: "date", 日期: "date", 杯测日期: "date",
  time: "time", 时间: "time", 杯测时间: "time",
  organizer: "organizer", organisation: "organizer", organization: "organizer", 主办方: "organizer", 组织方: "organizer",
  participants: "participants", participant: "participants", 对象: "participants", 参与对象: "participants", 参与者: "participants",
  target: "target", goal: "target", objective: "target", 测试目标: "target", 杯测目标: "target", 目标: "target",
  event: "eventName", eventname: "eventName", "event name": "eventName", 杯测会名称: "eventName", 杯测名称: "eventName", 会名称: "eventName"
});

const SAMPLE_FIELD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  country: "country", origin: "origin", "origin country": "country", 国家: "country", 产国: "country", 产地国家: "country", 产地: "origin",
  region: "region", area: "region", 产区: "region", 区域: "region",
  farm: "farm", estate: "farm", 农场: "farm", 庄园: "farm",
  station: "station", "washing station": "station", 处理站: "station",
  producer: "producer", grower: "producer", 生产者: "producer",
  cooperative: "cooperative", coop: "cooperative", 合作社: "cooperative",
  variety: "variety", cultivar: "variety", 品种: "variety", 豆种: "variety",
  species: "species", 种属: "species",
  process: "process", processing: "process", 处理: "process", 处理法: "process",
  lot: "lot", lotno: "lot", "lot no": "lot", 批次: "lot", 批号: "lot",
  grade: "grade", 等级: "grade",
  roast: "roast", "roast level": "roast", 烘焙度: "roast",
  roastcolor: "roastColor", "roast color": "roastColor", agtron: "roastColor", 烘焙色值: "roastColor",
  roastdate: "roastDate", "roast date": "roastDate", 烘焙日期: "roastDate",
  productiondate: "productionDate", "production date": "productionDate", 生产日期: "productionDate",
  packdate: "packDate", "pack date": "packDate", 包装日期: "packDate",
  bestbefore: "bestBefore", "best before": "bestBefore", 最佳赏味期: "bestBefore",
  expirydate: "expiryDate", "expiry date": "expiryDate", 到期日: "expiryDate",
  harvest: "harvest", crop: "harvest", 产季: "harvest",
  altitude: "altitude", elevation: "altitude", 海拔: "altitude",
  roaster: "roaster", 烘焙商: "roaster",
  weight: "weight", netweight: "weight", "net weight": "weight", 净重: "weight",
  flavor: "flavorNotes", flavours: "flavorNotes", flavors: "flavorNotes", notes: "flavorNotes", 风味: "flavorNotes", 风味描述: "flavorNotes",
  aroma: "aroma", 香气: "aroma"
});

export function normalizeImportHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[：:]/g, "")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function sampleLabelHeader(value: unknown): boolean {
  return SAMPLE_LABEL_ALIASES.has(normalizeImportHeader(value));
}

export function groupHeader(value: unknown): boolean {
  return GROUP_ALIASES.has(normalizeImportHeader(value));
}

export function sessionHeader(value: unknown): keyof CuppingSessionMetadata | undefined {
  return SESSION_FIELD_ALIASES[normalizeImportHeader(value)];
}

export function sampleHeader(value: unknown): string | undefined {
  return SAMPLE_FIELD_ALIASES[normalizeImportHeader(value)];
}

export function recognizedHeaderScore(row: readonly unknown[]): number {
  let score = 0;
  for (const cell of row) {
    if (sampleLabelHeader(cell) || groupHeader(cell) || sessionHeader(cell) || sampleHeader(cell)) score += 1;
  }
  return score;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

function normalizeMetadata(value: unknown): Partial<CuppingSessionMetadata> {
  const source = object(value) ?? {};
  const result: Partial<CuppingSessionMetadata> = {};
  for (const key of ["date", "time", "organizer", "participants", "target", "eventName"] as const) {
    const normalized = stringValue(source[key]);
    if (normalized) result[key] = normalized;
  }
  return result;
}

function normalizeSamples(value: unknown): ImportSampleDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const source = object(item);
    if (!source) return [];
    const metadata = object(source.metadata) ?? {};
    const label = stringValue(source.label) ?? stringValue(source.name) ?? `待确认样品 ${String(index + 1).padStart(2, "0")}`;
    return [{
      label,
      metadata,
      rawText: stringValue(source.rawText),
      sourceRow: Number.isFinite(Number(source.sourceRow)) ? Number(source.sourceRow) : undefined,
      requiresReview: source.requiresReview !== false
    }];
  });
}

function normalizeSession(value: unknown, fallbackGroup: string): ImportSessionDraft | undefined {
  const source = object(value);
  if (!source) return undefined;
  const samples = normalizeSamples(source.samples);
  if (!samples.length) return undefined;
  const metadata = normalizeMetadata(source.metadata);
  const title = stringValue(source.title) ?? metadata.eventName;
  return {
    sourceGroup: stringValue(source.sourceGroup) ?? fallbackGroup,
    title,
    metadata,
    samples
  };
}

/** Accepts the new bundle plus the 0.1C legacy share shapes. */
export function normalizeImportBundle(value: unknown, source: ImportSource): ImportBundle | undefined {
  const root = object(value);
  if (!root) return undefined;
  if (root.schema === IMPORT_BUNDLE_SCHEMA && Array.isArray(root.sessions)) {
    const sessions = root.sessions.flatMap((item, index) => {
      const normalized = normalizeSession(item, `组 ${index + 1}`);
      return normalized ? [normalized] : [];
    });
    return sessions.length ? { schema: IMPORT_BUNDLE_SCHEMA, source, sessions, warnings: Array.isArray(root.warnings) ? root.warnings.map(String) : [] } : undefined;
  }

  if (Array.isArray(root.sessions)) {
    const sessions = root.sessions.flatMap((item, index) => {
      const normalized = normalizeSession(item, `组 ${index + 1}`);
      return normalized ? [normalized] : [];
    });
    if (sessions.length) return { schema: IMPORT_BUNDLE_SCHEMA, source, sessions, warnings: [] };
  }

  const nested = object(root.session);
  const legacy = normalizeSession({
    title: root.title ?? nested?.title,
    metadata: root.metadata ?? nested?.metadata,
    samples: root.samples ?? nested?.samples
  }, "分享杯测");
  return legacy ? { schema: IMPORT_BUNDLE_SCHEMA, source, sessions: [legacy], warnings: [] } : undefined;
}
