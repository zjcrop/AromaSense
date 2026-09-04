import { detectFieldAnchor, fieldAliasCount, splitInlineFieldPair } from "./recognition-field-lexicon";
import { medianLineHeight, type OCRBox, type OCRLayoutDocument, type OCRLayoutLine } from "./ocr-layout-model";

export type SampleLayoutType = "single" | "row-list" | "vertical-block-list" | "grid" | "table" | "mixed";

export interface SampleLayoutHints {
  profile?: string;
  sourceTitle?: string;
  sourceCode?: string;
  sourceFields?: Readonly<Record<string, string>>;
}

export interface SampleLayoutSegment {
  id: string;
  index: number;
  confidence: number;
  box: OCRBox;
  lines: readonly OCRLayoutLine[];
  text: string;
  hints?: SampleLayoutHints;
}

export interface SampleLayoutResult {
  layoutType: SampleLayoutType;
  confidence: number;
  requiresReview: boolean;
  segments: readonly SampleLayoutSegment[];
}

interface OCRRow {
  id: string;
  lines: OCRLayoutLine[];
  box: OCRBox;
  text: string;
  fieldAnchors: Set<string>;
}

interface CatalogCard {
  section?: OCRRow;
  titleRows: OCRRow[];
  detail: OCRRow;
}

type TableRole = "code" | "name" | "process" | "origin" | "variety" | "roast" | "flavor" | "price";

interface TableColumn {
  role: TableRole;
  centerX: number;
}

interface TableRecord {
  code: string;
  rows: OCRRow[];
}

