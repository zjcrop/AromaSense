export interface SampleDraftInput {
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface SampleRecord {
  sampleId: string;
  sessionId: string;
  displayNumber: number;
  sortOrder: number;
  label?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type SampleIdFactory = (index: number, input: SampleDraftInput) => string;

/** Capture identity never derives from the current rail/display order. */
export function sampleIndexFromMetadata(metadata: Record<string, unknown>): number | undefined {
  const value = metadata.sampleIndex;
  const index = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function assertUniqueIds(samples: readonly SampleRecord[]): void {
  const ids = new Set<string>();
  for (const sample of samples) {
    if (ids.has(sample.sampleId)) {
      throw new Error(`DUPLICATE_SAMPLE_ID:${sample.sampleId}`);
    }
    ids.add(sample.sampleId);
  }
}

export function buildSampleBatch(
  sessionId: string,
  inputs: readonly SampleDraftInput[],
  now: string,
  idFactory: SampleIdFactory
): readonly SampleRecord[] {
  if (!sessionId.trim()) {
    throw new Error("SESSION_ID_REQUIRED");
  }
  if (inputs.length === 0) {
    return [];
  }

  const samples = inputs.map((input, index): SampleRecord => ({
    sampleId: idFactory(index, input),
    sessionId,
    displayNumber: index + 1,
    sortOrder: index + 1,
    label: cleanOptionalText(input.label),
    metadata: { ...(input.metadata ?? {}), sampleIndex: sampleIndexFromMetadata(input.metadata ?? {}) ?? index },
    createdAt: now,
    updatedAt: now
  }));

  assertUniqueIds(samples);
  if (samples.some((sample) => !sample.sampleId.trim())) {
    throw new Error("SAMPLE_ID_REQUIRED");
  }

  return samples;
}

export function reorderSamples(
  samples: readonly SampleRecord[],
  orderedSampleIds: readonly string[],
  now: string
): readonly SampleRecord[] {
  assertUniqueIds(samples);

  if (orderedSampleIds.length !== samples.length) {
    throw new Error("SAMPLE_ORDER_LENGTH_MISMATCH");
  }

  const byId = new Map(samples.map((sample) => [sample.sampleId, sample] as const));
  const seen = new Set<string>();

  return orderedSampleIds.map((sampleId, index) => {
    if (seen.has(sampleId)) {
      throw new Error(`DUPLICATE_SAMPLE_IN_ORDER:${sampleId}`);
    }
    seen.add(sampleId);

    const sample = byId.get(sampleId);
    if (!sample) {
      throw new Error(`UNKNOWN_SAMPLE_ID:${sampleId}`);
    }

    return {
      ...sample,
      sortOrder: index + 1,
      updatedAt: sample.sortOrder === index + 1 ? sample.updatedAt : now
    };
  });
}

export function moveSample(
  samples: readonly SampleRecord[],
  sampleId: string,
  targetIndex: number,
  now: string
): readonly SampleRecord[] {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= samples.length) {
    throw new Error("TARGET_INDEX_OUT_OF_RANGE");
  }

  const ordered = [...samples].sort((a, b) => a.sortOrder - b.sortOrder);
  const sourceIndex = ordered.findIndex((sample) => sample.sampleId === sampleId);
  if (sourceIndex < 0) {
    throw new Error(`UNKNOWN_SAMPLE_ID:${sampleId}`);
  }

  const [moved] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, moved);

  return reorderSamples(
    ordered,
    ordered.map((sample) => sample.sampleId),
    now
  );
}
