import type { StageId, SensoryObservation } from "../../shared/protocol/aromasense-v1";
import { CuppingSessionController, type ActiveEditingState } from "../core/cupping-session-controller";
import type { RevisionCheckpointService } from "../core/revision-checkpoint-service";
import {
  buildSampleBatch,
  reorderSamples,
  sampleIndexFromMetadata,
  type SampleDraftInput,
  type SampleRecord
} from "../core/sample-batch-service";
import { activateSession, completeSession, type SessionStatus } from "../core/session-lifecycle";
import {
  cuppingModeFromMetadata,
  cuppingModePolicy,
  type CuppingSessionMetadata
} from "../core/session-metadata";
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

    // Navigation is a page-local operation. editor.open() loads exactly the
    // requested sample + stage slice, so re-reading the session, every stage
    // progress row and every observation here only adds latency. Those global
    // snapshots are refreshed by actual writes/completion/roster mutations.
    const active = await this.editor.open({ sessionId: state.sessionId, sampleId, stageId }, now);
    this.state = {
      ...state,
      rail: buildSampleRailViewState(state.samples, state.progress, active.context.sampleId, {
        metadata: state.sessionMetadata,
        status: state.sessionStatus
      }),
      active
    };
    return this.state;
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
    if (!cuppingModePolicy(cuppingModeFromMetadata(state.sessionMetadata)).runtimeIdentityEditable) {
      throw new Error("TIMED_CUPPING_SAMPLE_IDENTITY_LOCKED");
    }
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
    return this.reloadRosterState(samples, active);
  }

  async pauseEditing(): Promise<CuppingScreenState> {
    const state = this.requireState();
    this.assertRosterMutable(state);
    await this.editor.close();
    const progress = await this.progressReader.listForSession(state.sessionId);
    this.state = {
      ...state,
      progress,
      rail: buildSampleRailViewState(state.samples, progress, undefined, {
        metadata: state.sessionMetadata,
        status: state.sessionStatus
      }),
      active: undefined
    };
    return this.state;
  }

  async addSample(sampleId: string, draft: SampleDraftInput, now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    this.assertRosterMutable(state);
    await this.editor.flush();
    if (state.samples.some((sample) => sample.sampleId === sampleId)) throw new Error(`DUPLICATE_SAMPLE_ID:${sampleId}`);

    const nextSampleIndex = state.samples.reduce((max, sample) => {
      const value = sampleIndexFromMetadata(sample.metadata);
      return value === undefined ? max : Math.max(max, value + 1);
    }, state.samples.length);
    const built = buildSampleBatch(
      state.sessionId,
      [{ ...draft, metadata: { ...(draft.metadata ?? {}), sampleIndex: nextSampleIndex } }],
      now,
      () => sampleId
    )[0]!;
    const nextPosition = state.samples.length + 1;
    const sample: SampleRecord = { ...built, displayNumber: nextPosition, sortOrder: nextPosition };
    const samples = await this.repository.addSample(sample);
    return this.reloadRosterState(samples, this.editor.current());
  }

  async deleteSample(sampleId: string, now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    this.assertRosterMutable(state);
    if (state.lockedSampleIds.includes(sampleId)) throw new Error("SAMPLE_SCORE_LOCKED");
    if (!state.samples.some((sample) => sample.sampleId === sampleId)) throw new Error(`UNKNOWN_SAMPLE_ID:${sampleId}`);
    await this.editor.close();
    const samples = await this.repository.deleteSample(state.sessionId, sampleId, now);
    return this.reloadRosterState(samples, undefined);
  }

  async completeStage(now: string): Promise<CuppingScreenState> {
    const active = await this.editor.completeActiveStage(now);
    await this.revisions?.checkpointStage(active.context.sessionId, active.context.sampleId, active.context.stageId, now);
    return this.refreshState(active);
  }

  async reorderSampleIds(orderedSampleIds: readonly string[], now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    this.assertRosterMutable(state);
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
    if (!state.samples.length) return false;
    const scoreConfirmed = new Set(state.lockedSampleIds);
    return state.samples.every((sample) => scoreConfirmed.has(sample.sampleId));
  }

  async finishSession(now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    if (!this.canFinishSession()) throw new Error("ALL_SAMPLE_FINAL_SCORES_REQUIRED");
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

  private assertRosterMutable(state: CuppingScreenState): void {
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    if (!cuppingModePolicy(cuppingModeFromMetadata(state.sessionMetadata)).runtimeRosterMutable) {
      throw new Error("CUPPING_ROSTER_LOCKED");
    }
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

  private async reloadRosterState(
    samples: readonly SampleRecord[],
    active: ActiveEditingState | undefined
  ): Promise<CuppingScreenState> {
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
      samples,
      progress,
      lockedSampleIds: sampleLockIds(observations),
      rail: buildSampleRailViewState(samples, progress, active?.context.sampleId, {
        metadata: session.metadata,
        status: session.status
      }),
      active
    };
    return this.state;
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
