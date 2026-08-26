import type { ImportBundle, ImportSampleDraft } from "./import-bundle";
import { IMPORT_BUNDLE_SCHEMA } from "./import-bundle";

const PLACEHOLDER_PREFIX = "\uE000";
const PLACEHOLDER_SUFFIX = "\uE001";

interface ProtectedToken {
  marker: string;
  value: string;
}

function protect(line: string): { text: string; tokens: ProtectedToken[] } {
  const tokens: ProtectedToken[] = [];
  let text = line;
  const patterns = [
    /https?:\/\/[^\s，,。；;|*…]+/giu,
    /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/gu,
    /\b\d{3,4}\s*[-–—]\s*\d{3,4}\s*(?:m|米)?\b/giu,
    /\b(?:SL\s*\d{1,3}|\d{4,5})(?:\s*\/\s*(?:SL\s*\d{1,3}|\d{4,5}))+\b/giu
  ];
  for (const pattern of patterns) {
    text = text.replace(pattern, (value) => {
      const marker = `${PLACEHOLDER_PREFIX}${tokens.length}${PLACEHOLDER_SUFFIX}`;
      tokens.push({ marker, value });
      return marker;
    });
  }
  return { text, tokens };
}

function restore(value: string, tokens: readonly ProtectedToken[]): string {
  let result = value;
  for (const token of tokens) result = result.replaceAll(token.marker, token.value);
  return result.trim();
}

/**
 * Tokenizes one coffee row while preserving dates, altitude ranges, URLs and
 * common variety combinations such as SL28/SL34.  Single spaces are not a
 * delimiter because farm and producer names frequently contain spaces.
 */
export function splitManualCoffeeRow(line: string): string[] {
  const normalized = line.normalize("NFKC").trim();
  if (!normalized) return [];
  const { text, tokens } = protect(normalized);
  const hasStrongSeparator = /[，,。；;|\\/*·…-]/u.test(text);
  const parts = hasStrongSeparator
    ? text.split(/(?:，|,|。|；|;|\||\\|\/|\*|·|…+|-)+/u)
    : text.split(/\t+|\s{2,}/u);
  return parts.map((part) => restore(part, tokens)).filter(Boolean);
}

export function manualTextRows(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function candidateManualLabel(tokens: readonly string[], recognizedMetadata: Record<string, unknown>): string | undefined {
  if (tokens.length < 2) return undefined;
  const first = tokens[0]?.trim();
  if (!first || /^(?:国家|产地|产区|庄园|农场|品种|豆种|处理法|处理|烘焙|风味|country|origin|region|farm|variety|process)\s*[:：]?/iu.test(first)) return undefined;
  const values = new Set(Object.values(recognizedMetadata).flatMap((value) => {
    if (typeof value === "string") return [value.trim().toLocaleLowerCase("en-US")];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLocaleLowerCase("en-US"));
    return [];
  }));
  return values.has(first.toLocaleLowerCase("en-US")) ? undefined : first.slice(0, 80);
}

export function buildManualTextBundle(
  text: string,
  samples: readonly ImportSampleDraft[],
  sourceName = "手工批量文本"
): ImportBundle {
  return {
    schema: IMPORT_BUNDLE_SCHEMA,
    source: { kind: "text", name: sourceName },
    sessions: [{ sourceGroup: sourceName, metadata: {}, samples: [...samples] }],
    warnings: manualTextRows(text).length === samples.length ? [] : ["部分空行或无法解析的行已忽略。"]
  };
}
