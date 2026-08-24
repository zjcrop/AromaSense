import type { StageId } from "../../shared/protocol/aromasense-v1";
import { CuppingSessionController, type ActiveEditingState } from "../core/cupping-session-controller";
import type { SampleRecord } from "../core/sample-batch-service";
import type { LocalCuppingRepository } from "../storage/local-cupping-repository";
import type { StageProgressReader } from "../storage/stage-progress-reader";
import { buildSampleRailViewState, nextStage, previousStage, type SampleRailItemViewState } from "./cupping-view-model";
import { voicePromptForStage, type VoicePromptEvent } from "./voice-prompt-events";

export interface CuppingScreenState {
  sessionId: string;
  samples: readonly SampleRecord[];
  rail: readonly SampleRailItemViewState[];
  active?: ActiveEditingState;
  voicePrompt?: VoicePromptEvent;
}

export class CuppingScreenController {
  private state?: CuppingScreenState;

  constructor(
    private readonly repository: LocalCuppingRepository,
    private readonly progressReader: StageProgressReader,
    private readonly editor: CuppingSessionController
  ) {}

  current(): CuppingScreenState | undefined {
    return this.state;
  }

  async initialize(sessionId: string): Promise<CuppingScreenState> {
    const samples = await this.repository.listSamples(sessionId);
    const progress = await this.progressReader.listForSession(sessionId);
    this.state = {
      sessionId,
      samples,
      rail: buildSampleRailViewState(samples, progress)
    };
    return this.state;
  }

  async select(sampleId: string, stageId: StageId, now: string): Promise<CuppingScreenState> {
    const state = this.requireState();
    const sample = state.samples.find((item) => item.sampleId === sampleId);
    if (!sample) {
      throw new Error(`UNKNOWN_SAMPLE_ID:${sampleId}`);
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
    if (!active) {
      throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    }
    return this.refreshState(active);
  }

  async completeStage(now: string): Promise<CuppingScreenState> {
    const active = await this.editor.completeActiveStage(now);
    return this.refreshState(active);
  }

  async goNext(now: string): Promise<CuppingScreenState> {
    const active = this.requireActive();
    const stageId = nextStage(active.context.stageId);
    if (!stageId) {
      return this.completeStage(now);
    }
    return this.select(active.context.sampleId, stageId, now);
  }

  async goPrevious(now: string): Promise<CuppingScreenState> {
    const active = this.requireActive();
    const stageId = previousStage(active.context.stageId);
    if (!stageId) {
      return this.requireState();
    }
    return this.select(active.context.sampleId, stageId, now);
  }

  private requireState(): CuppingScreenState {
    if (!this.state) {
      throw new Error("CUPPING_SCREEN_NOT_INITIALIZED");
    }
    return this.state;
  }

  private requireActive(): ActiveEditingState {
    const active = this.editor.current();
    if (!active) {
      throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    }
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
