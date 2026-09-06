export type CuppingMode = "free" | "timed" | "blind" | "semi_blind";

/** Legacy storage compatibility only. New code should use CuppingMode. */
export type BlindMode = "open" | "semi_blind" | "full_blind";

export const CUPPING_MODES: readonly CuppingMode[] = ["free", "timed", "blind", "semi_blind"] as const;
export const BLIND_MODES: readonly BlindMode[] = ["open", "semi_blind", "full_blind"] as const;
export const DEFAULT_SEMI_BLIND_VISIBLE_FIELDS = ["country", "region", "process", "roast"] as const;

export interface CuppingModePolicy {
  timerEnabled: boolean;
  runtimeRosterMutable: boolean;
  runtimeIdentityEditable: boolean;
}

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
  eventId?: string;
  eventRevision?: number;
  lowPrecisionLocation?: { latitude: number; longitude: number; accuracyKm: number };
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

function normalizeLocation(value: unknown): CuppingSessionMetadata["lowPrecisionLocation"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const latitude = Number(row.latitude), longitude = Number(row.longitude), accuracyKm = Number(row.accuracyKm);
  if (![latitude, longitude, accuracyKm].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracyKm < 1) return undefined;
  return { latitude: Math.round(latitude * 10) / 10, longitude: Math.round(longitude * 10) / 10, accuracyKm: Math.max(1, Math.round(accuracyKm)) };
}

export function normalizeBlindMode(value: unknown): BlindMode {
  return BLIND_MODES.includes(value as BlindMode) ? value as BlindMode : "open";
}

/** Legacy blind-mode "open" was historically a timed public cupping. */
export function cuppingModeFromBlindMode(value: unknown): CuppingMode {
  const legacy = normalizeBlindMode(value);
  if (legacy === "full_blind") return "blind";
  if (legacy === "semi_blind") return "semi_blind";
  return "timed";
}

export function normalizeCuppingMode(value: unknown, legacyBlindMode?: unknown): CuppingMode {
  if (CUPPING_MODES.includes(value as CuppingMode)) return value as CuppingMode;
  // Historical metadata stored `open`; preserve its old timed behavior after upgrade.
  if (value === "open") return "timed";
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
  if (mode === "free") return "自由杯测";
  if (mode === "timed") return "计时杯测";
  if (mode === "blind") return "盲测";
  return "半盲测";
}

/** Central runtime contract so timer and edit permissions cannot drift between renderers/controllers. */
export function cuppingModePolicy(mode: CuppingMode): CuppingModePolicy {
  return {
    timerEnabled: mode !== "free",
    runtimeRosterMutable: mode === "free",
    // Blind/semi-blind retain their existing late identity-entry workflow; timed public cupping is locked.
    runtimeIdentityEditable: mode === "free" || mode === "blind" || mode === "semi_blind"
  };
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
    revealedAt: normalizeOptional(value.revealedAt),
    eventId: normalizeOptional(value.eventId),
    eventRevision: Number.isInteger(value.eventRevision) && Number(value.eventRevision) > 0 ? Number(value.eventRevision) : undefined,
    lowPrecisionLocation: normalizeLocation(value.lowPrecisionLocation)
  };
}

export function defaultSessionMetadata(now: string): CuppingSessionMetadata {
  const date = new Date(now);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return {
    date: localDate.slice(0, 10),
    time: localDate.slice(11, 16),
    organizer: "",
    cuppingMode: "free"
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
