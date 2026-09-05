import type { OCRBox, OCRLayoutDocument, OCRLayoutLine } from "./ocr-layout-model";
import type { SampleLayoutResult, SampleLayoutSegment } from "./sample-layout-segmenter";

interface OCRRow {
  lines: OCRLayoutLine[];
  box: OCRBox;
  text: string;
}

const PROCESS_SIGNAL = /(?:水洗|日晒|日曬|厌氧|厭氧|蜜处理|蜜處理|湿刨|濕刨|酵素|發酵|发酵|washed|natural|anaerobic|honey\s*process|wet\s*hulled|semi[-\s]?washed|carbonic|ナチュラル|ウォッシュド|ハニー|嫌気|워시드|내추럴|허니|무산소)/iu;
const COFFEE_IDENTITY_SIGNAL = /(?:ethiopia|kenya|colombia|brazil|panama|guatemala|honduras|costa\s*rica|el\s*salvador|rwanda|burundi|indonesia|yirgacheffe|guji|sidamo|nyeri|huila|gesha|geisha|sl\s*28|sl\s*34|caturra|bourbon|typica|衣索比亞|埃塞俄比亚|埃塞俄比亞|肯亞|肯尼亚|哥倫比亞|哥伦比亚|巴西|巴拿馬|巴拿马|瓜地馬拉|危地马拉|宏都拉斯|洪都拉斯|哥斯大黎加|薩爾瓦多|萨尔瓦多|盧安達|卢旺达|蒲隆地|布隆迪|印尼|耶加雪菲|古吉|瑰夏|藝伎|艺伎|波旁|卡杜拉|鐵皮卡|铁皮卡)/iu;

function unionBox(lines: readonly OCRLayoutLine[]): OCRBox {
  const boxes = lines.map((line) => line.normalizedBox);
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    left,
    top,
    right,
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

function rows(document: OCRLayoutDocument): OCRRow[] {
  const result: OCRRow[] = [];
  const ordered = [...document.lines].sort((a, b) => a.normalizedBox.top - b.normalizedBox.top || a.normalizedBox.left - b.normalizedBox.left);
  for (const line of ordered) {
    const match = result.find((row) =>
      verticalOverlap(row.box, line.normalizedBox) >= 0.45 ||
      Math.abs(row.box.centerY - line.normalizedBox.centerY) <= Math.max(row.box.height, line.normalizedBox.height) * 0.55
    );
    if (!match) {
      result.push({ lines: [line], box: line.normalizedBox, text: line.text.trim() });
      continue;
    }
    match.lines.push(line);
    match.lines.sort((a, b) => a.normalizedBox.left - b.normalizedBox.left);
    match.box = unionBox(match.lines);
    match.text = match.lines.map((item) => item.text).join(" | ").trim();
  }
  return result.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
}

function median(values: readonly number[], fallback: number): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return fallback;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function segment(document: OCRLayoutDocument, index: number, group: readonly OCRRow[], confidence: number, profile: string): SampleLayoutSegment {
  const lines = group.flatMap((row) => row.lines);
  return {
    id: `${document.imageId}-refined-${index + 1}`,
    index,
    confidence,
    box: unionBox(lines),
    lines,
    text: lines.map((line) => line.text).join("\n"),
    hints: { profile }
  };
}

function result(document: OCRLayoutDocument, groups: readonly OCRRow[][], layoutType: "row-list" | "vertical-block-list", confidence: number, profile: string): SampleLayoutResult {
  const segments = groups.map((group, index) => segment(document, index, group, confidence, profile));
  return { layoutType, confidence, requiresReview: true, segments };
}

function hasCoffeeEvidence(text: string): boolean {
  return PROCESS_SIGNAL.test(text) && (COFFEE_IDENTITY_SIGNAL.test(text) || text.replace(/\s+/g, "").length >= 8);
}

function processRowsFallback(document: OCRLayoutDocument, source: readonly OCRRow[]): SampleLayoutResult | undefined {
  const meaningful = source.filter((row) => row.text.replace(/\s+/g, "").length >= 6);
  const records = meaningful.filter((row) => hasCoffeeEvidence(row.text));
  if (records.length < 2) return undefined;
  if (records.length / meaningful.length < 0.72) return undefined;
  return result(document, records.map((row) => [row]), "row-list", 0.8, "semantic-process-row-v1");
}

function strongGapFallback(document: OCRLayoutDocument, source: readonly OCRRow[]): SampleLayoutResult | undefined {
  if (source.length < 4) return undefined;
  const rowHeight = median(source.map((row) => row.box.height), 0.04);
  const threshold = Math.max(0.055, rowHeight * 1.7);
  const groups: OCRRow[][] = [[source[0]!]];
  for (let index = 1; index < source.length; index += 1) {
    const current = source[index]!;
    const previous = source[index - 1]!;
    const gap = Math.max(0, current.box.top - previous.box.bottom);
    if (gap >= threshold) groups.push([current]);
    else groups[groups.length - 1]!.push(current);
  }
  const meaningful = groups.filter((group) => {
    const text = group.map((row) => row.text).join(" ");
    return group.length >= 2 && hasCoffeeEvidence(text);
  });
  if (meaningful.length < 2) return undefined;
  const covered = meaningful.reduce((sum, group) => sum + group.length, 0) / source.length;
  if (covered < 0.7) return undefined;
  return result(document, meaningful, "vertical-block-list", 0.78, "semantic-strong-gap-v1");
}

function processCycleFallback(document: OCRLayoutDocument, source: readonly OCRRow[]): SampleLayoutResult | undefined {
  const processIndexes = source.flatMap((row, index) => PROCESS_SIGNAL.test(row.text) ? [index] : []);
  if (processIndexes.length < 2) return undefined;

  const starts = [0];
  for (let index = 1; index < processIndexes.length; index += 1) {
    starts.push(Math.floor((processIndexes[index - 1]! + processIndexes[index]!) / 2) + 1);
  }
  const groups = starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
  if (groups.length < 2 || groups.some((group) => !group.length)) return undefined;
  if (groups.some((group) => !hasCoffeeEvidence(group.map((row) => row.text).join(" ")))) return undefined;
  return result(document, groups, "vertical-block-list", 0.74, "semantic-process-cycle-v1");
}

/**
 * Secondary, deliberately conservative refinement for OCR pages that the primary
 * geometry segmenter called a single sample. It exists to prevent a dangerous
 * failure mode: several clearly separate coffee records being silently collapsed
 * into one setup row merely because the label did not contain explicit field
 * names such as “产地/品种/处理法”.
 *
 * Every fallback remains review-required. The primary high-confidence table,
 * catalog and explicit-field segmenters always win.
 */
export function refineAmbiguousSingleSampleLayout(
  document: OCRLayoutDocument,
  primary: SampleLayoutResult
): SampleLayoutResult {
  if (primary.segments.length !== 1 || document.lines.length < 2) return primary;
  const source = rows(document).filter((row) => row.text.trim());
  if (source.length < 2) return primary;

  const rowList = processRowsFallback(document, source);
  if (rowList) return rowList;

  const strongGap = strongGapFallback(document, source);
  if (strongGap) return strongGap;

  const cycles = processCycleFallback(document, source);
  if (cycles) return cycles;

  const repeatedProcesses = source.filter((row) => PROCESS_SIGNAL.test(row.text)).length;
  if (repeatedProcesses >= 2) {
    return {
      ...primary,
      confidence: Math.min(primary.confidence, 0.62),
      requiresReview: true,
      segments: primary.segments.map((item) => ({ ...item, confidence: Math.min(item.confidence, 0.62) }))
    };
  }
  return primary;
}
