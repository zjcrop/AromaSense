import type { RecognitionDictionaryHint, RecognitionLayoutHints, PageStructureEvidenceBlock } from "./recognition-evidence-harvester";

export const AI_PAGE_STRUCTURE_SCHEMA = "ai-page-structure-result/1.0" as const;

export type PageStructureField =
  | "label" | "country" | "region" | "entity" | "farm" | "station" | "producer" | "cooperative"
  | "variety" | "species" | "process" | "lot" | "grade" | "roast" | "roastDate" | "harvest"
  | "altitude" | "roaster" | "weight" | "flavorNotes";

export interface PageStructureFieldValue {
  field: PageStructureField;
  value: string;
  confidence: number;
  evidenceRefs: readonly string[];
}

export interface PageStructureExtraValue {
  field: "price" | "brewCategory" | "packageWeight" | "menuCategory";
  value: string;
  confidence: number;
  evidenceRefs: readonly string[];
}

export interface PageStructureSample {
  sampleRef: string;
  confidence: number;
  evidenceRefs: readonly string[];
  fields: readonly PageStructureFieldValue[];
  extras?: readonly PageStructureExtraValue[];
}

export interface PageStructureResult {
  schemaVersion: typeof AI_PAGE_STRUCTURE_SCHEMA;
  task: "structure-page";
  engine: string;
  model?: string | null;
  createdAt: string;
  inputFingerprint: string;
  samples: readonly PageStructureSample[];
  unassignedEvidence: readonly string[];
  policy: {
    authority: "advisory";
    mayInventFact: false;
    mayOverwriteFact: false;
  };
}

export interface PageStructureInput {
  fullText: string;
  blocks: readonly PageStructureEvidenceBlock[];
  layoutHints?: RecognitionLayoutHints;
}

export interface CoffeePageStructureGateway {
  dictionaryHints?(text: string, evidenceRef: string): readonly RecognitionDictionaryHint[];
  structurePage?(input: PageStructureInput): Promise<{ ok: boolean; result?: PageStructureResult; reason?: string }>;
}
