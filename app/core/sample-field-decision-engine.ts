import {
  cleanRecognitionText,
  detectFieldAnchor,
  splitInlineFieldPair,
  type RecognitionFieldKey
} from "./recognition-field-lexicon";
import type { OCRBox, OCRLayoutLine } from "./ocr-layout-model";
import type { SampleLayoutSegment } from "./sample-layout-segmenter";

export type RecognitionDecisionState = "accepted" | "review" | "rejected";

export interface RecognitionEvidence {
  lineId: string;
  text: string;
  relation: "inline" | "same-row" | "adjacent-row" | "weak";
  label?: string;
  confidence: number;
}

export interface RecognitionFieldCandidate {
  field: RecognitionFieldKey;
  value: string;
  normalizedValue: string;
  score: number;
  explicit: boolean;
  evidence: readonly RecognitionEvidence[];
  hardExclusions: readonly string[];
}

export interface RecognitionFieldDecision {
  field: RecognitionFieldKey;
  state: RecognitionDecisionState;
  confidence: number;
  value?: string;
  reason: string;
  winner?: RecognitionFieldCandidate;
  candidates: readonly RecognitionFieldCandidate[];
}

export interface SampleFieldDecisionResult {
  accepted: Record<string, string>;
  review: readonly RecognitionFieldDecision[];
  rejected: readonly RecognitionFieldDecision[];
  decisions: readonly RecognitionFieldDecision[];
}

const DATE_FIELDS = new Set<RecognitionFieldKey>(["roastDate", "productionDate", "packDate", "bestBefore", "expiryDate"]);
const PERSON_OR_ENTITY_FIELDS = new Set<RecognitionFieldKey>(["farm", "producer", "station", "cooperative", "roaster"]);

function comparable(value: unknown): string {
  return cleanRecognitionText(value)
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•,，;；:：/_-]+/g, "");
}

function overlapRatio(a1: number, a2: number, b1: number, b2: number): number {
  const overlap = Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  return overlap / Math.max(0.0001, Math.min(a2 - a1, b2 - b1));
}

function sameRow(a: OCRBox, b: OCRBox): boolean {
  return overlapRatio(a.top, a.bottom, b.top, b.bottom) >= 0.42 ||
    Math.abs(a.centerY - b.centerY) <= Math.max(a.height, b.height) * 0.62;
}

function sameColumn(a: OCRBox, b: OCRBox): boolean {
  return overlapRatio(a.left, a.right, b.left, b.right) >= 0.34 ||
    Math.abs(a.centerX - b.centerX) <= Math.max(a.width, b.width) * 0.55;
}

