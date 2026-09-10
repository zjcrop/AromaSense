export type CanonicalCuppingMode = "formal" | "free" | "competition" | "timed" | "blind" | "semi_blind";
/** Legacy `open` is accepted only while old stored/UI code is being normalized. */
export type CuppingMode = CanonicalCuppingMode | "open";

/** Legacy storage compatibility only. New code should use canonical CuppingMode values. */
export type BlindMode = "open" | "semi_blind" | "full_blind";
export type CuppingProtocol = "sca_cva" | "aromasense_custom";

export const CUPPING_MODES: readonly CanonicalCuppingMode[] = [
  "formal",
  "free",
  "competition",
  "blind",
  "semi_blind",
  "timed"
] as const;
export const BLIND_MODES: readonly BlindMode[] = ["open", "semi_blind", "full_blind"] as const;
export const DEFAULT_SEMI_BLIND_VISIBLE_FIELDS = ["country", "region", "process", "roast"] as const;

export interface CuppingModePolicy {
  timerEnabled: boolean;
  runtimeRosterMutable: boolean;
  runtimeIdentityEditable: boolean;
  competition: boolean;
  completionLocks: boolean;
  protocol: CuppingProtocol;
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
  /** Competition state lives in metadata so older local schemas remain readable without a destructive migration. */
  competitionStartedAt?: string;
  competitionLockedAt?: string;
  competitionSubmittedAt?: string;
  /** Ordinary/formal/free sessions may be marked complete while remaining editable. */
  completedEditableAt?: string;
  /** Optional organizer-defined time limit. Elapsed time still derives from the persisted start anchor. */
  competitionTimeLimitSeconds?: number;
}

function normalizeOptional(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
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

/** Legacy blind-mode `open` was historically a timed public cupping. */
export function cuppingModeFromBlindMode(value: unknown): CanonicalCuppingMode {
  const legacy = normalizeBlindMode(value);
  if (legacy === "full_blind") return "blind";
  if (legacy === "semi_blind") return "semi_blind";
  return "timed";
}

export function normalizeCuppingMode(value: unknown, legacyBlindMode?: unknown): CanonicalCuppingMode {
  if (CUPPING_MODES.includes(value as CanonicalCuppingMode)) return value as CanonicalCuppingMode;
  // Historical metadata stored `open`; preserve its old timed behavior after upgrade.
  if (value === "open") return "timed";
  if (legacyBlindMode !== undefined) return cuppingModeFromBlindMode(legacyBlindMode);
  // New sessions default to the SCA formal route. Free cupping must be an explicit choice.
  return "formal";
}

export function legacyBlindModeFromCuppingMode(mode: CuppingMode): BlindMode {
  const canonical = normalizeCuppingMode(mode);
  if (canonical === "blind") return "full_blind";
  if (canonical === "semi_blind") return "semi_blind";
  return "open";
}

/** Runtime value is canonical; the wider return type keeps legacy callers source-compatible during migration. */
export function cuppingModeFromMetadata(metadata: Partial<CuppingSessionMetadata>): CuppingMode {
  return normalizeCuppingMode(metadata.cuppingMode, metadata.blindMode);
}

export function isCompetitionCupping(mode: CuppingMode): boolean {
  const canonical = normalizeCuppingMode(mode);
  return canonical === "competition" || canonical === "timed" || canonical === "blind" || canonical === "semi_blind";
}

export function competitionStarted(metadata: Partial<CuppingSessionMetadata>): boolean {
  return Boolean(normalizeOptional(metadata.competitionStartedAt));
}

export function competitionLocked(metadata: Partial<CuppingSessionMetadata>): boolean {
  return Boolean(normalizeOptional(metadata.competitionLockedAt));
}

export function cuppingProtocolFromMode(mode: CuppingMode): CuppingProtocol {
  return normalizeCuppingMode(mode) === "free" ? "aromasense_custom" : "sca_cva";
}

export function cuppingModeLabel(mode: CuppingMode): string {
  const canonical = normalizeCuppingMode(mode);
  if (canonical === "formal") return "正式杯测";
  if (canonical === "free") return "自由杯测";
  if (canonical === "competition") return "杯测赛";
  if (canonical === "timed") return "计时赛";
  if (canonical === "blind") return "盲测赛";
  return "半盲测赛";
}

/** Central runtime contract so timer, lock and edit permissions cannot drift between renderers/controllers. */
export function cuppingModePolicy(mode: CuppingMode): CuppingModePolicy {
  const canonical = normalizeCuppingMode(mode);
  const competition = isCompetitionCupping(canonical);
  return {
    timerEnabled: competition,
    runtimeRosterMutable: canonical === "free" || canonical === "formal",
    runtimeIdentityEditable: canonical === "free" || canonical === "formal",
    competition,
    completionLocks: competition,
    protocol: cuppingProtocolFromMode(canonical)
  };
}

export function normalizeSessionMetadata(value: Partial<CuppingSessionMetadata>): CuppingSessionMetadata {
  const date = String(value.date ?? "").trim();
  const time = String(value.time ?? "").trim();
  const organizer = String(value.organizer ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("CUPPING_DATE_REQUIRED");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("CUPPING_TIME_REQUIRED");
  if (!organizer) throw new Error("CUPPING_ORGANIZER_REQUIRED");
  // Records created before canonical cuppingMode existed have neither mode
  // field. Their historical behavior was the public timed route; preserve that
  // on read. New setup flows call defaultSessionMetadata(), which explicitly
  // writes `formal`, so this compatibility branch cannot change new defaults.
  const cuppingMode = value.cuppingMode === undefined && value.blindMode === undefined
    ? "timed"
    : normalizeCuppingMode(value.cuppingMode, value.blindMode);
  return {
    date,
    time,
    organizer,
    participants: normalizeOptional(value.participants),
    target: normalizeOptional(value.target),
    eventName: normalizeOptional(value.eventName),
    cuppingMode,
    semiBlindVisibleFields: normalizeFieldList(value.semiBlindVisibleFields),
    revealedAt: normalizeOptional(value.revealedAt),
    eventId: normalizeOptional(value.eventId),
    eventRevision: Number.isInteger(value.eventRevision) && Number(value.eventRevision) > 0 ? Number(value.eventRevision) : undefined,
    lowPrecisionLocation: normalizeLocation(value.lowPrecisionLocation),
    competitionStartedAt: normalizeOptional(value.competitionStartedAt),
    competitionLockedAt: normalizeOptional(value.competitionLockedAt),
    competitionSubmittedAt: normalizeOptional(value.competitionSubmittedAt),
    completedEditableAt: normalizeOptional(value.completedEditableAt),
    competitionTimeLimitSeconds: normalizePositiveInteger(value.competitionTimeLimitSeconds)
  };
}

export function defaultSessionMetadata(now: string): CuppingSessionMetadata {
  const date = new Date(now);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return {
    date: localDate.slice(0, 10),
    time: localDate.slice(11, 16),
    organizer: "",
    cuppingMode: "formal"
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
