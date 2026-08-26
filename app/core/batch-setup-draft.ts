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

export function normalizeBatchSetupDraft(value: unknown): BatchSetupDraft | undefined {
  const source = record(value);
  if (!source || source.version !== BATCH_SETUP_DRAFT_VERSION || !Array.isArray(source.items)) return undefined;
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
  const sessionMetadata = record(source.sessionMetadata) ?? {};
  return {
    version: BATCH_SETUP_DRAFT_VERSION,
    title: String(source.title ?? ""),
    sessionMetadata: {
      date: typeof sessionMetadata.date === "string" ? sessionMetadata.date : undefined,
      time: typeof sessionMetadata.time === "string" ? sessionMetadata.time : undefined,
      organizer: typeof sessionMetadata.organizer === "string" ? sessionMetadata.organizer : undefined,
      participants: typeof sessionMetadata.participants === "string" ? sessionMetadata.participants : undefined,
      target: typeof sessionMetadata.target === "string" ? sessionMetadata.target : undefined,
      eventName: typeof sessionMetadata.eventName === "string" ? sessionMetadata.eventName : undefined
    },
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
