import type { StageId } from "../../shared/protocol/aromasense-v1";
import type { SQLiteDriver, LocalCuppingRepository } from "../storage/local-cupping-repository";
import type { SyncQueueStore } from "../storage/sync-queue-store";
import { buildRevision } from "./revision-builder";

export interface RevisionIdentityFactory {
  revisionId(): string;
  queueId(): string;
}

export class RevisionCheckpointService {
  constructor(
    private readonly db: SQLiteDriver,
    private readonly repository: LocalCuppingRepository,
    private readonly queue: SyncQueueStore,
    private readonly ids: RevisionIdentityFactory
  ) {}

  async checkpointStage(sessionId: string, sampleId: string, stageId: StageId, now: string): Promise<string> {
    const [session, samples, observations, stageStates] = await Promise.all([
      this.repository.getSession(sessionId),
      this.repository.listSamples(sessionId),
      this.repository.listObservationsForStage(sampleId, stageId),
      this.repository.listStageStates(sessionId)
    ]);
    const sample = samples.find((item) => item.sampleId === sampleId);
    if (!sample) throw new Error(`SAMPLE_NOT_FOUND:${sampleId}`);
    const stageState = stageStates.find((item) => item.sampleId === sampleId && item.stageId === stageId);
    const sequence = await this.nextSequence(sessionId);
    const revision = await buildRevision({
      revisionId: this.ids.revisionId(),
      revisionKind: "checkpoint",
      sessionId,
      sampleId,
      stageId,
      sequence,
      createdAt: now,
      payload: {
        taxonomyVersion: session.taxonomyVersion,
        sessionStatus: session.status,
        sessionStartedAt: session.startedAt ?? null,
        sample: {
          sampleId: sample.sampleId,
          displayNumber: sample.displayNumber,
          sortOrder: sample.sortOrder,
          label: sample.label ?? null,
          metadata: sample.metadata
        },
        stageState: stageState ?? null,
        observations
      }
    });
    await this.queue.enqueue(revision, this.ids.queueId(), now);
    return revision.revisionId;
  }

  async finalSession(sessionId: string, now: string): Promise<string> {
    const session = await this.repository.getSession(sessionId);
    if (session.status !== "completed") throw new Error("SESSION_MUST_BE_COMPLETED_BEFORE_FINAL_REVISION");
    const [samples, observations, stageStates] = await Promise.all([
      this.repository.listSamples(sessionId),
      this.repository.listObservationsForSession(sessionId),
      this.repository.listStageStates(sessionId)
    ]);
    const sequence = await this.nextSequence(sessionId);
    const revision = await buildRevision({
      revisionId: this.ids.revisionId(),
      revisionKind: "final",
      sessionId,
      sequence,
      createdAt: now,
      payload: {
        session,
        samples,
        stageStates,
        observations
      }
    });
    await this.queue.enqueue(revision, this.ids.queueId(), now);
    return revision.revisionId;
  }

  private async nextSequence(sessionId: string): Promise<number> {
    const row = await this.db.get<{ max_sequence: number | null }>(
      `SELECT MAX(sequence) AS max_sequence FROM revisions WHERE session_id = ?`, [sessionId]
    );
    return (row?.max_sequence ?? -1) + 1;
  }
}
