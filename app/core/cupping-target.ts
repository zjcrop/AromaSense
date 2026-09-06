import {
  cuppingModeFromMetadata,
  cuppingModeLabel,
  normalizeCuppingMode,
  type CanonicalCuppingMode,
  type CuppingMode,
  type CuppingSessionMetadata
} from "./session-metadata";

/** Includes legacy `open` only so pre-upgrade setup code continues to compile/read drafts. */
export type CuppingTargetChoice = CuppingMode;

export interface ResolvedCuppingTarget {
  choice: CuppingTargetChoice;
  cuppingMode: CanonicalCuppingMode;
  label: string;
}

export function resolveCuppingTarget(choice: CuppingTargetChoice): ResolvedCuppingTarget {
  const cuppingMode = normalizeCuppingMode(choice);
  return { choice, cuppingMode, label: cuppingModeLabel(cuppingMode) };
}

function modeFromLegacyTarget(target: string | undefined): CanonicalCuppingMode | undefined {
  const normalized = target?.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return undefined;
  if (["自由杯测", "自由", "free", "free cupping"].includes(normalized)) return "free";
  if (["计时杯测", "计时", "timed", "timed cupping"].includes(normalized)) return "timed";
  // Historical “公开杯测/open” used the timed runtime, so legacy records stay timed.
  if (["公开杯测", "公开", "open", "open cupping"].includes(normalized)) return "timed";
  if (["盲测", "全盲", "blind", "full blind", "full_blind"].includes(normalized)) return "blind";
  if (["半盲测", "半盲", "semi blind", "semi_blind"].includes(normalized)) return "semi_blind";
  return undefined;
}

export function cuppingTargetChoiceFromMetadata(metadata: Partial<CuppingSessionMetadata>): CuppingTargetChoice {
  if (metadata.cuppingMode !== undefined) return normalizeCuppingMode(metadata.cuppingMode, metadata.blindMode);
  return modeFromLegacyTarget(metadata.target) ?? cuppingModeFromMetadata(metadata);
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
