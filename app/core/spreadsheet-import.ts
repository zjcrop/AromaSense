import { read, utils } from "xlsx";
import {
  IMPORT_BUNDLE_SCHEMA,
  groupHeader,
  normalizeImportBundle,
  recognizedHeaderScore,
  sampleHeader,
  sampleLabelHeader,
  sessionHeader,
  type ImportBundle,
  type ImportSampleDraft,
  type ImportSessionDraft
} from "./import-bundle";
import type { CuppingSessionMetadata } from "./session-metadata";

export const SPREADSHEET_ACCEPT = ".xlsx,.xls,.xlsm,.xlsb,.ods,.fods,.csv,.tsv,.txt,.json";

function stringCell(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim();
}

function rowEmpty(row: readonly unknown[]): boolean {
  return row.every((cell) => !stringCell(cell));
}

function normalizeRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => Array.isArray(row) ? row.map(stringCell) : [stringCell(row)]);
}

function splitBlocks(rows: readonly string[][]): string[][][] {
  const blocks: string[][][] = [];
  let current: string[][] = [];
  const flush = () => {
    while (current.length && rowEmpty(current[current.length - 1])) current.pop();
    if (current.length) blocks.push(current);
    current = [];
  };
  for (const row of rows) {
    if (rowEmpty(row)) { flush(); continue; }
    const looksLikeHeader = recognizedHeaderScore(row) >= 2;
    const currentHasData = current.length >= 2;
    if (looksLikeHeader && currentHasData) flush();
    current.push([...row]);
  }
  flush();
  return blocks;
}

interface ColumnMap {
  label?: number;
  group?: number;
  session: Partial<Record<keyof CuppingSessionMetadata, number>>;
  sample: Record<string, number>;
  unknown: number[];
}

function mapHeaders(header: readonly string[]): ColumnMap {
  const result: ColumnMap = { session: {}, sample: {}, unknown: [] };
  header.forEach((name, index) => {
    if (sampleLabelHeader(name) && result.label === undefined) { result.label = index; return; }
    if (groupHeader(name) && result.group === undefined) { result.group = index; return; }
    const session = sessionHeader(name);
    if (session && result.session[session] === undefined) { result.session[session] = index; return; }
    const sample = sampleHeader(name);
    if (sample && result.sample[sample] === undefined) { result.sample[sample] = index; return; }
    if (stringCell(name)) result.unknown.push(index);
  });
  return result;
}

function valueAt(row: readonly string[], index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  const value = stringCell(row[index]);
  return value || undefined;
}

function commonSessionMetadata(rows: readonly string[][], map: ColumnMap, warnings: string[], groupLabel: string): Partial<CuppingSessionMetadata> {
  const result: Partial<CuppingSessionMetadata> = {};
  for (const key of ["date", "time", "organizer", "participants", "target", "eventName"] as const) {
    const index = map.session[key];
    if (index === undefined) continue;
    const values = [...new Set(rows.map((row) => valueAt(row, index)).filter((value): value is string => Boolean(value)))];
    if (values.length) result[key] = values[0];
    if (values.length > 1) warnings.push(`${groupLabel} 的“${key}”列存在多个值，暂以首个值作为组级信息并保留逐项确认。`);
  }
  return result;
}

function sampleFromRow(row: readonly string[], map: ColumnMap, sourceRow: number): ImportSampleDraft | undefined {
  const metadata: Record<string, unknown> = {};
  for (const [key, index] of Object.entries(map.sample)) {
    const value = valueAt(row, index);
    if (value) metadata[key] = value;
  }
  const rawText = row.filter(Boolean).join("；");
  if (!rawText) return undefined;
  let label = valueAt(row, map.label);
  if (!label) {
    const candidate = [metadata.farm, metadata.station, metadata.region, metadata.variety, metadata.country]
      .map(stringCell).filter(Boolean);
    label = candidate.length ? [...new Set(candidate)].slice(0, 2).join(" · ") : `待确认样品 ${String(sourceRow).padStart(2, "0")}`;
  }
  return { label, metadata, rawText, sourceRow, requiresReview: true };
}

