import { cleanRecognitionText } from "./recognition-field-lexicon";

export interface OCRPoint {
  x: number;
  y: number;
}

export interface OCRBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface OCRLineInput {
  id?: string;
  blockId?: string;
  text?: string;
  confidence?: number;
  polygon?: readonly (readonly [number, number] | OCRPoint)[];
  box?: Partial<OCRBox> & { x?: number; y?: number };
}

export interface OCRLayoutLine {
  id: string;
  blockId: string;
  text: string;
  confidence: number;
  polygon: readonly OCRPoint[];
  box: OCRBox;
  normalizedBox: OCRBox;
}

export interface OCRLayoutDocument {
  schemaVersion: "aromasense-ocr-layout/1.0";
  imageId: string;
  sourceWidth: number;
  sourceHeight: number;
  lines: readonly OCRLayoutLine[];
  fullText: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function boundedConfidence(value: unknown, fallback = 0.75): number {
  const number = Number(value);
  return Number.isFinite(number) ? clamp01(number) : fallback;
}

function isCoordinateTuple(value: readonly [number, number] | OCRPoint): value is readonly [number, number] {
  return Array.isArray(value);
}

function point(value: readonly [number, number] | OCRPoint): OCRPoint | undefined {
  const x = isCoordinateTuple(value) ? Number(value[0]) : Number(value.x);
  const y = isCoordinateTuple(value) ? Number(value[1]) : Number(value.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function polygonFromInput(input: OCRLineInput): OCRPoint[] {
  const direct = (input.polygon ?? []).map(point).filter((value): value is OCRPoint => Boolean(value));
  if (direct.length >= 2) return direct;
  const box = input.box;
  if (!box) return [];
  const left = Number(box.left ?? box.x);
  const top = Number(box.top ?? box.y);
  const width = Number(box.width ?? (Number(box.right) - left));
  const height = Number(box.height ?? (Number(box.bottom) - top));
  if (![left, top, width, height].every(Number.isFinite)) return [];
  return [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height }
  ];
}

export function boxFromPolygon(polygon: readonly OCRPoint[]): OCRBox | undefined {
  if (polygon.length < 2) return undefined;
  const xs = polygon.map((value) => value.x).filter(Number.isFinite);
  const ys = polygon.map((value) => value.y).filter(Number.isFinite);
  if (!xs.length || !ys.length) return undefined;
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function normalizedBox(box: OCRBox, width: number, height: number): OCRBox {
  const left = clamp01(box.left / width);
  const right = clamp01(box.right / width);
  const top = clamp01(box.top / height);
  const bottom = clamp01(box.bottom / height);
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

function readingOrder(a: OCRLayoutLine, b: OCRLayoutLine): number {
  const rowTolerance = Math.max(a.normalizedBox.height, b.normalizedBox.height) * 0.55;
  if (Math.abs(a.normalizedBox.centerY - b.normalizedBox.centerY) <= rowTolerance) {
    return a.normalizedBox.left - b.normalizedBox.left;
  }
  return a.normalizedBox.top - b.normalizedBox.top;
}

/**
 * Converts provider-specific OCR geometry into one normalized representation.
 * If the provider cannot report image dimensions, text extents are used only as
 * a fallback coordinate frame so the layout pipeline can still operate.
 */
export function buildOCRLayoutDocument(input: {
  imageId: string;
  lines: readonly OCRLineInput[];
  sourceWidth?: number;
  sourceHeight?: number;
  fallbackText?: string;
}): OCRLayoutDocument {
  const preliminary = input.lines.flatMap((line, index) => {
    const text = cleanRecognitionText(line.text);
    const polygon = polygonFromInput(line);
    const box = boxFromPolygon(polygon);
    if (!text || !box) return [];
    return [{
      id: line.id ?? `${input.imageId}-line-${index + 1}`,
      blockId: line.blockId ?? `${input.imageId}-block-${index + 1}`,
      text,
      confidence: boundedConfidence(line.confidence),
      polygon,
      box
    }];
  });

  const maxRight = Math.max(1, ...preliminary.map((line) => line.box.right));
  const maxBottom = Math.max(1, ...preliminary.map((line) => line.box.bottom));
  const sourceWidth = Math.max(1, Number(input.sourceWidth) || maxRight);
  const sourceHeight = Math.max(1, Number(input.sourceHeight) || maxBottom);

  let lines: OCRLayoutLine[] = preliminary.map((line) => ({
    ...line,
    normalizedBox: normalizedBox(line.box, sourceWidth, sourceHeight)
  }));

  if (!lines.length && cleanRecognitionText(input.fallbackText)) {
    const textLines = String(input.fallbackText)
      .split(/\n+/)
      .map(cleanRecognitionText)
      .filter(Boolean);
    lines = textLines.map((text, index) => {
      const top = index / Math.max(1, textLines.length);
      const bottom = (index + 0.78) / Math.max(1, textLines.length);
      const normalized: OCRBox = {
        left: 0,
        top,
        right: 1,
        bottom,
        width: 1,
        height: Math.max(0.0001, bottom - top),
        centerX: 0.5,
        centerY: (top + bottom) / 2
      };
      return {
        id: `${input.imageId}-synthetic-${index + 1}`,
        blockId: `${input.imageId}-synthetic-block-${index + 1}`,
        text,
        confidence: 0.55,
        polygon: [],
        box: { ...normalized },
        normalizedBox: normalized
      };
    });
  }

  lines.sort(readingOrder);
  return {
    schemaVersion: "aromasense-ocr-layout/1.0",
    imageId: input.imageId,
    sourceWidth,
    sourceHeight,
    lines,
    fullText: lines.map((line) => line.text).join("\n") || cleanRecognitionText(input.fallbackText)
  };
}

export function medianLineHeight(document: OCRLayoutDocument): number {
  const heights = document.lines.map((line) => line.normalizedBox.height).filter((value) => value > 0).sort((a, b) => a - b);
  if (!heights.length) return 0.04;
  const middle = Math.floor(heights.length / 2);
  return heights.length % 2 ? heights[middle] : (heights[middle - 1] + heights[middle]) / 2;
}