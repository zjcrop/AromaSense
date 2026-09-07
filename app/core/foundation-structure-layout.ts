import { requireLuckyBeanRecognitionCore, type LuckyBeanRecognitionDocument } from "./luckybean-upstream-adapter";
import type { OCRBox, OCRLayoutDocument, OCRLayoutLine } from "./ocr-layout-model";
import type { CoffeePageStructureGateway, PageStructureInput, PageStructureResult } from "./page-structure-contract";
import type { SampleLayoutResult, SampleLayoutType } from "./sample-layout-segmenter";

interface FoundationStructureRecoveryResult {
  schemaVersion?: string;
  producer?: Record<string, unknown>;
  hypothesis?: {
    schemaVersion?: string;
    confidence?: number;
    ambiguous?: boolean;
    shouldInvokeAi?: boolean;
  };
  split?: boolean;
  count?: number;
  method?: string;
  source?: string;
  documents?: readonly LuckyBeanRecognitionDocument[];
  requiresUserConfirmation?: boolean;
  unassignedEvidenceRefs?: readonly string[];
  ai?: {
    engaged?: boolean;
    accepted?: boolean;
    materialized?: boolean;
    reason?: string;
    proposal?: { confidence?: number };
  };
}

type StructureCore = ReturnType<typeof requireLuckyBeanRecognitionCore> & {
  RECOGNITION_RECORD_HYPOTHESIS_SCHEMA?: string;
  RECOGNITION_STRUCTURE_RECOVERY_SCHEMA?: string;
  AI_STRUCTURE_RESULT_SCHEMA?: string;
  recoverRecognitionStructure?(
    document: LuckyBeanRecognitionDocument,
    options?: {
      geometry?: { sourceWidth?: number; sourceHeight?: number };
      aiRecoverStructure?: (
        document: LuckyBeanRecognitionDocument,
        hypothesis: Record<string, unknown>
      ) => Promise<{ ok: boolean; result?: Record<string, unknown>; reason?: string; skipped?: boolean }>;
    }
  ): Promise<FoundationStructureRecoveryResult>;
};

export interface FoundationStructureLayoutOutcome {
  layout?: SampleLayoutResult;
  recovery: {
    schemaVersion?: string;
    hypothesisSchemaVersion?: string;
    source: string;
    method: string;
    aiEngaged: boolean;
    aiAccepted: boolean;
    aiReason?: string;
    unassignedEvidenceRefs: readonly string[];
    producer?: Record<string, unknown>;
  };
}

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
  if (/side-by-side/iu.test(method)) return "grid";
  if (/vertical/iu.test(method)) return "vertical-block-list";
  if (/table|row/iu.test(method)) return "row-list";
  return "mixed";
}

