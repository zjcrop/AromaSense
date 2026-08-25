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
  const headerIndex = rows.findIndex((row, index) => index < 3 && (row.fieldAnchors.size >= 2 || fieldAliasCount(row.text) >= 2));
  if (headerIndex < 0 || rows.length - headerIndex < 3) return undefined;
  const body = rows.slice(headerIndex + 1).filter((row) => row.text.trim());
  if (body.length < 2) return undefined;
  const similarRows = body.filter((row) => row.box.width >= 0.28 || row.lines.length >= 2).length;
  if (similarRows / body.length < 0.65) return undefined;
  const segments = body.map((row, index) => segmentFromLines(document, index, row.lines, 0.9));
  return { layoutType: "table", confidence: 0.9, requiresReview: false, segments };
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
    const currentStartsRecord = current.fieldAnchors.has("country") || current.fieldAnchors.has("origin") || current.fieldAnchors.has("region") || current.fieldAnchors.has("farm");
    const previousBlock = blocks[blocks.length - 1];
    const previousFieldCount = new Set(previousBlock.flatMap((row) => [...row.fieldAnchors])).size;
    const visualBreak = gapRatio >= 1.45;
    const semanticBreak = repeatedAnchor && previousFieldCount >= 2;
    const anchorRestart = currentStartsRecord && previousFieldCount >= 3 && gapRatio >= 0.45;
    if (visualBreak || semanticBreak || anchorRestart) {
      blocks.push([current]);
      seenFields = new Set(current.fieldAnchors);
    } else {
      blocks[blocks.length - 1].push(current);
      current.fieldAnchors.forEach((field) => seenFields.add(field));
    }
  }
  return blocks;
}

function rowListSegments(document: OCRLayoutDocument, rows: readonly OCRRow[], medianHeight: number): SampleLayoutResult | undefined {
  if (rows.length < 2) return undefined;
  const dense = rows.filter((row) => {
    const tokenCount = row.text.split(/[\s|,，、/]+/).filter(Boolean).length;
    return tokenCount >= 3 && row.box.width >= 0.45;
  });
  if (dense.length / rows.length < 0.72) return undefined;
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

  const medianHeight = medianLineHeight(document);
  const rowList = rowListSegments(document, rows, medianHeight);
  if (rowList) return rowList;

  const columns = columnClusters(rows, medianHeight);
  const blocks = columns.flatMap((column) => splitColumnIntoBlocks(column, medianHeight));
  const meaningful = blocks.filter((block) => block.some((row) => row.text.length >= 2));
  if (meaningful.length <= 1) {
    return { layoutType: "single", confidence: 0.9, requiresReview: false, segments: [segmentFromLines(document, 0, document.lines, 0.9)] };
  }

  const orderedBlocks = meaningful.sort((a, b) => {
    const aBox = unionBox(a.flatMap((row) => row.lines));
    const bBox = unionBox(b.flatMap((row) => row.lines));
    const rowTolerance = Math.max(aBox.height, bBox.height) * 0.28;
    if (Math.abs(aBox.top - bBox.top) <= rowTolerance) return aBox.left - bBox.left;
    return aBox.top - bBox.top;
  });

  const multiColumn = columns.length >= 2 && columns.filter((column) => column.length >= 2).length >= 2;
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
