import type { OCRLayoutDocument, OCRLayoutLine } from "./ocr-layout-model";
import { detectFieldAnchor } from "./recognition-field-lexicon";

export type RecognitionEvidenceRole =
  | "coffee_core"
  | "coffee_possible"
  | "layout_context"
  | "commercial_extra"
  | "irrelevant";

export interface RecognitionDictionaryHint {
  type: string;
  canonical?: string;
  candidate?: string;
  confidence?: number;
}

export interface PageStructureEvidenceBlock {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  roleHint: RecognitionEvidenceRole;
  dictionaryHints?: readonly RecognitionDictionaryHint[];
}

export interface RecognitionLayoutHints {
  layoutType?: string;
  possibleRows?: number;
  possibleColumns?: number;
  segmentCount?: number;
  anchorRefs?: readonly string[];
  groupRefs?: readonly string[];
}

export interface RecognitionEvidenceHarvest {
  fullText: string;
  blocks: readonly PageStructureEvidenceBlock[];
  auditOnly: readonly { id: string; text: string; role: "irrelevant" }[];
  layoutHints: RecognitionLayoutHints;
  multiRecordProbability: number;
  shouldUseStructureAi: boolean;
  metrics: {
    sourceBlocks: number;
    retainedBlocks: number;
    ignoredBlocks: number;
    recordAnchors: number;
    groupHeadings: number;
    repeatedFieldLabels: number;
    dictionaryHintBlocks: number;
  };
}

export interface RecognitionEvidenceHarvesterOptions {
  dictionaryHints?(text: string, evidenceRef: string): readonly RecognitionDictionaryHint[];
  layoutHints?: Omit<RecognitionLayoutHints, "anchorRefs" | "groupRefs">;
  aiThreshold?: number;
}

