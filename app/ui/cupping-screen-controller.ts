import type { StageId } from "../../shared/protocol/aromasense-v1";
import { CuppingSessionController, type ActiveEditingState } from "../core/cupping-session-controller";
import type { RevisionCheckpointService } from "../core/revision-checkpoint-service";
import { reorderSamples, type SampleRecord } from "../core/sample-batch-service";
import { activateSession, completeSession, type SessionStatus } from "../core/session-lifecycle";
import type { LocalCuppingRepository } from "../storage/local-cupping-repository";
import type { StageProgressReader } from "../storage/stage-progress-reader";
import { buildSampleRailViewState, nextStage, previousStage, type SampleRailItemViewState } from "./cupping-view-model";
import { voicePromptForStage, type VoicePromptEvent } from "./voice-prompt-events";

export interface CuppingScreenState {
  sessionId: string;
  sessionStatus: SessionStatus;
  samples: readonly SampleRecord[];
  rail: readonly SampleRailItemViewState[];
  active?: ActiveEditingState;
  voicePrompt?: VoicePromptEvent;
  finalRevisionId?: string;
}

export class CuppingScreenController {
  private state?: CuppingScreenState;

  constructor(
    private readonly repository: LocalCuppingRepository,
    private readonly progressReader: StageProgressReader,
    private readonly editor: CuppingSessionController,
    private readonly revisions?: RevisionCheckpointService
  ) {}

  current(): CuppingScreenState | undefined {
    return this.state;
  }

  async initialize(sessionId: string): Promise<CuppingScreenState> {
    const session = await this.repository.getSession(sessionId);
    const samples = await this.repository.listSamples(sessionId);
    const progress = await this.progressReader.listForSession(sessionId);
    this.state = {
      sessionId,
      sessionStatus: session.status,
      samples,
      rail: buildSampleRailViewState(samples, progress)
    };
    return this.state;
  }

  async select(sampleId: string, stageId: StageId, now: string): Promise<CuppingScreenState> {
    let state = this.requireState();
    const sample = state.samples.find((item) => item.sampleId === sampleId);
    if (!sample) throw new Error(`UNKNOWN_SAMPLE_ID:${sampleId}`);
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") {
      throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    }

    if (state.sessionStatus === "draft") {
      const activated = activateSession(await this.repository.getSession(state.sessionId), now);
      await this.repository.saveSession(activated);
      this.state = { ...state, sessionStatus: activated.status };
      state = this.state;
    }

    const active = await this.editor.open(
      { sessionId: state.sessionId, sampleId, stageId },
      now
    );
    return this.refreshState(active, voicePromptForStage(stageId));
  }

  async saveField(fieldKey: string, value: unknown, now: string): Promise<CuppingScreenState> {
    await this.editor.saveField(fieldKey, value, now);
    const active = this.editor.current();
    if (!active) throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    return this.refreshState(active);
  }

  async completeStage(now: string): Promise<CuppingScreenState> {
    const active = await this.editor.completeActiveStage(now);
    await this.revisions?.checkpointStage(
      active.context.sessionId,
      active.context.sampleId,
      active.context.stageId,
      now
    );
    return this.refreshState(active);
  }

  async reorderSampleIds(orderedSampleIds: readonly string[], now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") {
      throw new Error("COMPLETED_SESSION_IS_READ_ONLY");
    }
    await this.editor.flush();
    const reordered = reorderSamples(state.samples, orderedSampleIds, now);
    await this.repository.replaceSampleOrder(state.sessionId, reordered);
    const progress = await this.progressReader.listForSession(state.sessionId);
    const activeSampleId = this.editor.current()?.context.sampleId;
    this.state = {
      ...state,
      samples: reordered,
      rail: buildSampleRailViewState(reordered, progress, activeSampleId)
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
    return state.samples.length > 0 && state.rail.every((item) =>
      item.stages.find((stage) => stage.stageId === "final")?.status === "completed"
    );
  }

  async finishSession(now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    if (!this.canFinishSession()) throw new Error("ALL_SAMPLES_FINAL_STAGE_REQUIRED");
    await this.editor.flush();
    const session = await this.repository.getSession(state.sessionId);
    const completed = completeSession(session, now);
    await this.repository.saveSession(completed);
    const finalRevisionId = await this.revisions?.finalSession(state.sessionId, now);
    this.state = {
      ...state,
      sessionStatus: completed.status,
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

  private async refreshState(
    active: ActiveEditingState,
    voicePrompt?: VoicePromptEvent
  ): Promise<CuppingScreenState> {
    const state = this.requireState();
    const progress = await this.progressReader.listForSession(state.sessionId);
    this.state = {
      ...state,
      rail: buildSampleRailViewState(state.samples, progress, active.context.sampleId),
      active,
      voicePrompt
    };
    return this.state;
  }
}