const IDENTITY_FIELDS = new Set(["country", "origin", "region", "farm", "producer", "station", "cooperative"]);
const PROCESS_SIGNAL = /(?:水洗|日晒|日曬|厌氧|厭氧|蜜处理|蜜處理|湿刨|濕刨|酵素|發酵|发酵|washed|natural|anaerobic|honey\s*process|wet\s*hulled|semi[-\s]?washed|carbonic|ナチュラル|ウォッシュド|ハニー|嫌気|워시드|내추럴|허니|무산소)/iu;
const GRADE_SIGNAL = /(?:^|[\s·|｜,，、-])(?:G\s*[1-4]|AA\+?|AAA|AB|PB|SHB|SHG|EP|TOP)(?:$|[\s·|｜,，、-])/iu;
const ROAST_SECTION_SIGNAL = /^(?:(?:淺中|浅中|中淺|中浅|淺|浅|中|中深|深|極深|极深)(?:度)?(?:焙|培|烘焙)?|(?:light|medium\s*light|medium|medium\s*dark|dark)\s*roast|(?:浅煎り|中浅煎り|中煎り|中深煎り|深煎り)|(?:약배전|중약배전|중배전|중강배전|강배전))$/iu;
const ROAST_INLINE_SIGNAL = /(?:淺中焙|浅中焙|中淺焙|中浅焙|淺焙|浅焙|中焙|中深焙|深焙|極深焙|极深焙|light\s*roast|medium\s*light|medium\s*roast|medium\s*dark|dark\s*roast|浅煎り|中浅煎り|中煎り|中深煎り|深煎り|약배전|중약배전|중배전|중강배전|강배전)/iu;
const CATALOG_CODE_SIGNAL = /(?:^|\s)([A-Z]{2,8}[-_ ]?\d{1,4})(?=\s|$|[【\[])/iu;

function unionBox(lines: readonly OCRLayoutLine[]): OCRBox {
  const boxes = lines.map((line) => line.normalizedBox);
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0.0001, right - left),
    height: Math.max(0.0001, bottom - top),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function verticalOverlap(a: OCRBox, b: OCRBox): number {
  const overlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return overlap / Math.max(0.0001, Math.min(a.height, b.height));
}

function rowAnchorSet(lines: readonly OCRLayoutLine[]): Set<string> {
  const result = new Set<string>();
  for (const line of lines) {
    const inline = splitInlineFieldPair(line.text);
    if (inline) result.add(inline.field);
    const anchor = detectFieldAnchor(line.text);
    if (anchor) result.add(anchor.field);
  }
  return result;
}

function buildRows(document: OCRLayoutDocument): OCRRow[] {
  const rows: OCRRow[] = [];
  for (const line of [...document.lines].sort((a, b) => a.normalizedBox.top - b.normalizedBox.top || a.normalizedBox.left - b.normalizedBox.left)) {
    const match = rows.find((row) =>
      verticalOverlap(row.box, line.normalizedBox) >= 0.42 ||
      Math.abs(row.box.centerY - line.normalizedBox.centerY) <= Math.max(row.box.height, line.normalizedBox.height) * 0.58
    );
    if (match) {
      match.lines.push(line);
      match.lines.sort((a, b) => a.normalizedBox.left - b.normalizedBox.left);
      match.box = unionBox(match.lines);
      match.text = match.lines.map((item) => item.text).join(" | ");
      match.fieldAnchors = rowAnchorSet(match.lines);
    } else {
      rows.push({
        id: `${document.imageId}-row-${rows.length + 1}`,
        lines: [line],
        box: line.normalizedBox,
        text: line.text,
        fieldAnchors: rowAnchorSet([line])
      });
    }
  }
  rows.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  return rows;
}

function segmentFromLines(
  document: OCRLayoutDocument,
  index: number,
  lines: readonly OCRLayoutLine[],
  confidence: number,
  hints?: SampleLayoutHints
): SampleLayoutSegment {
  return {
    id: `${document.imageId}-sample-${index + 1}`,
    index,
    confidence: Math.max(0, Math.min(1, confidence)),
    box: unionBox(lines),
    lines,
    text: lines.map((line) => line.text).join("\n"),
    ...(hints ? { hints } : {})
  };
}

function compactText(value: string): string {
  return value.normalize("NFKC").replace(/[\s【】\[\]<>《》「」『』()（）:：|｜·•・]/g, "").trim();
}

function tableHeaderRole(value: string): TableRole | undefined {
  const text = compactText(value).toLowerCase();
  if (/^(?:編號|编号|代號|代号|代碼|代码|code|no\.?)/iu.test(text)) return "code";
  if (/(?:咖啡豆單品|咖啡豆单品|咖啡豆品名|豆名|品名|coffeebean|coffeename)/iu.test(text)) return "name";
  if (/(?:處理法|处理法|process)/iu.test(text)) return "process";
  if (/(?:產地|产地|origin)/iu.test(text)) return "origin";
  if (/(?:品種|品种|variety)/iu.test(text)) return "variety";
  if (/(?:焙度|烘焙|roast)/iu.test(text)) return "roast";
  if (/(?:風味|风味|flavo?r|tastingnote|cuppingnote)/iu.test(text)) return "flavor";
  if (/(?:售價|售价|price)/iu.test(text)) return "price";
  return undefined;
}

function tableColumns(header: OCRRow): TableColumn[] {
  return header.lines
    .map((line) => {
      const role = tableHeaderRole(line.text);
      return role ? { role, centerX: line.normalizedBox.centerX } : undefined;
    })
    .filter((value): value is TableColumn => Boolean(value));
}

function nearestTableRole(line: OCRLayoutLine, columns: readonly TableColumn[]): TableRole | undefined {
  let best: TableColumn | undefined;
  let bestDistance = Infinity;
  for (const column of columns) {
    const distance = Math.abs(line.normalizedBox.centerX - column.centerX);
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= 0.18 ? best.role : undefined;
}

function tableFieldText(rows: readonly OCRRow[], columns: readonly TableColumn[], role: TableRole): string {
  const values = rows
    .flatMap((row) => row.lines)
    .filter((line) => nearestTableRole(line, columns) === role)
    .map((line) => line.text.trim())
    .filter(Boolean);
  return [...new Set(values)].join(" ").trim();
}

function tableCodeFromRow(row: OCRRow, columns: readonly TableColumn[]): string | undefined {
  const codeLine = row.lines.find((line) => nearestTableRole(line, columns) === "code");
  if (!codeLine) return undefined;
  const value = codeLine.text.normalize("NFKC").trim();
  if (/^(?:[A-Z]|\d{1,3}|[A-Z]{1,8}[-_ ]?\d{1,4})$/iu.test(value)) return value;
  return undefined;
}

function isTableSchemaBreak(row: OCRRow): boolean {
  const text = compactText(row.text);
  return /(?:掛耳式咖啡|挂耳式咖啡|內容物|内容物|環保方案|环保方案|網購及外送|网购及外送|現場開放時間|现场开放时间|轉帳資訊|转账资讯)/iu.test(text);
}

function coffeeTableRecords(body: readonly OCRRow[], columns: readonly TableColumn[]): TableRecord[] {
  const records: TableRecord[] = [];
  let current: TableRecord | undefined;
  for (const row of body) {
    if (isTableSchemaBreak(row) && records.length >= 2) break;
    const code = tableCodeFromRow(row, columns);
    if (code) {
      if (current) records.push(current);
      current = { code, rows: [row] };
      continue;
    }
    if (current) current.rows.push(row);
  }
  if (current) records.push(current);
  return records;
}

function coffeeTableHints(record: TableRecord, columns: readonly TableColumn[]): SampleLayoutHints | undefined {
  const sourceTitle = tableFieldText(record.rows, columns, "name");
  const process = tableFieldText(record.rows, columns, "process");
  const origin = tableFieldText(record.rows, columns, "origin");
  const variety = tableFieldText(record.rows, columns, "variety");
  const roastRaw = tableFieldText(record.rows, columns, "roast");
  const roast = roastRaw.match(ROAST_INLINE_SIGNAL)?.[0] ?? "";
  const flavorNotes = tableFieldText(record.rows, columns, "flavor");
  if (!sourceTitle || !PROCESS_SIGNAL.test(process || record.rows.map((row) => row.text).join(" "))) return undefined;
  const sourceFields: Record<string, string> = {};
  if (process) sourceFields.process = process;
  if (origin) sourceFields.origin = origin;
  if (variety) sourceFields.variety = variety;
  if (roast) sourceFields.roast = roast;
  if (flavorNotes) sourceFields.flavorNotes = flavorNotes;
  return {
    profile: "coffee-table-v1",
    sourceTitle,
    sourceCode: record.code,
    sourceFields
  };
}

function tableSegments(document: OCRLayoutDocument, rows: readonly OCRRow[]): SampleLayoutResult | undefined {
  const headerIndex = rows.findIndex((row, index) => {
    if (index >= 6 || row.lines.length < 2) return false;
    const roleCount = row.lines.map((line) => tableHeaderRole(line.text)).filter(Boolean).length;
    return roleCount >= 2 || row.fieldAnchors.size >= 2 || fieldAliasCount(row.text) >= 2;
  });
  if (headerIndex < 0 || rows.length - headerIndex < 3) return undefined;
  const header = rows[headerIndex];
  const body = rows.slice(headerIndex + 1).filter((row) => row.text.trim());
  if (body.length < 2) return undefined;

  const columns = tableColumns(header);
  const hasCoffeeSchema = columns.some((column) => column.role === "code") &&
    columns.some((column) => column.role === "name") &&
    columns.some((column) => column.role === "process");
  if (hasCoffeeSchema) {
    const records = coffeeTableRecords(body, columns);
    const recognized = records
      .map((record) => ({ record, hints: coffeeTableHints(record, columns) }))
      .filter((item): item is { record: TableRecord; hints: SampleLayoutHints } => Boolean(item.hints));
    if (recognized.length >= 2) {
      const confidence = recognized.length >= 3 ? 0.96 : 0.93;
      const segments = recognized.map((item, index) =>
        segmentFromLines(document, index, item.record.rows.flatMap((row) => row.lines), confidence, item.hints)
      );
      return { layoutType: "table", confidence, requiresReview: false, segments };
    }
  }

  // Generic table fallback retained for non-catalog tables that use semantic field
  // headings but do not carry a dedicated sample-code/name column.
  const minimumCells = Math.max(2, Math.min(3, header.lines.length - 1));
  const tabularRows = body.filter((row) => row.lines.length >= minimumCells && row.box.width >= 0.28).length;
  if (tabularRows / body.length < 0.75) return undefined;
  const segments = body.map((row, index) => segmentFromLines(document, index, row.lines, 0.9, { profile: "generic-table" }));
  return { layoutType: "table", confidence: 0.9, requiresReview: false, segments };
}

function isRoastSectionHeader(row: OCRRow): boolean {
  const text = compactText(row.text);
  return text.length >= 2 && text.length <= 18 && ROAST_SECTION_SIGNAL.test(text);
}

function isFlavorDetailRow(row: OCRRow): boolean {
  return row.fieldAnchors.has("flavor");
}

function flavorValueFromRows(rows: readonly OCRRow[]): string {
  return rows
    .map((row) => row.text)
    .join(" ")
    .replace(/^.*?(?:風味描述|风味描述|風味|风味)\s*[|｜:：]?\s*/iu, "")
    .trim();
}

function sourceCodeFromText(text: string): string | undefined {
  return text.match(CATALOG_CODE_SIGNAL)?.[1]?.replace(/[_ ]/g, "-");
}

function codedCatalogSegments(document: OCRLayoutDocument, rows: readonly OCRRow[]): SampleLayoutResult | undefined {
  const anchors = rows
    .map((row, index) => ({ row, index, code: sourceCodeFromText(row.text) }))
    .filter((item): item is { row: OCRRow; index: number; code: string } => Boolean(item.code));
  if (anchors.length < 2) return undefined;
  const lefts = anchors.map((item) => item.row.box.left);
  if (Math.max(...lefts) - Math.min(...lefts) > 0.18) return undefined;

  const segments: SampleLayoutSegment[] = [];
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const nextIndex = anchors[anchorIndex + 1]?.index ?? rows.length;
    const groupRows = rows.slice(anchor.index, nextIndex).filter((row) => !isRoastSectionHeader(row));
    const flavorIndex = groupRows.findIndex(isFlavorDetailRow);
    const titleRows = (flavorIndex >= 0 ? groupRows.slice(0, flavorIndex) : groupRows.slice(0, 2)).slice(0, 3);
    const sourceTitle = titleRows.map((row) => row.text).join(" ").trim();
    if (!sourceTitle) continue;
    const sourceFields: Record<string, string> = {};
    if (flavorIndex >= 0) {
      const flavorRows = groupRows.slice(flavorIndex, Math.min(groupRows.length, flavorIndex + 3));
      const flavorNotes = flavorValueFromRows(flavorRows);
      if (flavorNotes) sourceFields.flavorNotes = flavorNotes;
    }
    const lines = groupRows.flatMap((row) => row.lines);
    if (!lines.length) continue;
    segments.push(segmentFromLines(document, segments.length, lines, 0.96, {
      profile: "coded-catalog-card-v1",
      sourceTitle,
      sourceCode: anchor.code,
      sourceFields
    }));
  }
  if (segments.length < 2) return undefined;
  return { layoutType: "vertical-block-list", confidence: 0.96, requiresReview: false, segments };
}

function titleLooksCoffeeLike(rows: readonly OCRRow[]): boolean {
  const text = rows.map((row) => row.text).join(" ");
  return PROCESS_SIGNAL.test(text) || GRADE_SIGNAL.test(text);
}

function catalogCardSegments(document: OCRLayoutDocument, rows: readonly OCRRow[]): SampleLayoutResult | undefined {
  const coded = codedCatalogSegments(document, rows);
  if (coded) return coded;

  const flavorRows = rows.filter(isFlavorDetailRow);
  if (flavorRows.length < 2) return undefined;

  const cards: CatalogCard[] = [];
  let activeSection: OCRRow | undefined;
  let pending: OCRRow[] = [];

  for (const row of rows) {
    if (isRoastSectionHeader(row)) {
      activeSection = row;
      pending = [];
      continue;
    }
    if (isFlavorDetailRow(row)) {
      const coffeeLike = pending.filter((candidate) => titleLooksCoffeeLike([candidate]));
      const anchorRow = coffeeLike.at(-1);
      const anchorIndex = anchorRow ? pending.lastIndexOf(anchorRow) : Math.max(0, pending.length - 1);
      const titleRows = pending
        .slice(Math.max(0, anchorIndex - 1))
        .filter((candidate) => !isRoastSectionHeader(candidate) && !isFlavorDetailRow(candidate))
        .slice(-3);
      if (titleRows.length) cards.push({ section: activeSection, titleRows, detail: row });
      pending = [];
      continue;
    }
    if (row.text.trim().length >= 2) pending.push(row);
  }

  if (cards.length < 2) return undefined;

  const structuredCards = cards.filter((card) =>
    card.titleRows.some((row) => row.box.width >= 0.18 && row.text.trim().length >= 3)
  );
  if (structuredCards.length < 2 || structuredCards.length / cards.length < 0.75) return undefined;

  const processLikeCount = structuredCards.filter((card) => titleLooksCoffeeLike(card.titleRows)).length;
  const processRatio = processLikeCount / structuredCards.length;
  const titleLefts = structuredCards.map((card) => card.titleRows[0]?.box.left ?? 0);
  const detailLefts = structuredCards.map((card) => card.detail.box.left);
  const titleSpread = Math.max(...titleLefts) - Math.min(...titleLefts);
  const detailSpread = Math.max(...detailLefts) - Math.min(...detailLefts);
  const aligned = titleSpread <= 0.16 && detailSpread <= 0.16;

  const strongRepeatedStructure = structuredCards.length >= 3 && aligned;
  const strongTwoCardStructure = structuredCards.length === 2 && aligned && processRatio >= 0.5;
  if (!strongRepeatedStructure && !strongTwoCardStructure) return undefined;
  if (structuredCards.length >= 3 && processRatio < 0.34 && !structuredCards.some((card) => card.section)) return undefined;

  const confidence = processRatio >= 0.6 && aligned ? 0.92 : 0.86;
  const segments = structuredCards.map((card, index) => {
    const sourceTitle = card.titleRows.map((row) => row.text).join(" ").trim();
    const sourceFields: Record<string, string> = {};
    const flavorNotes = flavorValueFromRows([card.detail]);
    if (flavorNotes) sourceFields.flavorNotes = flavorNotes;
    if (card.section) sourceFields.roast = card.section.text.trim();
    const lines = [
      ...(card.section ? card.section.lines : []),
      ...card.titleRows.flatMap((row) => row.lines),
      ...card.detail.lines
    ];
    return segmentFromLines(document, index, lines, confidence, {
      profile: "flavor-catalog-card-v1",
      sourceTitle,
      sourceCode: sourceCodeFromText(sourceTitle),
      sourceFields
    });
  });

  return {
    layoutType: "vertical-block-list",
    confidence,
    requiresReview: confidence < 0.9,
    segments
  };
}

function columnClusters(rows: readonly OCRRow[], medianHeight: number): OCRRow[][] {
  const clusters: OCRRow[][] = [];
  for (const row of rows) {
    let best: OCRRow[] | undefined;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const left = cluster.reduce((sum, item) => sum + item.box.left, 0) / cluster.length;
      const distance = Math.abs(row.box.left - left);
      const horizontalOverlap = cluster.some((item) =>
        Math.max(0, Math.min(item.box.right, row.box.right) - Math.max(item.box.left, row.box.left)) >= Math.min(item.box.width, row.box.width) * 0.35
      );
      if ((horizontalOverlap || distance <= Math.max(0.07, medianHeight * 1.8)) && distance < bestDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }
    if (best) best.push(row);
    else clusters.push([row]);
  }
  return clusters.sort((a, b) => Math.min(...a.map((row) => row.box.left)) - Math.min(...b.map((row) => row.box.left)));
}

function blockFields(rows: readonly OCRRow[]): Set<string> {
  return new Set(rows.flatMap((row) => [...row.fieldAnchors]));
}

function startsRecord(row: OCRRow): boolean {
  return [...row.fieldAnchors].some((field) => IDENTITY_FIELDS.has(field));
}

function blockLooksLikeRecord(rows: readonly OCRRow[]): boolean {
  const fields = blockFields(rows);
  const hasIdentity = [...fields].some((field) => IDENTITY_FIELDS.has(field));
  return (hasIdentity && fields.size >= 2) || fields.size >= 3;
}

function splitColumnIntoBlocks(rows: readonly OCRRow[], medianHeight: number): OCRRow[][] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.box.top - b.box.top);
  const blocks: OCRRow[][] = [[sorted[0]]];
  let seenFields = new Set(sorted[0].fieldAnchors);
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    const gapRatio = Math.max(0, current.box.top - previous.box.bottom) / Math.max(0.008, medianHeight);
    const repeatedAnchor = [...current.fieldAnchors].some((field) => seenFields.has(field));
    const currentStartsRecord = startsRecord(current);
    const previousBlock = blocks[blocks.length - 1];
    const previousFieldCount = blockFields(previousBlock).size;
    const visualBreak = gapRatio >= 1.45;
    const semanticBreak = repeatedAnchor && previousFieldCount >= 2;
    const anchorRestart = currentStartsRecord && previousFieldCount >= 3 && gapRatio >= 0.45;

    if ((visualBreak && (currentStartsRecord || repeatedAnchor)) || semanticBreak || anchorRestart) {
      blocks.push([current]);
      seenFields = new Set(current.fieldAnchors);
    } else {
      blocks[blocks.length - 1].push(current);
      current.fieldAnchors.forEach((field) => seenFields.add(field));
    }
  }
  return blocks;
}

