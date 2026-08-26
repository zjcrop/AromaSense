export interface CuppingSessionMetadata {
  date: string;
  time: string;
  organizer: string;
  participants?: string;
  target?: string;
  eventName?: string;
}

function normalizeOptional(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
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
    eventName: normalizeOptional(value.eventName)
  };
}

export function defaultSessionMetadata(now: string): CuppingSessionMetadata {
  const date = new Date(now);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return {
    date: localDate.slice(0, 10),
    time: localDate.slice(11, 16),
    organizer: ""
  };
}

export function sessionDisplayName(metadata: Partial<CuppingSessionMetadata>, title?: string): string {
  const eventName = normalizeOptional(metadata.eventName);
  if (eventName) return eventName;
  const organizer = normalizeOptional(metadata.organizer);
  const target = normalizeOptional(metadata.target);
  const combined = [organizer, target].filter(Boolean).join(" · ");
  return combined || normalizeOptional(title) || "未命名杯测";
}
