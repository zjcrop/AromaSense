import type { StageId, SensoryObservation } from "../../shared/protocol/aromasense-v1";
import { CuppingSessionController, type ActiveEditingState } from "../core/cupping-session-controller";
import type { RevisionCheckpointService } from "../core/revision-checkpoint-service";
import { reorderSamples, type SampleRecord } from "../core/sample-batch-service";
import { activateSession, completeSession, type SessionStatus } from "../core/session-lifecycle";
import type { CuppingSessionMetadata } from "../core/session-metadata";
import type { LocalCuppingRepository } from "../storage/local-cupping-repository";
import type { SampleStageProgress, StageProgressReader } from "../storage/stage-progress-reader";
import { buildSampleRailViewState, nextStage, previousStage, type SampleRailItemViewState } from "./cupping-view-model";

export interface CuppingScreenState {
  sessionId: string;
  sessionStatus: SessionStatus;
  sessionMetadata: CuppingSessionMetadata;
  sessionStartedAt?: string;
  sessionCompletedAt?: string;
  samples: readonly SampleRecord[];
  progress: readonly SampleStageProgress[];
  lockedSampleIds: readonly string[];
  rail: readonly SampleRailItemViewState[];
  active?: ActiveEditingState;
  finalRevisionId?: string;
}

function sampleLockIds(observations: readonly SensoryObservation[]): string[] {
  const locked = new Set<string>();
  for (const observation of observations) {
    if (observation.value !== true) continue;
    if (observation.fieldKey === "score_confirmed" || observation.fieldKey === "final_score_confirmed") locked.add(observation.sampleId);
  }
  return [...locked];
}

export class CuppingScreenController {
  private state?: CuppingScreenState;

  constructor(
    private readonly repository: LocalCuppingRepository,
    private readonly progressReader: StageProgressReader,
    private readonly editor: CuppingSessionController,
    private readonly revisions?: RevisionCheckpointService
  ) {}

  current(): CuppingScreenState | undefined { return this.state; }

  async initialize(sessionId: string, now: string): Promise<CuppingScreenState> {
    let session = await this.repository.getSession(sessionId);
    if (session.status === "draft" || (session.status === "active" && !session.startedAt)) {
      session = activateSession(session, now);
      await this.repository.saveSession(session);
    }
    const [samples, progress, observations] = await Promise.all([
      this.repository.listSamples(sessionId),
      this.progressReader.listForSession(sessionId),
      this.repository.listObservationsForSession(sessionId)
    ]);
    this.state = {
      sessionId,
      sessionStatus: session.status,
      sessionMetadata: session.metadata,
      sessionStartedAt: session.startedAt,
      sessionCompletedAt: session.completedAt,
      samples,
      progress,
      lockedSampleIds: sampleLockIds(observations),
      rail: buildSampleRailViewState(samples, progress, undefined, { metadata: session.metadata, status: session.status })
    };
    return this.state;
  }

  async select(sampleId: string, stageId: StageId, now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    const sample = state.samples.find((item) => item.sampleId === sampleId);
    if (!sample) throw new Error(`UNKNOWN_SAMPLE_ID:${sampleId}`);
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    const active = await this.editor.open({ sessionId: state.sessionId, sampleId, stageId }, now);
    return this.refreshState(active);
  }

  async saveField(fieldKey: string, value: unknown, now: string): Promise<CuppingScreenState> {
    const activeBefore = this.requireActive();
    const state = this.requireState();
    if (state.lockedSampleIds.includes(activeBefore.context.sampleId)) throw new Error("SAMPLE_SCORE_LOCKED");
    await this.editor.saveField(fieldKey, value, now);
    const active = this.editor.current();
    if (!active) throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    return this.refreshState(active);
  }

  async saveSampleIdentity(
    sampleId: string,
    label: string | undefined,
    metadataPatch: Readonly<Record<string, unknown>>,
    now: string
  ): Promise<CuppingScreenState> {
    const state = this.requireState();
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    if (state.lockedSampleIds.includes(sampleId)) throw new Error("SAMPLE_SCORE_LOCKED");
    const sample = state.samples.find((item) => item.sampleId === sampleId);
    if (!sample) throw new Error(`UNKNOWN_SAMPLE_ID:${sampleId}`);

    await this.editor.flush();
    const metadata = { ...sample.metadata };
    for (const [key, value] of Object.entries(metadataPatch)) {
      if (typeof value === "string") {
        const normalized = value.trim();
        if (normalized) metadata[key] = normalized;
        else delete metadata[key];
      } else if (value === undefined || value === null) {
        delete metadata[key];
      } else {
        metadata[key] = value;
      }
    }

    const saved = await this.repository.saveSampleIdentity(state.sessionId, sampleId, label, metadata, now);
    const samples = state.samples.map((item) => item.sampleId === sampleId ? saved : item);
    let active = this.editor.current();
    if (active?.context.sampleId === sampleId) active = await this.editor.refresh();
    const [progress, observations] = await Promise.all([
      this.progressReader.listForSession(state.sessionId),
      this.repository.listObservationsForSession(state.sessionId)
    ]);
    this.state = {
      ...state,
      samples,
      progress,
      lockedSampleIds: sampleLockIds(observations),
      rail: buildSampleRailViewState(samples, progress, active?.context.sampleId, {
        metadata: state.sessionMetadata,
        status: state.sessionStatus
      }),
      active
    };
    return this.state;
  }

