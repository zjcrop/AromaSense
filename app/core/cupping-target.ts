import type { BlindMode, CuppingSessionMetadata } from "./session-metadata";

export type CuppingTargetChoice = "blind" | "semi_blind" | "custom";

export interface ResolvedCuppingTarget {
  choice: CuppingTargetChoice;
  target?: string;
  blindMode: BlindMode;
}

export function resolveCuppingTarget(choice: CuppingTargetChoice, customTarget?: string): ResolvedCuppingTarget {
  if (choice === "blind") return { choice, target: "盲测", blindMode: "full_blind" };
  if (choice === "semi_blind") return { choice, target: "半盲", blindMode: "semi_blind" };
  const normalized = customTarget?.trim();
  return { choice, target: normalized || undefined, blindMode: "open" };
}

export function cuppingTargetChoiceFromMetadata(metadata: Partial<CuppingSessionMetadata>): CuppingTargetChoice {
  if (metadata.blindMode === "full_blind") return "blind";
  if (metadata.blindMode === "semi_blind") return "semi_blind";
  return "custom";
}

export interface BlindPlaceholderSampleDraft {
  label: string;
  metadata: Record<string, unknown>;
}

export function buildBlindPlaceholderSampleDrafts(count: number): readonly BlindPlaceholderSampleDraft[] {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("BLIND_SAMPLE_COUNT_OUT_OF_RANGE");
  return Array.from({ length: count }, (_, index) => ({
    label: `待揭盲样品 ${String(index + 1).padStart(2, "0")}`,
    metadata: { blindPlaceholder: true }
  }));
}
