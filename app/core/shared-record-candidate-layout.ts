import { requireLuckyBeanRecognitionCore, type LuckyBeanRecognitionDocument } from "./luckybean-upstream-adapter";
import type { OCRBox, OCRLayoutDocument, OCRLayoutLine } from "./ocr-layout-model";
import type { SampleLayoutResult, SampleLayoutSegment, SampleLayoutType } from "./sample-layout-segmenter";

export interface SharedRecordCandidate {
  schemaVersion?: string;
  id?: string;
  index?: number;
  method?: string;
  confidence?: number;
  requiresUserConfirmation?: boolean;
  imageIds?: readonly string[];
  blockIds?: readonly string[];
  box?: Record<string, number> | null;
  text?: string;
  evidence?: Record<string, unknown> | null;
}

interface SharedRecordCandidateResult {
  grouped?: boolean;
  method?: string;
  candidates?: readonly SharedRecordCandidate[];
  schemaVersion?: string;
}

type RecordCandidateCore = ReturnType<typeof requireLuckyBeanRecognitionCore> & {
  RECOGNITION_RECORD_CANDIDATE_SCHEMA?: string;
  groupRecognitionRecordCandidates?(document: LuckyBeanRecognitionDocument): SharedRecordCandidateResult;
};

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

function layoutType(method: string): SampleLayoutType {
  if (method === "geometry-side-by-side-v1") return "grid";
  if (method === "geometry-process-rows-v1") return "row-list";
  if (method === "geometry-vertical-gap-v1") return "vertical-block-list";
  return "mixed";
}

function upstreamDocument(document: OCRLayoutDocument, core: RecordCandidateCore): LuckyBeanRecognitionDocument {
  return core.createRecognitionDocument({
    images: [{ id: document.imageId, role: "front", roleLabel: "样品图片" }],
    blocks: document.lines.map((line, index) => ({
      id: line.id,
      imageId: document.imageId,
      imageRole: "front",
      order: index,
      text: line.text,
      confidence: line.confidence,
      polygon: line.polygon.length
        ? line.polygon
        : [
            { x: line.box.left, y: line.box.top },
            { x: line.box.right, y: line.box.top },
            { x: line.box.right, y: line.box.bottom },
            { x: line.box.left, y: line.box.bottom }
          ]
    })),
    engine: "aromasense-layout-segmentation",
    fullText: document.fullText
  });
}

/**
 * Adapter only: LuckyBean owns generic record-boundary detection; AromaSense owns
 * product-specific table/catalog hints. A shared candidate is accepted only when
 * every block id maps back to the current OCR layout and no line is assigned to
 * more than one record.
 */
export function sharedRecordCandidateLayout(document: OCRLayoutDocument): SampleLayoutResult | undefined {
  const core = requireLuckyBeanRecognitionCore() as RecordCandidateCore;
  if (
    core.RECOGNITION_RECORD_CANDIDATE_SCHEMA !== "recognition-record-candidate/1.0" ||
    typeof core.groupRecognitionRecordCandidates !== "function"
  ) return undefined;

  const grouped = core.groupRecognitionRecordCandidates(upstreamDocument(document, core));
  const candidates = Array.isArray(grouped?.candidates) ? grouped.candidates : [];
  if (grouped?.grouped !== true || candidates.length < 2 || grouped.schemaVersion !== core.RECOGNITION_RECORD_CANDIDATE_SCHEMA) {
    return undefined;
  }

  const lineById = new Map(document.lines.map((line) => [line.id, line]));
  const claimed = new Set<string>();
  const segments: SampleLayoutSegment[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const blockIds = [...new Set((candidate.blockIds ?? []).map(String).filter(Boolean))];
    if (!blockIds.length || blockIds.some((id) => claimed.has(id))) return undefined;
    const lines = blockIds.map((id) => lineById.get(id)).filter((line): line is OCRLayoutLine => Boolean(line));
    if (lines.length !== blockIds.length) return undefined;
    blockIds.forEach((id) => claimed.add(id));
    const method = String(candidate.method ?? grouped.method ?? "shared-record-candidate");
    const confidence = Math.max(0, Math.min(1, Number(candidate.confidence ?? 0.7)));
    segments.push({
      id: String(candidate.id || `${document.imageId}-shared-record-${index + 1}`),
      index,
      confidence,
      box: unionBox(lines),
      lines,
      text: lines.map((line) => line.text).join("\n"),
      hints: { profile: `shared:${method}` }
    });
  }

  const confidence = Math.min(...segments.map((segment) => segment.confidence));
  return {
    layoutType: layoutType(String(grouped.method ?? candidates[0]?.method ?? "")),
    confidence,
    requiresReview: true,
    segments
  };
}
