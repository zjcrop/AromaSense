import { buildSampleBatch, type SampleDraftInput, type SampleIdFactory, type SampleRecord } from "./sample-batch-service";
import { createSession, type CuppingSession } from "./session-lifecycle";
import type { CuppingSessionMetadata } from "./session-metadata";
import type { LocalCuppingRepository } from "../storage/local-cupping-repository";

export interface CreateCuppingSetupInput {
  sessionId: string;
  title?: string;
  metadata: CuppingSessionMetadata;
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

  async create(input: CreateCuppingSetupInput): Promise<CreatedCuppingSetup> {
    if (input.samples.length === 0) throw new Error("AT_LEAST_ONE_SAMPLE_REQUIRED");
    const session = createSession({
      sessionId: input.sessionId,
      title: input.title,
      metadata: input.metadata,
      now: input.now
    });
    const samples = buildSampleBatch(session.sessionId, input.samples, input.now, input.sampleIdFactory);
    await this.repository.createSessionWithSamples(session, samples);
    return { session, samples };
  }
}
