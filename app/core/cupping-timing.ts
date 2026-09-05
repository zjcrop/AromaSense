export interface CuppingCompletionTiming {
  elapsedSeconds: number;
  minutes: number;
  seconds: number;
  elapsedLabel: string;
  clockLabel: string;
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function cuppingElapsedSeconds(startedAt: string | undefined, endedAt: string | undefined): number {
  const start = parseTime(startedAt);
  const end = parseTime(endedAt);
  if (start === undefined || end === undefined) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function formatCuppingDuration(totalSeconds: number): { minutes: number; seconds: number; label: string } {
  const normalized = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const minutes = Math.floor(normalized / 60);
  const seconds = normalized % 60;
  return {
    minutes,
    seconds,
    label: `${minutes}分 ${String(seconds).padStart(2, "0")}秒`
  };
}

export function formatCuppingClock(isoTime: string | undefined): string {
  const timestamp = parseTime(isoTime);
  if (timestamp === undefined) return "--:--";
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function cuppingCompletionTiming(startedAt: string | undefined, completedAt: string | undefined): CuppingCompletionTiming | undefined {
  if (!startedAt || !completedAt) return undefined;
  const elapsedSeconds = cuppingElapsedSeconds(startedAt, completedAt);
  const duration = formatCuppingDuration(elapsedSeconds);
  return {
    elapsedSeconds,
    minutes: duration.minutes,
    seconds: duration.seconds,
    elapsedLabel: duration.label,
    clockLabel: formatCuppingClock(completedAt)
  };
}
