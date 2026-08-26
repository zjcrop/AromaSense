import { loadBundledLuckyBeanRecognitionBook, luckyBeanCoreVersion, requireLuckyBeanRecognitionCore, type LuckyBeanAnalysisField, type LuckyBeanRecognitionAnalysis } from "./luckybean-upstream-adapter";
import { buildManualTextBundle, candidateManualLabel, manualTextRows, splitManualCoffeeRow } from "./manual-text-import";
import type { ImportBundle, ImportSampleDraft } from "./import-bundle";

const FIELD_MAP: Readonly<Record<string, string>> = Object.freeze({
  countryCode: "country", regionCode: "region", entityCode: "farm", varietyCode: "variety",
  processCode: "process", roastCode: "roast", roastDate: "roastDate", harvestYear: "harvest",
  roastColor: "roastColor", roasterName: "roaster", altitude: "altitude", initialWeight: "weight",
  flavorCodes: "flavorNotes"
});

const PARSED_FIELDS = ["productionDate", "packDate", "bestBefore", "expiryDate", "lot", "grade"] as const;

function clean(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim();
}

function targetField(value: unknown): string {
  const source = clean(value);
  return FIELD_MAP[source] ?? source;
}

function analysisFields(analysis: LuckyBeanRecognitionAnalysis): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of analysis.fields ?? []) {
    const key = targetField(field.field);
    const value = clean(field.standardValue ?? field.rawValue);
    if (key && value) result[key] = value;
  }
  for (const key of PARSED_FIELDS) {
    const value = analysis.parsed?.[key];
    if (value !== undefined && value !== null && clean(value)) result[key] = clean(value);
  }
  return result;
}

function reviewItems(analysis: LuckyBeanRecognitionAnalysis): Array<Record<string, unknown>> {
  return (analysis.fields ?? []).filter((field) => field.status === "review").map((field: LuckyBeanAnalysisField) => ({
    field: targetField(field.field),
    value: clean(field.standardValue ?? field.rawValue),
    confidence: Number(field.confidence ?? 0),
    candidates: (field.resolution?.candidates ?? []).map((candidate) => ({
      value: clean(candidate.value), normalizedValue: clean(candidate.value), score: Number(candidate.confidence ?? candidate.score ?? 0)
    }))
  }));
}

function fallbackLabel(metadata: Record<string, unknown>, index: number): string {
  const parts = [metadata.farm, metadata.station, metadata.region, metadata.variety, metadata.country]
    .map(clean).filter(Boolean);
  return parts.length ? [...new Set(parts)].slice(0, 2).join(" · ").slice(0, 80) : `待确认样品 ${String(index + 1).padStart(2, "0")}`;
}

export function recognizeManualText(text: string): ImportBundle {
  const core = requireLuckyBeanRecognitionCore();
  const book = loadBundledLuckyBeanRecognitionBook();
  const rows = manualTextRows(text);
  const samples: ImportSampleDraft[] = rows.map((rawText, index) => {
    const tokens = splitManualCoffeeRow(rawText);
    const imageId = `manual-text-${index + 1}`;
    const blocks = (tokens.length ? tokens : [rawText]).map((token, order) => ({
      id: `${imageId}-block-${order + 1}`,
      imageId,
      imageRole: "front",
      order,
      text: token,
      confidence: 1,
      polygon: [
        { x: order * 120, y: 0 }, { x: order * 120 + 110, y: 0 },
        { x: order * 120 + 110, y: 32 }, { x: order * 120, y: 32 }
      ]
    }));
    const document = core.createRecognitionDocument({
      images: [{ id: imageId, role: "front", roleLabel: "手工文本" }],
      blocks,
      engine: "manual-text",
      fullText: rawText
    });
    const analysis = core.analyzeRecognitionDocument(document, book);
    const metadata = analysisFields(analysis);
    const label = candidateManualLabel(tokens, metadata) ?? fallbackLabel(metadata, index);
    return {
      label,
      metadata: {
        ...metadata,
        recognition: {
          schemaVersion: "aromasense-recognition/3.1",
          source: "manual-text",
          engine: `manual-text+${String(analysis.pipelineVersion ?? luckyBeanCoreVersion())}`,
          rawText,
          review: reviewItems(analysis),
          tokens,
          luckyBeanUpstream: {
            pipelineVersion: analysis.pipelineVersion,
            resolvedCount: analysis.resolvedCount,
            reviewCount: analysis.reviewCount,
            semanticText: analysis.semanticText
          }
        }
      },
      rawText,
      sourceRow: index + 1,
      requiresReview: true
    };
  });
  return buildManualTextBundle(text, samples);
}