function upstreamDocument(document: OCRLayoutDocument, retainedIds: ReadonlySet<string>, core: StructureCore): LuckyBeanRecognitionDocument {
  const lines = document.lines.filter((line) => retainedIds.has(line.id));
  return core.createRecognitionDocument({
    images: [{ id: document.imageId, role: "front", roleLabel: "样品图片" }],
    blocks: lines.map((line, index) => ({
      id: line.id,
      blockId: line.blockId,
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
    engine: "aromasense-foundation-structure",
    fullText: lines.map((line) => line.text).join("\n")
  });
}

function evidenceRef(value: string): string {
  const clean = value.trim();
  return clean.startsWith("block:") ? clean : `block:${clean}`;
}

function groupingProposal(result: PageStructureResult): Record<string, unknown> {
  const recordCount = result.samples.length;
  const confidences = result.samples.map((sample) => Number(sample.confidence)).filter(Number.isFinite);
  const confidence = confidences.length ? Math.min(...confidences) : 0;
  return {
    schemaVersion: "ai-structure-result/1.0",
    task: "structure",
    recordCount,
    confidence,
    reason: "aromasense-page-structure-grouping",
    groups: recordCount >= 2
      ? result.samples.map((sample) => ({
          id: sample.sampleRef,
          evidenceRefs: sample.evidenceRefs.map(evidenceRef)
        }))
      : [],
    unassignedEvidenceRefs: result.unassignedEvidence.map(evidenceRef),
    engine: result.engine,
    model: result.model ?? null,
    createdAt: result.createdAt,
    inputFingerprint: result.inputFingerprint,
    policy: {
      authority: "advisory",
      mayOverwriteFact: false,
      mayCreateFacts: false
    }
  };
}

function recoveryMetadata(core: StructureCore | undefined, result: FoundationStructureRecoveryResult | undefined, reason?: string): FoundationStructureLayoutOutcome["recovery"] {
  return {
    schemaVersion: result?.schemaVersion ?? core?.RECOGNITION_STRUCTURE_RECOVERY_SCHEMA,
    hypothesisSchemaVersion: result?.hypothesis?.schemaVersion ?? core?.RECOGNITION_RECORD_HYPOTHESIS_SCHEMA,
    source: String(result?.source ?? "foundation-unavailable"),
    method: String(result?.method ?? "none"),
    aiEngaged: Boolean(result?.ai?.engaged),
    aiAccepted: Boolean(result?.ai?.accepted),
    ...(result?.ai?.reason || reason ? { aiReason: String(result?.ai?.reason ?? reason) } : {}),
    unassignedEvidenceRefs: [...(result?.unassignedEvidenceRefs ?? [])],
    ...(result?.producer ? { producer: result.producer } : {})
  };
}

/**
 * P3 adapter boundary. AromaSense supplies product-filtered page evidence and an
 * optional AI grouping provider. LuckyBean/Foundation owns record hypothesis,
 * proposal validation, split authority, evidence partitioning and fallback.
 * AI field values are deliberately ignored here; coffee facts are resolved only
 * after Foundation materializes evidence-preserving child RecognitionDocuments.
 */
export async function recoverFoundationStructureLayout(input: {
  document: OCRLayoutDocument;
  pageInput: PageStructureInput;
  gateway?: CoffeePageStructureGateway;
}): Promise<FoundationStructureLayoutOutcome> {
  let core: StructureCore;
  try {
    core = requireLuckyBeanRecognitionCore() as StructureCore;
  } catch {
    return { recovery: recoveryMetadata(undefined, undefined, "recognition-runtime-unavailable") };
  }

  if (
    core.RECOGNITION_RECORD_HYPOTHESIS_SCHEMA !== "recognition-record-hypothesis/1.0" ||
    core.RECOGNITION_STRUCTURE_RECOVERY_SCHEMA !== "recognition-structure-recovery/1.0" ||
    core.AI_STRUCTURE_RESULT_SCHEMA !== "ai-structure-result/1.0" ||
    typeof core.recoverRecognitionStructure !== "function"
  ) {
    return { recovery: recoveryMetadata(core, undefined, "structure-recovery-contract-unavailable") };
  }

  const retainedIds = new Set(input.pageInput.blocks.map((block) => block.id));
  if (retainedIds.size < 2) {
    return { recovery: recoveryMetadata(core, undefined, "insufficient-page-evidence") };
  }

  const source = upstreamDocument(input.document, retainedIds, core);
  const result = await core.recoverRecognitionStructure(source, {
    geometry: { sourceWidth: input.document.sourceWidth, sourceHeight: input.document.sourceHeight },
    ...(input.gateway?.structurePage
      ? {
          aiRecoverStructure: async () => {
            const structured = await input.gateway!.structurePage!(input.pageInput);
            return structured.ok && structured.result
              ? { ok: true, result: groupingProposal(structured.result) }
              : { ok: false, reason: structured.reason ?? "structure-provider-unavailable" };
          }
        }
      : {})
  });

  const recovery = recoveryMetadata(core, result);
  const children = result.documents ?? [];
  if (!result.split || children.length < 2) return { recovery };

  const lineById = new Map(input.document.lines.map((line) => [line.id, line] as const));
  const claimed = new Set<string>();
  const confidence = Math.max(0, Math.min(1, Number(result.ai?.proposal?.confidence ?? result.hypothesis?.confidence ?? 0.7)));
  const segments = children.map((child, index) => {
    const ids = [...new Set((child.blocks ?? []).map((block) => String((block as { id?: unknown })?.id ?? "")).filter(Boolean))];
    if (!ids.length || ids.some((id) => claimed.has(id))) return undefined;
    const lines = ids.map((id) => lineById.get(id)).filter((line): line is OCRLayoutLine => Boolean(line));
    if (lines.length !== ids.length) return undefined;
    ids.forEach((id) => claimed.add(id));
    return {
      id: `${input.document.imageId}-foundation-record-${index + 1}`,
      index,
      confidence,
      box: unionBox(lines),
      lines,
      text: lines.map((line) => line.text).join("\n"),
      hints: { profile: `foundation:${String(result.method ?? "structure-recovery")}` }
    };
  });

  if (segments.some((segment) => !segment)) {
    return {
      recovery: {
        ...recovery,
        aiReason: "consumer-evidence-identity-mismatch"
      }
    };
  }

  return {
    recovery,
    layout: {
      layoutType: layoutType(String(result.method ?? "")),
      confidence,
      requiresReview: true,
      segments: segments.filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
    }
  };
}