const IRRELEVANT = /(?:銀行|银行|帳號|账号|戶名|户名|轉帳|转账|匯款|汇款|運費|运费|滿\s*\d+.*免運|满\s*\d+.*免运|營業時間|营业时间|開放時間|开放时间|預約專線|预约专线|電話|电话|手機|手机|加入官方\s*LINE|QRCode|QR\s*code|掃碼|扫码|網購|网购|外送|取貨|取货|付款方式)/iu;
const COMMERCIAL_EXTRA = /(?:[$＄]\s*\d|售價|售价|價格|价格|\b\d+(?:\.\d+)?\s*(?:g|kg|克|公斤)\b|滴濾|滴滤|意式|奶咖|手沖|手冲|掛耳|挂耳)/iu;
const RECORD_ANCHOR = /^(?:[A-Z]|ONA[-_\s]?\d{1,3}|(?:NO\.?|#)\s*\d{1,3}|\d{1,3}[.)、])$/iu;
const GROUP_HEADING = /^(?:極?淺焙|极?浅焙|淺中焙|浅中焙|中淺焙|中浅焙|中焙|中深焙|深焙|light\s*roast|medium\s*roast|dark\s*roast)$/iu;
const FLAVOR_LABEL = /^(?:風味描述|风味描述|風味|风味|flavou?r\s*notes?|tasting\s*notes?)\s*[:：]?$/iu;
const TABLE_HEADER = /^(?:編號|编号|咖啡豆單品|咖啡豆单品|處理法|处理法|產地|产地|烘焙度|焙度|風味|风味|售價|售价)$/iu;
const COFFEE_SIGNAL = /(?:水洗|日曬|日晒|蜜處理|蜜处理|厭氧|厌氧|濕剝|湿剥|藝伎|艺伎|瑰夏|Gesha|Geisha|SL\s*\d{2}|JARC\s*\d{4,5}|\b7\d{4}\b|G1\b|AA\b|花香|柑橘|莓果|蜂蜜|巧克力|核果|海拔|altitude|process|variety|roast)/iu;

function clean(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function isRecordAnchor(text: string): boolean {
  return RECORD_ANCHOR.test(text);
}

function evidenceRole(line: OCRLayoutLine, hints: readonly RecognitionDictionaryHint[]): RecognitionEvidenceRole {
  const text = clean(line.text);
  if (IRRELEVANT.test(text)) return "irrelevant";
  if (isRecordAnchor(text) || GROUP_HEADING.test(text) || FLAVOR_LABEL.test(text) || TABLE_HEADER.test(text)) return "layout_context";
  if (detectFieldAnchor(text) || hints.length > 0 || COFFEE_SIGNAL.test(text)) return "coffee_core";
  if (COMMERCIAL_EXTRA.test(text)) return "commercial_extra";
  return "coffee_possible";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function multiRecordScore(input: {
  retained: number;
  anchors: number;
  groups: number;
  repeatedFieldLabels: number;
  hintedBlocks: number;
  layoutType?: string;
  segmentCount?: number;
}): number {
  let score = 0;
  if (input.anchors >= 2) score += 0.48;
  else if (input.anchors === 1) score += 0.08;
  if (input.repeatedFieldLabels >= 2) score += 0.26;
  if (input.groups >= 2) score += 0.2;
  if (/table|grid|multi|column|list/iu.test(input.layoutType ?? "")) score += 0.18;
  if ((input.segmentCount ?? 0) >= 2) score += 0.28;
  if (input.hintedBlocks >= 6) score += 0.1;
  if (input.retained >= 10) score += 0.08;
  return clamp01(score);
}

export function harvestRecognitionEvidence(
  document: OCRLayoutDocument,
  options: RecognitionEvidenceHarvesterOptions = {}
): RecognitionEvidenceHarvest {
  const blocks: PageStructureEvidenceBlock[] = [];
  const auditOnly: Array<{ id: string; text: string; role: "irrelevant" }> = [];
  const anchorRefs: string[] = [];
  const groupRefs: string[] = [];
  let repeatedFieldLabels = 0;
  let dictionaryHintBlocks = 0;

  for (const line of document.lines) {
    const id = clean(line.id || line.blockId);
    const text = clean(line.text);
    if (!id || !text) continue;
    const dictionaryHints = [...(options.dictionaryHints?.(text, id) ?? [])].slice(0, 8);
    if (dictionaryHints.length) dictionaryHintBlocks += 1;
    const role = evidenceRole(line, dictionaryHints);
    if (role === "irrelevant") {
      auditOnly.push({ id, text, role });
      continue;
    }
    if (isRecordAnchor(text)) anchorRefs.push(id);
    if (GROUP_HEADING.test(text)) groupRefs.push(id);
    if (FLAVOR_LABEL.test(text)) repeatedFieldLabels += 1;
    const box = line.normalizedBox;
    blocks.push({
      id,
      text,
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
      confidence: clamp01(line.confidence),
      roleHint: role,
      ...(dictionaryHints.length ? { dictionaryHints } : {})
    });
  }

  const baseHints = options.layoutHints ?? {};
  const layoutHints: RecognitionLayoutHints = {
    ...baseHints,
    ...(anchorRefs.length ? { anchorRefs } : {}),
    ...(groupRefs.length ? { groupRefs } : {})
  };
  const probability = multiRecordScore({
    retained: blocks.length,
    anchors: anchorRefs.length,
    groups: groupRefs.length,
    repeatedFieldLabels,
    hintedBlocks: dictionaryHintBlocks,
    layoutType: baseHints.layoutType,
    segmentCount: baseHints.segmentCount
  });
  const threshold = options.aiThreshold ?? 0.55;

  return {
    fullText: document.fullText,
    blocks,
    auditOnly,
    layoutHints,
    multiRecordProbability: probability,
    shouldUseStructureAi: blocks.length >= 2 && probability >= threshold,
    metrics: {
      sourceBlocks: document.lines.length,
      retainedBlocks: blocks.length,
      ignoredBlocks: auditOnly.length,
      recordAnchors: anchorRefs.length,
      groupHeadings: groupRefs.length,
      repeatedFieldLabels,
      dictionaryHintBlocks
    }
  };
}
