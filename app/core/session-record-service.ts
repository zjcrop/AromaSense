import type { LocalCuppingRepository } from "../storage/local-cupping-repository";

export interface CuppingRecordSnapshot {
  version: "AromaSense-0.1C";
  exportedAt: string;
  session: Awaited<ReturnType<LocalCuppingRepository["getSession"]>>;
  samples: Awaited<ReturnType<LocalCuppingRepository["listSamples"]>>;
  observations: Awaited<ReturnType<LocalCuppingRepository["listObservationsForSession"]>>;
}

export class SessionRecordService {
  constructor(
    private readonly repository: LocalCuppingRepository,
    private readonly now: () => string
  ) {}

  async snapshot(sessionId: string): Promise<CuppingRecordSnapshot> {
    const [session, samples, observations] = await Promise.all([
      this.repository.getSession(sessionId),
      this.repository.listSamples(sessionId),
      this.repository.listObservationsForSession(sessionId)
    ]);
    return { version: "AromaSense-0.1C", exportedAt: this.now(), session, samples, observations };
  }

  async delete(sessionId: string): Promise<void> {
    await this.repository.deleteSession(sessionId);
  }
}
