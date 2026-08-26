import { DEFAULT_SEMI_BLIND_VISIBLE_FIELDS, normalizeBlindMode, type BlindMode } from "./session-metadata";

export interface BlindIdentificationObservation {
  fieldKey: string;
  value: unknown;
}

export interface BlindIdentificationFieldSpec {
  key: string;
  label: string;
  sourceKeys: readonly string[];
}

export interface BlindIdentificationItem {
  key: string;
  label: string;
  truth?: string;
  guess?: string;
  correct?: boolean;
  scorable: boolean;
}

export interface BlindIdentificationScore {
  mode: BlindMode;
  correct: number;
  total: number;
  percent?: number;
  items: readonly BlindIdentificationItem[];
}

export const BLIND_IDENTIFICATION_FIELDS: readonly BlindIdentificationFieldSpec[] = [
  { key: "country", label: "国家", sourceKeys: ["country"] },
  { key: "region", label: "产区", sourceKeys: ["region", "origin"] },
  { key: "farm", label: "庄园/处理站", sourceKeys: ["farm", "station"] },
  { key: "variety", label: "品种", sourceKeys: ["variety"] },
  { key: "process", label: "处理法", sourceKeys: ["process"] },
  { key: "roast", label: "烘焙度", sourceKeys: ["roast"] },
  { key: "roaster", label: "烘焙商", sourceKeys: ["roaster"] }
] as const;

export function blindGuessFieldKey(key: string): string {
  return `blind_guess_${key}`;
}

export function blindIdentificationFieldsForMode(
  mode: BlindMode | undefined,
  semiBlindVisibleFields?: readonly string[]
): readonly BlindIdentificationFieldSpec[] {
  const normalized = normalizeBlindMode(mode);
  if (normalized === "open") return [];
  if (normalized === "full_blind") return BLIND_IDENTIFICATION_FIELDS;
  const visible = new Set(semiBlindVisibleFields?.length ? semiBlindVisibleFields : DEFAULT_SEMI_BLIND_VISIBLE_FIELDS);
  return BLIND_IDENTIFICATION_FIELDS.filter((field) => !field.sourceKeys.some((key) => visible.has(key)));
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const joined = value.map((item) => text(item)).filter(Boolean).join(" / ");
    return joined || undefined;
  }
  return undefined;
}

function referenceValue(metadata: Record<string, unknown>, field: BlindIdentificationFieldSpec): string | undefined {
  for (const key of field.sourceKeys) {
    const value = text(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\-_.·•()（）\[\]【】'"“”‘’]/gu, "")
    .trim();
}

function aliases(value: string): readonly string[] {
  return [...new Set(value.split(/[\/|,，、;；\n]+/u).map((part) => normalizeToken(part)).filter(Boolean))];
}

export function blindIdentityMatches(truth: string, guess: string): boolean {
  const truthAliases = aliases(truth);
  const guessAliases = aliases(guess);
  if (!truthAliases.length || !guessAliases.length) return false;
  return guessAliases.some((candidate) => truthAliases.includes(candidate));
}

export function calculateBlindIdentificationScore(
  sampleMetadata: Record<string, unknown>,
  observations: readonly BlindIdentificationObservation[],
  mode: BlindMode | undefined,
  semiBlindVisibleFields?: readonly string[]
): BlindIdentificationScore {
  const normalizedMode = normalizeBlindMode(mode);
  const values = new Map(observations.map((item) => [item.fieldKey, item.value] as const));
  let correct = 0;
  let total = 0;
  const items = blindIdentificationFieldsForMode(normalizedMode, semiBlindVisibleFields).map((field): BlindIdentificationItem => {
    const truth = referenceValue(sampleMetadata, field);
    const guess = text(values.get(blindGuessFieldKey(field.key)));
    if (!truth) return { key: field.key, label: field.label, guess, scorable: false };
    total += 1;
    const matched = Boolean(guess) && blindIdentityMatches(truth, guess!);
    if (matched) correct += 1;
    return { key: field.key, label: field.label, truth, guess, correct: matched, scorable: true };
  });
  return {
    mode: normalizedMode,
    correct,
    total,
    percent: total ? Math.round(correct / total * 1000) / 10 : undefined,
    items
  };
}
