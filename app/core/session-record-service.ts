import type { LocalCuppingRepository } from "../storage/local-cupping-repository";

export interface CuppingRecordSnapshot {
  version: "AromaSense-B0.2.a";
  exportedAt: string;
  session: Awaited<ReturnType<LocalCuppingRepository["getSession"]>>;
  samples: Awaited<ReturnType<LocalCuppingRepository["listSamples"]>>;
  observations: Awaited<ReturnType<LocalCuppingRepository["listObservationsForSession"]>>;
  stageStates: Awaited<ReturnType<LocalCuppingRepository["listStageStates"]>>;
}

export class SessionRecordService {
  constructor(
    private readonly repository: LocalCuppingRepository,
    private readonly now: () => string
  ) {}

  async snapshot(sessionId: string): Promise<CuppingRecordSnapshot> {
    const [session, samples, observations, stageStates] = await Promise.all([
      this.repository.getSession(sessionId),
      this.repository.listSamples(sessionId),
      this.repository.listObservationsForSession(sessionId),
      this.repository.listStageStates(sessionId)
    ]);
    return { version: "AromaSense-B0.2.a", exportedAt: this.now(), session, samples, observations, stageStates };
  }

  async delete(sessionId: string): Promise<void> {
    await this.repository.deleteSession(sessionId);
  }
}
