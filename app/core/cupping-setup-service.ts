import { buildSampleBatch, type SampleDraftInput, type SampleIdFactory, type SampleRecord } from "./sample-batch-service";
import { createSession, type CuppingSession } from "./session-lifecycle";
import type { CuppingSessionMetadata } from "./session-metadata";
import type { LocalCuppingRepository } from "../storage/local-cupping-repository";

export interface CreateCuppingSetupInput {
  sessionId: string;
  title?: string;
  metadata?: CuppingSessionMetadata;
  samples: readonly SampleDraftInput[];
  now: string;
  sampleIdFactory: SampleIdFactory;
}

export interface CreatedCuppingSetup {
  session: CuppingSession;
  samples: readonly SampleRecord[];
}

export class CuppingSetupService {
  constructor(private readonly repository: LocalCuppingRepository) {}

  private prepare(input: CreateCuppingSetupInput): CreatedCuppingSetup {
    if (input.samples.length === 0) throw new Error("AT_LEAST_ONE_SAMPLE_REQUIRED");
    const session = createSession({
      sessionId: input.sessionId,
      title: input.title,
      metadata: input.metadata,
      now: input.now
    });
    const samples = buildSampleBatch(session.sessionId, input.samples, input.now, input.sampleIdFactory);
    return { session, samples };
  }

  async create(input: CreateCuppingSetupInput): Promise<CreatedCuppingSetup> {
    const prepared = this.prepare(input);
    await this.repository.createSessionWithSamples(prepared.session, prepared.samples);
    return prepared;
  }

  /**
   * Creates all imported cupping groups under one outer SQLite transaction.
   * The repository/drivers use savepoints for nested calls, so any failure in
   * any group rolls the entire bundle back instead of leaving a partial import.
   */
  async createMany(inputs: readonly CreateCuppingSetupInput[]): Promise<readonly CreatedCuppingSetup[]> {
    if (!inputs.length) throw new Error("AT_LEAST_ONE_SESSION_REQUIRED");
    const prepared = inputs.map((input) => this.prepare(input));
    const sessionIds = new Set<string>();
    const sampleIds = new Set<string>();
    for (const group of prepared) {
      if (sessionIds.has(group.session.sessionId)) throw new Error(`DUPLICATE_SESSION_ID:${group.session.sessionId}`);
      sessionIds.add(group.session.sessionId);
      for (const sample of group.samples) {
        if (sampleIds.has(sample.sampleId)) throw new Error(`DUPLICATE_SAMPLE_ID_ACROSS_IMPORT:${sample.sampleId}`);
        sampleIds.add(sample.sampleId);
      }
    }
    await this.repository.transaction(async () => {
      for (const group of prepared) await this.repository.createSessionWithSamples(group.session, group.samples);
    });
    return prepared;
  }
}