function explicitRowRecord(row: OCRRow): boolean {
  if (row.lines.length !== 1) return false;
  const text = row.lines[0]?.text ?? "";
  const tokenCount = text.split(/[\s|,，、/]+/).filter(Boolean).length;
  const delimited = /[|｜]/.test(text);
  const numbered = /^\s*(?:#?\d{1,3}|[A-Z]\d{1,3})[.)、:\s-]+/i.test(text);
  return tokenCount >= 3 && row.box.width >= 0.45 && (delimited || numbered);
}

function rowListSegments(document: OCRLayoutDocument, rows: readonly OCRRow[], medianHeight: number): SampleLayoutResult | undefined {
  if (rows.length < 2) return undefined;
  const explicitRecords = rows.filter(explicitRowRecord);
  if (explicitRecords.length / rows.length < 0.72) return undefined;
  const gaps = rows.slice(1).map((row, index) => Math.max(0, row.box.top - rows[index].box.bottom) / Math.max(0.008, medianHeight));
  const regularGaps = gaps.filter((gap) => gap <= 1.35).length;
  if (gaps.length && regularGaps / gaps.length < 0.65) return undefined;
  const segments = rows.map((row, index) => segmentFromLines(document, index, row.lines, 0.82, { profile: "row-list" }));
  return { layoutType: "row-list", confidence: 0.82, requiresReview: true, segments };
}

export function segmentSamples(document: OCRLayoutDocument): SampleLayoutResult {
  if (!document.lines.length) return { layoutType: "single", confidence: 0.2, requiresReview: true, segments: [] };
  const rows = buildRows(document);
  if (rows.length <= 1) {
    return { layoutType: "single", confidence: 0.96, requiresReview: false, segments: [segmentFromLines(document, 0, document.lines, 0.96)] };
  }

  const table = tableSegments(document, rows);
  if (table) return table;

  const catalogCards = catalogCardSegments(document, rows);
  if (catalogCards) return catalogCards;

  const medianHeight = medianLineHeight(document);
  const rowList = rowListSegments(document, rows, medianHeight);
  if (rowList) return rowList;

  const columns = columnClusters(rows, medianHeight);
  const blocks = columns.flatMap((column) => splitColumnIntoBlocks(column, medianHeight));
  const meaningful = blocks.filter((block) => block.some((row) => row.text.length >= 2));
  if (meaningful.length <= 1) {
    return { layoutType: "single", confidence: 0.9, requiresReview: false, segments: [segmentFromLines(document, 0, document.lines, 0.9)] };
  }

  const recordBlocks = meaningful.filter(blockLooksLikeRecord);
  if (recordBlocks.length < 2) {
    return { layoutType: "single", confidence: 0.9, requiresReview: false, segments: [segmentFromLines(document, 0, document.lines, 0.9)] };
  }

  const orderedBlocks = recordBlocks.sort((a, b) => {
    const aBox = unionBox(a.flatMap((row) => row.lines));
    const bBox = unionBox(b.flatMap((row) => row.lines));
    const rowTolerance = Math.max(aBox.height, bBox.height) * 0.28;
    if (Math.abs(aBox.top - bBox.top) <= rowTolerance) return aBox.left - bBox.left;
    return aBox.top - bBox.top;
  });

  const multiColumn = columns.length >= 2 && orderedBlocks.some((block) => unionBox(block.flatMap((row) => row.lines)).left > 0.45);
  const layoutType: SampleLayoutType = multiColumn ? "grid" : "vertical-block-list";
  const baseConfidence = multiColumn ? 0.86 : 0.84;
  const segments = orderedBlocks.map((block, index) =>
    segmentFromLines(document, index, block.flatMap((row) => row.lines), baseConfidence, { profile: multiColumn ? "grid-fields" : "vertical-fields" })
  );
  const confidence = Math.min(...segments.map((segment) => segment.confidence));
  return {
    layoutType,
    confidence,
    requiresReview: confidence < 0.85,
    segments
  };
}