function normalizedDate(value: string): string | undefined {
  const text = value.normalize("NFKC").replace(/[OoＯ]/g, "0");
  const yearFirst = text.match(/\b(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?\b/);
  if (yearFirst) {
    const month = Number(yearFirst[2]);
    const day = Number(yearFirst[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${yearFirst[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const compact = text.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (compact) {
    const month = Number(compact[2]);
    const day = Number(compact[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  return undefined;
}

function normalizeAltitude(value: string): string | undefined {
  const text = value.normalize("NFKC");
  const range = text.match(/\b(\d{3,4})\s*(?:[-–—~至到])\s*(\d{3,4})\s*(?:m|米|masl|m\.a\.s\.l\.)?\b/i);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (low >= 100 && high <= 6000 && low <= high) return `${low}–${high} m`;
  }
  const single = text.match(/\b(\d{3,4})\s*(?:m|米|masl|m\.a\.s\.l\.)\b/i);
  if (single) {
    const altitude = Number(single[1]);
    if (altitude >= 100 && altitude <= 6000) return `${altitude} m`;
  }
  return undefined;
}

function normalizeRoastColor(value: string): string | undefined {
  const match = value.match(/(?:agtron\s*)?(\d{2,3})/i);
  if (!match) return undefined;
  const number = Number(match[1]);
  return number >= 20 && number <= 150 ? `Agtron ${number}` : undefined;
}

function normalizedFieldValue(field: RecognitionFieldKey, value: string): string | undefined {
  const clean = cleanRecognitionText(value).replace(/^[：:=|｜\-–—]+|[：:=|｜]+$/g, "").trim();
  if (!clean) return undefined;
  if (DATE_FIELDS.has(field)) return normalizedDate(clean);
  if (field === "altitude") return normalizeAltitude(clean);
  if (field === "roastColor") return normalizeRoastColor(clean);
  if (field === "weight") {
    const match = clean.match(/\b(\d{1,5}(?:\.\d+)?)\s*(g|kg|克|千克|公斤)\b/i);
    return match ? `${match[1]} ${match[2]}` : undefined;
  }
  if (field === "harvest") {
    const match = clean.match(/\b(20\d{2})(?:\s*[-/–—]\s*(\d{2,4}))?\b/);
    if (!match) return clean.length <= 32 ? clean : undefined;
    const end = match[2] ? (match[2].length === 2 ? `20${match[2]}` : match[2]) : undefined;
    return end ? `${match[1]}–${end}` : match[1];
  }
  if (field === "flavor" || field === "aroma") return clean.length <= 240 ? clean : undefined;
  if (PERSON_OR_ENTITY_FIELDS.has(field)) return clean.length >= 2 && clean.length <= 100 ? clean : undefined;
  return clean.length <= 120 ? clean : undefined;
}

function hardExclusions(field: RecognitionFieldKey, value: string): string[] {
  const exclusions: string[] = [];
  const text = cleanRecognitionText(value);
  if (!text) return ["empty"];
  if (DATE_FIELDS.has(field) && !normalizedDate(text)) exclusions.push("invalid-date-shape");
  if (field === "altitude" && !normalizeAltitude(text)) exclusions.push("invalid-altitude-or-unit");
  if (field === "roastColor" && !normalizeRoastColor(text)) exclusions.push("invalid-agtron-range");
  if (field === "weight" && !/\b\d+(?:\.\d+)?\s*(?:g|kg|克|千克|公斤)\b/i.test(text)) exclusions.push("weight-unit-missing");
  if (["country", "origin", "region", "farm", "producer", "station", "cooperative", "variety", "species", "process", "roaster"].includes(field)) {
    if (/^(?:\d+(?:\.\d+)?\s*(?:g|kg|m|米|masl)?|[$¥￥]\s*\d+)/i.test(text)) exclusions.push("numeric-value-in-text-field");
  }
  if (field !== "weight" && /^(?:net\s*(?:weight|wt)|净重|净含量)/i.test(text)) exclusions.push("weight-label-leak");
  if (!DATE_FIELDS.has(field) && /^(?:20\d{2})[-/.]\d{1,2}[-/.]\d{1,2}$/.test(text)) exclusions.push("date-value-in-non-date-field");
  return exclusions;
}

function relationScore(anchor: OCRLayoutLine, candidate: OCRLayoutLine): { score: number; relation: RecognitionEvidence["relation"] } | undefined {
  if (anchor.id === candidate.id) return undefined;
  if (detectFieldAnchor(candidate.text) || splitInlineFieldPair(candidate.text)) return undefined;
  const row = sameRow(anchor.normalizedBox, candidate.normalizedBox);
  const column = sameColumn(anchor.normalizedBox, candidate.normalizedBox);
  if (!row && !column) return undefined;
  const dx = Math.max(0, Math.max(anchor.normalizedBox.left, candidate.normalizedBox.left) - Math.min(anchor.normalizedBox.right, candidate.normalizedBox.right));
  const dy = Math.max(0, Math.max(anchor.normalizedBox.top, candidate.normalizedBox.top) - Math.min(anchor.normalizedBox.bottom, candidate.normalizedBox.bottom));
  const scale = Math.max(0.008, anchor.normalizedBox.height, candidate.normalizedBox.height);
  const distance = Math.hypot(dx, dy) / scale;
  if (row && distance > 18) return undefined;
  if (!row && column && distance > 5.5) return undefined;
  let score = row ? 0.79 : 0.71;
  score -= Math.min(0.24, distance * 0.025);
  score += candidate.confidence * 0.08;
  return { score: Math.max(0, Math.min(1, score)), relation: row ? "same-row" : "adjacent-row" };
}

function mergeCandidates(candidates: RecognitionFieldCandidate[]): RecognitionFieldCandidate[] {
  const groups = new Map<string, RecognitionFieldCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.field}:${candidate.normalizedValue}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, candidate);
      continue;
    }
    groups.set(key, {
      ...current,
      score: Math.max(current.score, candidate.score) + Math.min(0.08, candidate.evidence.length * 0.02),
      explicit: current.explicit || candidate.explicit,
      evidence: [...current.evidence, ...candidate.evidence],
      hardExclusions: [...new Set([...current.hardExclusions, ...candidate.hardExclusions])]
    });
  }
  return [...groups.values()].sort((a, b) => b.score - a.score || b.evidence.length - a.evidence.length);
}

function buildCandidates(segment: SampleLayoutSegment): RecognitionFieldCandidate[] {
  const candidates: RecognitionFieldCandidate[] = [];
  for (const line of segment.lines) {
    const inline = splitInlineFieldPair(line.text);
    if (inline) {
      const normalized = normalizedFieldValue(inline.field, inline.value);
      const exclusions = hardExclusions(inline.field, inline.value);
      if (normalized) candidates.push({
        field: inline.field,
        value: inline.value,
        normalizedValue: normalized,
        score: Math.min(1, 0.87 + inline.confidence * 0.08 + line.confidence * 0.05),
        explicit: true,
        evidence: [{ lineId: line.id, text: line.text, relation: "inline", label: inline.label, confidence: line.confidence }],
        hardExclusions: exclusions
      });
    }

    const anchor = detectFieldAnchor(line.text);
    if (!anchor) continue;
    const spatial = segment.lines.flatMap((candidate) => {
      const relation = relationScore(line, candidate);
      if (!relation) return [];
      const normalized = normalizedFieldValue(anchor.field, candidate.text);
      if (!normalized) return [];
      const exclusions = hardExclusions(anchor.field, candidate.text);
      return [{
        field: anchor.field,
        value: candidate.text,
        normalizedValue: normalized,
        score: Math.min(1, relation.score * 0.82 + anchor.confidence * 0.1 + candidate.confidence * 0.08),
        explicit: true,
        evidence: [{ lineId: candidate.id, text: candidate.text, relation: relation.relation, label: line.text, confidence: candidate.confidence }],
        hardExclusions: exclusions
      } satisfies RecognitionFieldCandidate];
    });
    candidates.push(...spatial);
  }
  return mergeCandidates(candidates);
}

function decideField(field: RecognitionFieldKey, candidates: readonly RecognitionFieldCandidate[]): RecognitionFieldDecision {
  const ranked = candidates.filter((candidate) => candidate.field === field).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { field, state: "rejected", confidence: 0, reason: "no-candidate", candidates: [] };
  const winner = ranked[0];
  const runner = ranked[1];
  const hardConflict = winner.hardExclusions.length > 0;
  const competing = Boolean(runner && runner.normalizedValue !== winner.normalizedValue && runner.score >= 0.65 && Math.abs(winner.score - runner.score) < 0.12);
  if (hardConflict) {
    return { field, state: "rejected", confidence: winner.score, reason: `hard-exclusion:${winner.hardExclusions.join(",")}`, winner, candidates: ranked };
  }
  if (winner.score >= 0.88 && winner.explicit && !competing) {
    return { field, state: "accepted", confidence: winner.score, value: winner.normalizedValue, reason: "explicit-high-confidence", winner, candidates: ranked };
  }
  if (winner.score >= 0.65) {
    return { field, state: "review", confidence: winner.score, value: winner.normalizedValue, reason: competing ? "competing-candidates" : "medium-confidence", winner, candidates: ranked };
  }
  return { field, state: "rejected", confidence: winner.score, reason: "below-review-threshold", winner, candidates: ranked };
}

export function decideSampleFields(segment: SampleLayoutSegment): SampleFieldDecisionResult {
  const candidates = buildCandidates(segment);
  const fields = [...new Set(candidates.map((candidate) => candidate.field))];
  const decisions = fields.map((field) => decideField(field, candidates));
  const accepted: Record<string, string> = {};
  for (const decision of decisions) {
    if (decision.state === "accepted" && decision.value) accepted[decision.field] = decision.value;
  }
  return {
    accepted,
    review: decisions.filter((decision) => decision.state === "review"),
    rejected: decisions.filter((decision) => decision.state === "rejected"),
    decisions
  };
}

export function recognitionCandidatePriorityDescription(): string {
  return "explicit-label > geometry > OCR-confidence > candidate-agreement > weak-inference";
}

export function fieldCandidateKey(candidate: RecognitionFieldCandidate): string {
  return `${candidate.field}:${comparable(candidate.normalizedValue)}`;
}
