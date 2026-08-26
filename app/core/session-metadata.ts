export type CuppingMode = "open" | "blind" | "semi_blind";

/** Legacy storage compatibility only. New code should use CuppingMode. */
export type BlindMode = "open" | "semi_blind" | "full_blind";

export const CUPPING_MODES: readonly CuppingMode[] = ["open", "blind", "semi_blind"] as const;
export const BLIND_MODES: readonly BlindMode[] = ["open", "semi_blind", "full_blind"] as const;
export const DEFAULT_SEMI_BLIND_VISIBLE_FIELDS = ["country", "region", "process", "roast"] as const;

export interface CuppingSessionMetadata {
  date: string;
  time: string;
  organizer: string;
  participants?: string;
  /** Legacy free-text field retained when old records are read. New sessions use cuppingMode as the source of truth. */
  target?: string;
  eventName?: string;
  cuppingMode?: CuppingMode;
  /** Legacy compatibility input. normalizeSessionMetadata migrates it into cuppingMode and does not require new writes to use it. */
  blindMode?: BlindMode;
  semiBlindVisibleFields?: readonly string[];
  revealedAt?: string;
}

function normalizeOptional(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function normalizeFieldList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fields = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
  return fields.length ? fields : undefined;
}

export function normalizeBlindMode(value: unknown): BlindMode {
  return BLIND_MODES.includes(value as BlindMode) ? value as BlindMode : "open";
}

export function cuppingModeFromBlindMode(value: unknown): CuppingMode {
  const legacy = normalizeBlindMode(value);
  if (legacy === "full_blind") return "blind";
  if (legacy === "semi_blind") return "semi_blind";
  return "open";
}

export function normalizeCuppingMode(value: unknown, legacyBlindMode?: unknown): CuppingMode {
  if (CUPPING_MODES.includes(value as CuppingMode)) return value as CuppingMode;
  return cuppingModeFromBlindMode(legacyBlindMode);
}

export function legacyBlindModeFromCuppingMode(mode: CuppingMode): BlindMode {
  if (mode === "blind") return "full_blind";
  if (mode === "semi_blind") return "semi_blind";
  return "open";
}

export function cuppingModeFromMetadata(metadata: Partial<CuppingSessionMetadata>): CuppingMode {
  return normalizeCuppingMode(metadata.cuppingMode, metadata.blindMode);
}

export function cuppingModeLabel(mode: CuppingMode): string {
  if (mode === "blind") return "盲测";
  if (mode === "semi_blind") return "半盲测";
  return "公开杯测";
}

export function normalizeSessionMetadata(value: Partial<CuppingSessionMetadata>): CuppingSessionMetadata {
  const date = String(value.date ?? "").trim();
  const time = String(value.time ?? "").trim();
  const organizer = String(value.organizer ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("CUPPING_DATE_REQUIRED");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("CUPPING_TIME_REQUIRED");
  if (!organizer) throw new Error("CUPPING_ORGANIZER_REQUIRED");
  return {
    date,
    time,
    organizer,
    participants: normalizeOptional(value.participants),
    target: normalizeOptional(value.target),
    eventName: normalizeOptional(value.eventName),
    cuppingMode: normalizeCuppingMode(value.cuppingMode, value.blindMode),
    semiBlindVisibleFields: normalizeFieldList(value.semiBlindVisibleFields),
    revealedAt: normalizeOptional(value.revealedAt)
  };
}

export function defaultSessionMetadata(now: string): CuppingSessionMetadata {
  const date = new Date(now);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return {
    date: localDate.slice(0, 10),
    time: localDate.slice(11, 16),
    organizer: "",
    cuppingMode: "open"
  };
}

export function sessionDisplayName(metadata: Partial<CuppingSessionMetadata>, title?: string): string {
  const eventName = normalizeOptional(metadata.eventName);
  if (eventName) return eventName;
  const organizer = normalizeOptional(metadata.organizer);
  const target = normalizeOptional(metadata.target) ?? cuppingModeLabel(cuppingModeFromMetadata(metadata));
  const combined = [organizer, target].filter(Boolean).join(" · ");
  return combined || normalizeOptional(title) || "未命名杯测";
}
