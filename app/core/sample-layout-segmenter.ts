import { detectFieldAnchor, fieldAliasCount, splitInlineFieldPair } from "./recognition-field-lexicon";
import { medianLineHeight, type OCRBox, type OCRLayoutDocument, type OCRLayoutLine } from "./ocr-layout-model";

export type SampleLayoutType = "single" | "row-list" | "vertical-block-list" | "grid" | "table" | "mixed";

export interface SampleLayoutSegment {
  id: string;
  index: number;
  confidence: number;
  box: OCRBox;
  lines: readonly OCRLayoutLine[];
  text: string;
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

const IDENTITY_FIELDS = new Set(["country", "origin", "region", "farm", "producer", "station", "cooperative"]);
const PROCESS_SIGNAL = /(?:水洗|日晒|日曬|厌氧|厭氧|蜜处理|蜜處理|蜜處理|湿刨|濕刨|酵素|發酵|发酵|washed|natural|anaerobic|honey\s*process|wet\s*hulled|semi[-\s]?washed|carbonic|ナチュラル|ウォッシュド|ハニー|嫌気|워시드|내추럴|허니|무산소)/iu;
const GRADE_SIGNAL = /(?:^|[\s·|｜,，、-])(?:G\s*[1-4]|AA\+?|AAA|AB|PB|SHB|SHG|EP|TOP)(?:$|[\s·|｜,，、-])/iu;
const ROAST_SECTION_SIGNAL = /^(?:(?:淺中|浅中|中淺|中浅|淺|浅|中|中深|深|極深|极深)(?:度)?(?:焙|培|烘焙)?|(?:light|medium\s*light|medium|medium\s*dark|dark)\s*roast|(?:浅煎り|中浅煎り|中煎り|中深煎り|深煎り)|(?:약배전|중약배전|중배전|중강배전|강배전))$/iu;

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

function segmentFromLines(document: OCRLayoutDocument, index: number, lines: readonly OCRLayoutLine[], confidence: number): SampleLayoutSegment {
  return {
    id: `${document.imageId}-sample-${index + 1}`,
    index,
    confidence: Math.max(0, Math.min(1, confidence)),
    box: unionBox(lines),
    lines,
    text: lines.map((line) => line.text).join("\n")
  };
}

function tableSegments(document: OCRLayoutDocument, rows: readonly OCRRow[]): SampleLayoutResult | undefined {
  const headerIndex = rows.findIndex((row, index) => index < 3 && row.lines.length >= 2 && (row.fieldAnchors.size >= 2 || fieldAliasCount(row.text) >= 2));
  if (headerIndex < 0 || rows.length - headerIndex < 3) return undefined;
  const header = rows[headerIndex];
  const body = rows.slice(headerIndex + 1).filter((row) => row.text.trim());
  if (body.length < 2) return undefined;

  // A real table has multiple OCR cells on most body rows. A normal coffee bag often
  // has a wide heading followed by unrelated single text lines; the previous rule
  // incorrectly treated those lines as separate samples.
  const minimumCells = Math.max(2, Math.min(3, header.lines.length - 1));
  const tabularRows = body.filter((row) => row.lines.length >= minimumCells && row.box.width >= 0.28).length;
  if (tabularRows / body.length < 0.75) return undefined;

  const segments = body.map((row, index) => segmentFromLines(document, index, row.lines, 0.9));
  return { layoutType: "table", confidence: 0.9, requiresReview: false, segments };
}

function compactText(value: string): string {
  return value.normalize("NFKC").replace(/[\s【】\[\]<>《》「」『』()（）:：|｜·•・]/g, "").trim();
}

function isRoastSectionHeader(row: OCRRow): boolean {
  const text = compactText(row.text);
  return text.length >= 2 && text.length <= 18 && ROAST_SECTION_SIGNAL.test(text);
}

function isFlavorDetailRow(row: OCRRow): boolean {
  return row.fieldAnchors.has("flavor");
}

function titleLooksCoffeeLike(rows: readonly OCRRow[]): boolean {
  const text = rows.map((row) => row.text).join(" ");
  return PROCESS_SIGNAL.test(text) || GRADE_SIGNAL.test(text);
}

function catalogCardSegments(document: OCRLayoutDocument, rows: readonly OCRRow[]): SampleLayoutResult | undefined {
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
      const titleRows = pending
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

  // Repeated "title + flavor description" cards are a common coffee-menu/list
  // layout. They intentionally omit labels such as "产地:" or "处理法:", so the
  // generic field-anchor block splitter cannot see record boundaries. Three or
  // more repeated cards are strong structural evidence on their own; for only two
  // cards we additionally require coffee/process/grade signals and alignment to
  // avoid splitting a normal bag that happens to mention flavor twice.
  const strongRepeatedStructure = structuredCards.length >= 3 && aligned;
  const strongTwoCardStructure = structuredCards.length === 2 && aligned && processRatio >= 0.5;
  if (!strongRepeatedStructure && !strongTwoCardStructure) return undefined;
  if (structuredCards.length >= 3 && processRatio < 0.34 && !structuredCards.some((card) => card.section)) return undefined;

  const confidence = processRatio >= 0.6 && aligned ? 0.92 : 0.86;
  const segments = structuredCards.map((card, index) => {
    const lines = [
      ...(card.section ? card.section.lines : []),
      ...card.titleRows.flatMap((row) => row.lines),
      ...card.detail.lines
    ];
    return segmentFromLines(document, index, lines, confidence);
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

    // Whitespace alone is not enough to declare a new sample. Coffee packaging often
    // separates origin, roast and tasting-note sections with large visual gaps.
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
  const segments = rows.map((row, index) => segmentFromLines(document, index, row.lines, 0.82));
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

  // Only auto-split when at least two blocks independently look like complete coffee
  // records. A two-column label/value design must remain one sample.
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
    segmentFromLines(document, index, block.flatMap((row) => row.lines), baseConfidence)
  );
  const confidence = Math.min(...segments.map((segment) => segment.confidence));
  return {
    layoutType,
    confidence,
    requiresReview: confidence < 0.85,
    segments
  };
}