  async completeStage(now: string): Promise<CuppingScreenState> {
    const active = await this.editor.completeActiveStage(now);
    await this.revisions?.checkpointStage(active.context.sessionId, active.context.sampleId, active.context.stageId, now);
    return this.refreshState(active);
  }

  async reorderSampleIds(orderedSampleIds: readonly string[], now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    await this.editor.flush();
    const reordered = reorderSamples(state.samples, orderedSampleIds, now);
    await this.repository.replaceSampleOrder(state.sessionId, reordered);
    const progress = await this.progressReader.listForSession(state.sessionId);
    const activeSampleId = this.editor.current()?.context.sampleId;
    this.state = {
      ...state,
      samples: reordered,
      progress,
      rail: buildSampleRailViewState(reordered, progress, activeSampleId, {
        metadata: state.sessionMetadata,
        status: state.sessionStatus
      })
    };
    return this.state;
  }

  async goNext(now: string): Promise<CuppingScreenState> {
    const activeBeforeCompletion = this.requireActive();
    const stageId = nextStage(activeBeforeCompletion.context.stageId);
    const sampleId = activeBeforeCompletion.context.sampleId;
    await this.completeStage(now);
    if (!stageId) return this.requireState();
    return this.select(sampleId, stageId, now);
  }

  async goPrevious(now: string): Promise<CuppingScreenState> {
    const active = this.requireActive();
    const stageId = previousStage(active.context.stageId);
    if (!stageId) return this.requireState();
    return this.select(active.context.sampleId, stageId, now);
  }

  async leaveSession(): Promise<CuppingScreenState> {
    await this.editor.flush();
    return this.requireState();
  }

  canFinishSession(): boolean {
    const state = this.requireState();
    return state.samples.length > 0
      && state.rail.every((item) => item.stages.length > 0 && item.stages.every((stage) => stage.status === "completed"));
  }

  async finishSession(now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    if (!this.canFinishSession()) throw new Error("ALL_SAMPLE_STAGES_REQUIRED");
    await this.editor.flush();
    const session = await this.repository.getSession(state.sessionId);
    const completed = completeSession(session, now);
    await this.repository.saveSession(completed);
    const finalRevisionId = await this.revisions?.finalSession(state.sessionId, now);
    const [progress, observations] = await Promise.all([
      this.progressReader.listForSession(state.sessionId),
      this.repository.listObservationsForSession(state.sessionId)
    ]);
    this.state = {
      ...state,
      sessionStatus: completed.status,
      sessionMetadata: completed.metadata,
      sessionStartedAt: completed.startedAt,
      sessionCompletedAt: completed.completedAt,
      progress,
      lockedSampleIds: sampleLockIds(observations),
      rail: buildSampleRailViewState(state.samples, progress, undefined, {
        metadata: completed.metadata,
        status: completed.status
      }),
      active: undefined,
      finalRevisionId
    };
    return this.state;
  }

  private requireState(): CuppingScreenState {
    if (!this.state) throw new Error("CUPPING_SCREEN_NOT_INITIALIZED");
    return this.state;
  }

  private requireActive(): ActiveEditingState {
    const active = this.editor.current();
    if (!active) throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    return active;
  }

  private async refreshState(active: ActiveEditingState): Promise<CuppingScreenState> {
    const state = this.requireState();
    const [session, progress, observations] = await Promise.all([
      this.repository.getSession(state.sessionId),
      this.progressReader.listForSession(state.sessionId),
      this.repository.listObservationsForSession(state.sessionId)
    ]);
    this.state = {
      ...state,
      sessionStatus: session.status,
      sessionMetadata: session.metadata,
      sessionStartedAt: session.startedAt,
      sessionCompletedAt: session.completedAt,
      progress,
      lockedSampleIds: sampleLockIds(observations),
      rail: buildSampleRailViewState(state.samples, progress, active.context.sampleId, {
        metadata: session.metadata,
        status: session.status
      }),
      active
    };
    return this.state;
  }
}