function unstructuredBlock(sheetName: string, block: readonly string[][], blockIndex: number): ImportSessionDraft | undefined {
  const samples = block.flatMap((row, index) => {
    const rawText = row.filter(Boolean).join("；");
    if (!rawText) return [];
    return [{
      label: stringCell(row[0]) || `待确认样品 ${String(index + 1).padStart(2, "0")}`,
      metadata: {},
      rawText,
      sourceRow: index + 1,
      requiresReview: true
    } satisfies ImportSampleDraft];
  });
  if (!samples.length) return undefined;
  return { sourceGroup: `${sheetName} · 数据组 ${blockIndex + 1}`, title: sheetName, metadata: {}, samples };
}

function structuredBlock(
  sheetName: string,
  block: readonly string[][],
  blockIndex: number,
  warnings: string[]
): ImportSessionDraft[] {
  const headerIndex = block.findIndex((row) => recognizedHeaderScore(row) >= 1);
  if (headerIndex < 0) {
    const fallback = unstructuredBlock(sheetName, block, blockIndex);
    return fallback ? [fallback] : [];
  }
  const header = block[headerIndex];
  const map = mapHeaders(header);
  const rows = block.slice(headerIndex + 1).filter((row) => !rowEmpty(row));
  if (!rows.length) return [];

  const groups = new Map<string, string[][]>();
  if (map.group !== undefined) {
    for (const row of rows) {
      const name = valueAt(row, map.group) ?? "未分组";
      const list = groups.get(name) ?? [];
      list.push(row); groups.set(name, list);
    }
  } else {
    groups.set(block.length > 1 ? `${sheetName}${blockIndex ? ` · 数据组 ${blockIndex + 1}` : ""}` : sheetName, rows.map((row) => [...row]));
  }

  const sessions: ImportSessionDraft[] = [];
  for (const [groupName, groupRows] of groups) {
    const sourceGroup = map.group !== undefined ? `${sheetName} · ${groupName}` : groupName;
    const metadata = commonSessionMetadata(groupRows, map, warnings, sourceGroup);
    const samples = groupRows.flatMap((row, index) => {
      const sample = sampleFromRow(row, map, headerIndex + index + 2);
      return sample ? [sample] : [];
    });
    if (!samples.length) continue;
    sessions.push({
      sourceGroup,
      title: metadata.eventName || (map.group !== undefined ? groupName : sheetName),
      metadata,
      samples
    });
  }
  if (map.unknown.length) {
    const names = map.unknown.map((index) => header[index]).filter(Boolean).slice(0, 8);
    if (names.length) warnings.push(`${sheetName} 有未映射列：${names.join("、")}。这些列不会自动写入字段，可在逐豆确认时补充。`);
  }
  return sessions;
}

export async function parseSpreadsheetFile(file: File): Promise<ImportBundle> {
  const lower = file.name.toLocaleLowerCase("en-US");
  if (lower.endsWith(".json")) {
    const parsed = JSON.parse(await file.text()) as unknown;
    const bundle = normalizeImportBundle(parsed, { kind: "json", name: file.name });
    if (!bundle) throw new Error("JSON 文件不是可识别的 AromaSense 导入格式");
    return bundle;
  }

  const data = await file.arrayBuffer();
  const workbook = read(data, { type: "array", raw: false, cellDates: false, dense: true });
  const warnings: string[] = [];
  const sessions: ImportSessionDraft[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = normalizeRows(utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: true }));
    const blocks = splitBlocks(rows);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      sessions.push(...structuredBlock(sheetName, blocks[blockIndex], blockIndex, warnings));
    }
  }
  if (!sessions.length) throw new Error("表格中没有检测到可导入的杯测样品");
  return {
    schema: IMPORT_BUNDLE_SCHEMA,
    source: { kind: "spreadsheet", name: file.name },
    sessions,
    warnings
  };
}
