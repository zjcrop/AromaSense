import {
  cuppingModeFromMetadata,
  cuppingModeLabel,
  type CuppingMode,
  type CuppingSessionMetadata
} from "./session-metadata";

export type CuppingTargetChoice = CuppingMode;

export interface ResolvedCuppingTarget {
  choice: CuppingTargetChoice;
  cuppingMode: CuppingMode;
  label: string;
}

export function resolveCuppingTarget(choice: CuppingTargetChoice): ResolvedCuppingTarget {
  return { choice, cuppingMode: choice, label: cuppingModeLabel(choice) };
}

function modeFromLegacyTarget(target: string | undefined): CuppingTargetChoice | undefined {
  const normalized = target?.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return undefined;
  if (["公开杯测", "公开", "open", "open cupping"].includes(normalized)) return "open";
  if (["盲测", "全盲", "blind", "full blind", "full_blind"].includes(normalized)) return "blind";
  if (["半盲测", "半盲", "semi blind", "semi_blind"].includes(normalized)) return "semi_blind";
  return undefined;
}

export function cuppingTargetChoiceFromMetadata(metadata: Partial<CuppingSessionMetadata>): CuppingTargetChoice {
  return metadata.cuppingMode ?? modeFromLegacyTarget(metadata.target) ?? cuppingModeFromMetadata(metadata);
}

export interface EmptySampleDraft {
  label?: string;
  metadata: Record<string, unknown>;
}

export function buildEmptySampleDrafts(count: number): readonly EmptySampleDraft[] {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("CUPPING_SAMPLE_COUNT_OUT_OF_RANGE");
  return Array.from({ length: count }, () => ({ metadata: {} }));
}

/** Backward-compatible alias for code compiled against the previous 0.1C helper. */
export const buildBlindPlaceholderSampleDrafts = buildEmptySampleDrafts;
