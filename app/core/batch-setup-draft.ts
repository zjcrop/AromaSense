import type { CuppingSessionMetadata } from "./session-metadata";

export const BATCH_SETUP_DRAFT_VERSION = 2 as const;

export interface BatchSetupDraftItem {
  id: string;
  label: string;
  metadata: Record<string, unknown>;
  previewDataUrl?: string;
  recognitionStatus?: string;
  requiresReview: boolean;
  confirmed: boolean;
}

export interface BatchSetupDraft {
  version: typeof BATCH_SETUP_DRAFT_VERSION;
  title: string;
  sessionMetadata: Partial<CuppingSessionMetadata>;
  items: BatchSetupDraftItem[];
  updatedAt: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizedSessionMetadata(value: unknown): Partial<CuppingSessionMetadata> {
  const source = record(value) ?? {};
  const result: Partial<CuppingSessionMetadata> = {};
  for (const key of ["date", "time", "organizer", "participants", "target", "eventName"] as const) {
    const field = source[key];
    if (typeof field === "string" && field.trim()) result[key] = field.trim();
  }
  return result;
}

/**
 * Normalizes the current 0.1C draft shape and transparently upgrades the
 * pre-0.1C v1 shape.  v1 did not have sessionMetadata; keeping it readable is
 * important because drafts live in SQLite user_preferences across upgrades.
 */
export function normalizeBatchSetupDraft(value: unknown): BatchSetupDraft | undefined {
  const source = record(value);
  const version = Number(source?.version);
  if (!source || (version !== 1 && version !== BATCH_SETUP_DRAFT_VERSION) || !Array.isArray(source.items)) return undefined;
  const items = source.items.flatMap((item): BatchSetupDraftItem[] => {
    const row = record(item);
    const metadata = record(row?.metadata);
    const id = String(row?.id ?? "").trim();
    if (!row || !metadata || !id) return [];
    return [{
      id,
      label: String(row.label ?? ""),
      metadata,
      previewDataUrl: typeof row.previewDataUrl === "string" && row.previewDataUrl.startsWith("data:image/") ? row.previewDataUrl : undefined,
      recognitionStatus: typeof row.recognitionStatus === "string" ? row.recognitionStatus : undefined,
      requiresReview: row.requiresReview === true,
      confirmed: row.confirmed === true
    }];
  });
  if (!items.length) return undefined;
  return {
    version: BATCH_SETUP_DRAFT_VERSION,
    title: String(source.title ?? ""),
    sessionMetadata: version === 1 ? {} : normalizedSessionMetadata(source.sessionMetadata),
    items,
    updatedAt: String(source.updatedAt ?? "")
  };
}

export function firstPendingItemIndex(items: readonly BatchSetupDraftItem[], startAfter = -1): number {
  if (!items.length) return -1;
  const normalizedStart = Math.min(Math.max(startAfter, -1), items.length - 1);
  for (let index = normalizedStart + 1; index < items.length; index += 1) if (!items[index].confirmed) return index;
  for (let index = 0; index <= normalizedStart; index += 1) if (!items[index].confirmed) return index;
  return -1;
}

export function batchSetupDraftCounts(items: readonly BatchSetupDraftItem[]): { confirmed: number; pending: number; total: number } {
  const confirmed = items.filter((item) => item.confirmed).length;
  return { confirmed, pending: items.length - confirmed, total: items.length };
}
