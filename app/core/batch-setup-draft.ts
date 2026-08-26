import { normalizeImportBundle, type ImportSessionDraft } from "./import-bundle";
import { normalizeBlindMode, normalizeSessionMetadata, type CuppingSessionMetadata } from "./session-metadata";

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

export interface ConfirmedImportSessionDraft {
  title?: string;
  metadata: CuppingSessionMetadata;
  samples: Array<{ label: string; metadata: Record<string, unknown> }>;
}

export interface BatchImportQueueDraft {
  sessions: ImportSessionDraft[];
  index: number;
  completed: ConfirmedImportSessionDraft[];
  sourceName: string;
}

export interface BatchSetupDraft {
  version: typeof BATCH_SETUP_DRAFT_VERSION;
  title: string;
  sessionMetadata: Partial<CuppingSessionMetadata>;
  items: BatchSetupDraftItem[];
  importQueue?: BatchImportQueueDraft;
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
  if (typeof source.blindMode === "string") result.blindMode = normalizeBlindMode(source.blindMode);
  if (Array.isArray(source.semiBlindVisibleFields)) {
    const fields = [...new Set(source.semiBlindVisibleFields.map((item) => String(item ?? "").trim()).filter(Boolean))];
    if (fields.length) result.semiBlindVisibleFields = fields;
  }
  return result;
}

function normalizeConfirmedSession(value: unknown): ConfirmedImportSessionDraft | undefined {
  const source = record(value);
  const metadataSource = record(source?.metadata);
  if (!source || !metadataSource || !Array.isArray(source.samples)) return undefined;
  let metadata: CuppingSessionMetadata;
  try { metadata = normalizeSessionMetadata(metadataSource as Partial<CuppingSessionMetadata>); }
  catch { return undefined; }
  const samples = source.samples.flatMap((item) => {
    const row = record(item);
    const rowMetadata = record(row?.metadata);
    const label = String(row?.label ?? "").trim();
    return row && rowMetadata && label ? [{ label, metadata: rowMetadata }] : [];
  });
  if (!samples.length || samples.length !== source.samples.length) return undefined;
  const title = typeof source.title === "string" && source.title.trim() ? source.title.trim() : undefined;
  return { title, metadata, samples };
}

function normalizeImportQueue(value: unknown): BatchImportQueueDraft | undefined {
  const source = record(value);
  if (!source || !Array.isArray(source.sessions)) return undefined;
  const bundle = normalizeImportBundle(
    { schema: "aromasense-import/1", sessions: source.sessions },
    { kind: "json", name: "恢复中的批量导入" }
  );
  if (!bundle?.sessions.length) return undefined;
  const index = Number(source.index);
  if (!Number.isInteger(index) || index < 0 || index >= bundle.sessions.length) return undefined;
  const completed = Array.isArray(source.completed)
    ? source.completed.flatMap((item) => {
        const normalized = normalizeConfirmedSession(item);
        return normalized ? [normalized] : [];
      })
    : [];
  if (completed.length !== index) return undefined;
  return {
    sessions: bundle.sessions,
    index,
    completed,
    sourceName: typeof source.sourceName === "string" && source.sourceName.trim() ? source.sourceName.trim() : "批量导入"
  };
}

/**
 * Normalizes the current 0.1C draft shape and transparently upgrades the
 * pre-0.1C v1 shape. v1 did not have sessionMetadata; keeping it readable is
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
    importQueue: version === 1 ? undefined : normalizeImportQueue(source.importQueue),
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
