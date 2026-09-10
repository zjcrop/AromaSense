import type { StageId } from "../../shared/protocol/aromasense-v1";
import { CuppingSessionController, type ActiveEditingState } from "../core/cupping-session-controller";
import type { RevisionCheckpointService } from "../core/revision-checkpoint-service";
import {
  buildSampleBatch,
  reorderSamples,
  sampleIndexFromMetadata,
  type SampleDraftInput,
  type SampleRecord
} from "../core/sample-batch-service";
import {
  activateSession,
  completeSession,
  updateSessionMetadata,
  type SessionStatus
} from "../core/session-lifecycle";
import {
  competitionStarted,
  cuppingModeFromMetadata,
  cuppingModePolicy,
  isCompetitionCupping,
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
  /** Compatibility field: only whole-session competition locks populate this now. */
  lockedSampleIds: readonly string[];
  rail: readonly SampleRailItemViewState[];
  active?: ActiveEditingState;
  finalRevisionId?: string;
}

export interface CompetitionMissingCell {
  sampleId: string;
  displayNumber: number;
  stageId: StageId;
  stageLabel: string;
}

export interface CompetitionCompletionSummary {
  total: number;
  completed: number;
  missing: readonly CompetitionMissingCell[];
}

function lockedSamples(state: Pick<CuppingScreenState, "sessionStatus" | "sessionMetadata" | "samples">): readonly string[] {
  const mode = cuppingModeFromMetadata(state.sessionMetadata);
  if (!isCompetitionCupping(mode)) return [];
  if (state.sessionStatus !== "completed" && !state.sessionMetadata.competitionLockedAt) return [];
  return state.samples.map((sample) => sample.sampleId);
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

  async initialize(sessionId: string, _now: string): Promise<CuppingScreenState> {
    const session = await this.repository.getSession(sessionId);
    const [samples, progress] = await Promise.all([
      this.repository.listSamples(sessionId),
      this.progressReader.listForSession(sessionId)
    ]);
    const base = {
      sessionId,
      sessionStatus: session.status,
      sessionMetadata: session.metadata,
      sessionStartedAt: session.startedAt,
      sessionCompletedAt: session.completedAt,
      samples,
      progress
    };
    this.state = {
      ...base,
      lockedSampleIds: lockedSamples({ ...base, samples }),
      rail: buildSampleRailViewState(samples, progress, undefined, { metadata: session.metadata, status: session.status })
    };
    return this.state;
  }

  async startCompetition(now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    if (!isCompetitionCupping(mode)) throw new Error("SESSION_IS_NOT_COMPETITION");
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    if (competitionStarted(state.sessionMetadata)) return state;

    await this.editor.flush();
    let session = await this.repository.getSession(state.sessionId);
    const metadata: CuppingSessionMetadata = {
      ...session.metadata,
      competitionStartedAt: now,
      competitionLockedAt: undefined,
      competitionSubmittedAt: undefined,
      completedEditableAt: undefined
    };
    session = updateSessionMetadata(session, metadata, now);
    session = activateSession(session, now);
    await this.repository.saveSession(session);
    this.state = {
      ...state,
      sessionStatus: session.status,
      sessionMetadata: session.metadata,
      sessionStartedAt: session.startedAt,
      sessionCompletedAt: session.completedAt,
      lockedSampleIds: [],
      rail: buildSampleRailViewState(state.samples, state.progress, state.active?.context.sampleId, {
        metadata: session.metadata,
        status: session.status
      })
    };
    return this.state;
  }

  async select(sampleId: string, stageId: StageId, now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    const sample = state.samples.find((item) => item.sampleId === sampleId);
    if (!sample) throw new Error(`UNKNOWN_SAMPLE_ID:${sampleId}`);
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    if (isCompetitionCupping(cuppingModeFromMetadata(state.sessionMetadata)) && !competitionStarted(state.sessionMetadata)) {
      throw new Error("COMPETITION_NOT_STARTED");
    }

    // Navigation itself does not start a normal/free session. The session start
    // anchor is written on the first meaningful sensory write, or atomically by
    // startCompetition() for competition modes.
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
    let state = this.requireState();
    if (state.lockedSampleIds.includes(activeBefore.context.sampleId)) throw new Error("COMPETITION_SCORE_LOCKED");
    state = await this.ensureStartedForInput(now);
    const beforeStatus = activeBefore.slice.stageStatus;
    await this.editor.saveField(fieldKey, value, now);
    const active = this.editor.current();
    if (!active) throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    if (beforeStatus !== "completed" && active.slice.stageStatus === "completed") {
      await this.revisions?.checkpointStage(active.context.sessionId, active.context.sampleId, active.context.stageId, now);
    }
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
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    const policy = cuppingModePolicy(mode);
    const competitionMayEdit = policy.competition && !competitionStarted(state.sessionMetadata);
    if (!policy.runtimeIdentityEditable && !competitionMayEdit) throw new Error("CUPPING_SAMPLE_IDENTITY_LOCKED");
    if (state.lockedSampleIds.includes(sampleId)) throw new Error("COMPETITION_SCORE_LOCKED");
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
    if (state.lockedSampleIds.includes(sampleId)) throw new Error("COMPETITION_SCORE_LOCKED");
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
    const active = this.requireActive();
    const stageId = nextStage(active.context.stageId);
    if (!stageId) return this.requireState();
    return this.select(active.context.sampleId, stageId, now);
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
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    return !isCompetitionCupping(mode) || competitionStarted(state.sessionMetadata);
  }

  competitionCompletionSummary(): CompetitionCompletionSummary {
    const state = this.requireState();
    const missing: CompetitionMissingCell[] = [];
    let total = 0;
    let completed = 0;
    for (const sample of state.rail) {
      for (const stage of sample.stages) {
        total += 1;
        if (stage.status === "completed") completed += 1;
        else missing.push({
          sampleId: sample.sampleId,
          displayNumber: sample.displayNumber,
          stageId: stage.stageId,
          stageLabel: stage.label
        });
      }
    }
    return { total, completed, missing };
  }

  async finishSession(now: string): Promise<CuppingScreenState> {
    let state = this.requireState();
    if (!this.canFinishSession()) throw new Error("SESSION_CANNOT_FINISH");
    await this.editor.flush();
    let session = await this.repository.getSession(state.sessionId);
    const mode = cuppingModeFromMetadata(session.metadata);
    const competition = isCompetitionCupping(mode);

    if (!competition) {
      // Ordinary/formal/free completion is a user milestone, not a lock. Keep the
      // session editable and resumable; a later edit does not require unlock.
      if (session.status === "draft") session = activateSession(session, now);
      session = updateSessionMetadata(session, { ...session.metadata, completedEditableAt: now }, now);
      await this.repository.saveSession(session);
      state = {
        ...state,
        sessionStatus: session.status,
        sessionMetadata: session.metadata,
        sessionStartedAt: session.startedAt,
        sessionCompletedAt: undefined,
        lockedSampleIds: [],
        rail: buildSampleRailViewState(state.samples, state.progress, state.active?.context.sampleId, {
          metadata: session.metadata,
          status: session.status
        }),
        finalRevisionId: undefined
      };
      this.state = state;
      return state;
    }

    if (!competitionStarted(session.metadata)) throw new Error("COMPETITION_NOT_STARTED");
    session = updateSessionMetadata(session, { ...session.metadata, competitionLockedAt: now }, now);
    const completed = completeSession(session, now);
    await this.repository.saveSession(completed);
    const finalRevisionId = await this.revisions?.finalSession(state.sessionId, now);
    const progress = await this.progressReader.listForSession(state.sessionId);
    this.state = {
      ...state,
      sessionStatus: completed.status,
      sessionMetadata: completed.metadata,
      sessionStartedAt: completed.startedAt,
      sessionCompletedAt: completed.completedAt,
      progress,
      lockedSampleIds: state.samples.map((sample) => sample.sampleId),
      rail: buildSampleRailViewState(state.samples, progress, undefined, {
        metadata: completed.metadata,
        status: completed.status
      }),
      active: undefined,
      finalRevisionId
    };
    return this.state;
  }

  private async ensureStartedForInput(now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    if (isCompetitionCupping(mode)) {
      if (!competitionStarted(state.sessionMetadata)) throw new Error("COMPETITION_NOT_STARTED");
      return state;
    }
    if (state.sessionStatus === "active" && state.sessionStartedAt) return state;
    if (state.sessionStatus !== "draft" && state.sessionStatus !== "active") return state;
    let session = await this.repository.getSession(state.sessionId);
    session = activateSession(session, now);
    await this.repository.saveSession(session);
    this.state = {
      ...state,
      sessionStatus: session.status,
      sessionMetadata: session.metadata,
      sessionStartedAt: session.startedAt,
      sessionCompletedAt: session.completedAt,
      rail: buildSampleRailViewState(state.samples, state.progress, state.active?.context.sampleId, {
        metadata: session.metadata,
        status: session.status
      })
    };
    return this.state;
  }

  private assertRosterMutable(state: CuppingScreenState): void {
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    const policy = cuppingModePolicy(mode);
    if (policy.competition) {
      if (competitionStarted(state.sessionMetadata)) throw new Error("CUPPING_ROSTER_LOCKED");
      return;
    }
    if (!policy.runtimeRosterMutable) throw new Error("CUPPING_ROSTER_LOCKED");
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
    const [session, progress] = await Promise.all([
      this.repository.getSession(state.sessionId),
      this.progressReader.listForSession(state.sessionId)
    ]);
    const base = {
      ...state,
      sessionStatus: session.status,
      sessionMetadata: session.metadata,
      sessionStartedAt: session.startedAt,
      sessionCompletedAt: session.completedAt,
      samples,
      progress
    };
    this.state = {
      ...base,
      lockedSampleIds: lockedSamples({ ...base, samples }),
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
    const [session, progress] = await Promise.all([
      this.repository.getSession(state.sessionId),
      this.progressReader.listForSession(state.sessionId)
    ]);
    const base = {
      ...state,
      sessionStatus: session.status,
      sessionMetadata: session.metadata,
      sessionStartedAt: session.startedAt,
      sessionCompletedAt: session.completedAt,
      progress
    };
    this.state = {
      ...base,
      lockedSampleIds: lockedSamples({ ...base, samples: state.samples }),
      rail: buildSampleRailViewState(state.samples, progress, active.context.sampleId, {
        metadata: session.metadata,
        status: session.status
      }),
      active
    };
    return this.state;
  }
}
