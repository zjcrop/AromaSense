import {
  DEFAULT_SEMI_BLIND_VISIBLE_FIELDS,
  cuppingModeFromMetadata,
  cuppingModeLabel,
  normalizeSessionMetadata,
  type CuppingMode,
  type CuppingSessionMetadata
} from "./session-metadata";

export type SessionVisibilityStatus = "draft" | "active" | "completed" | "archived";

export function blindModeLabel(mode: CuppingMode): string {
  return cuppingModeLabel(mode);
}

export function blindModeDescription(mode: CuppingMode): string {
  if (mode === "semi_blind") return "杯测中隐藏样品名称和直接身份信息，仅显示国家、产区、处理法与烘焙度；整场完成后统一揭盲。";
  if (mode === "blind") return "杯测中仅显示匿名样品编号，不显示名称或样品元数据；整场完成后统一揭盲。";
  return "杯测过程中显示样品名称与全部已录入信息。";
}

export function isBlindSessionRevealed(
  metadata: CuppingSessionMetadata,
  status: SessionVisibilityStatus
): boolean {
  const mode = cuppingModeFromMetadata(metadata);
  return mode === "open" || status === "completed" || status === "archived" || Boolean(metadata.revealedAt?.trim());
}

export function anonymousSampleLabel(displayNumber: number): string {
  const normalized = Number.isFinite(displayNumber) && displayNumber > 0 ? Math.trunc(displayNumber) : 0;
  return `Sample ${String(normalized).padStart(2, "0")}`;
}

export function visibleSampleLabel(
  label: string | undefined,
  displayNumber: number,
  metadata: CuppingSessionMetadata,
  status: SessionVisibilityStatus
): string {
  if (isBlindSessionRevealed(metadata, status)) {
    const normalized = label?.trim();
    return normalized || `样品 ${String(displayNumber).padStart(2, "0")}`;
  }
  return anonymousSampleLabel(displayNumber);
}

export function visibleSampleMetadata(
  sampleMetadata: Record<string, unknown>,
  metadata: CuppingSessionMetadata,
  status: SessionVisibilityStatus
): Record<string, unknown> {
  if (isBlindSessionRevealed(metadata, status)) return { ...sampleMetadata };
  const mode = cuppingModeFromMetadata(metadata);
  if (mode === "blind") return {};
  if (mode === "open") return { ...sampleMetadata };

  const allowed = metadata.semiBlindVisibleFields?.length
    ? metadata.semiBlindVisibleFields
    : DEFAULT_SEMI_BLIND_VISIBLE_FIELDS;
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(sampleMetadata, key)) result[key] = sampleMetadata[key];
  }
  return result;
}

export function revealBlindSessionMetadata(metadata: CuppingSessionMetadata, now: string): CuppingSessionMetadata {
  const normalized = normalizeSessionMetadata(metadata);
  if (cuppingModeFromMetadata(normalized) === "open" || normalized.revealedAt) return normalized;
  return normalizeSessionMetadata({ ...normalized, revealedAt: now });
}
