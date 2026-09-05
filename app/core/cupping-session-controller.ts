import type { StageId, SensoryObservation } from "../../shared/protocol/aromasense-v1";
import {
  deriveStageStatus,
  scoreAffectingField
} from "./cupping-progress-policy";
import { sensoryFieldDefinition, SENSORY_DICTIONARY_VERSION } from "./sensory-dictionary-v1";
import type { EditingContext } from "./cupping-state-machine";
import type { EditingSlice, LocalCuppingRepository } from "../storage/local-cupping-repository";

export type ObservationIdFactory = (context: EditingContext, fieldKey: string) => string;

export interface ActiveEditingState {
  context: EditingContext;
  slice: EditingSlice;
}

const FINAL_FIELD_PREFIXES = ["final_", "profile_", "quality_", "defect_", "overall_", "off_flavor_", "score_"] as const;

function isFinalExtensionField(stageId: StageId, fieldKey: string): boolean {
  return ["final", "flavor", "overall", "scoring"].includes(stageId) && FINAL_FIELD_PREFIXES.some((prefix) => fieldKey.startsWith(prefix));
}

function replaceObservation(
  observations: readonly SensoryObservation[],
  next: SensoryObservation
): readonly SensoryObservation[] {
  return [
    ...observations.filter((item) => item.fieldKey !== next.fieldKey),
    next
  ].sort((a, b) => a.fieldKey.localeCompare(b.fieldKey));
}

export class CuppingSessionController {
  private active?: ActiveEditingState;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: LocalCuppingRepository,
    private readonly observationIdFactory: ObservationIdFactory
  ) {}

  current(): ActiveEditingState | undefined { return this.active; }

  async open(context: EditingContext, _now: string): Promise<ActiveEditingState> {
    await this.flush();
    const slice = await this.repository.loadEditingSlice(context.sessionId, context.sampleId, context.stageId);
    this.active = {
      context,
      slice: { ...slice, stageStatus: deriveStageStatus(context.stageId, slice.observations) }
    };
    return this.active;
  }

  saveField(fieldKey: string, value: unknown, now: string): Promise<void> {
    const active = this.active;
    if (!active) return Promise.reject(new Error("NO_ACTIVE_EDITING_CONTEXT"));

    const definition = sensoryFieldDefinition(fieldKey);
    const extension = isFinalExtensionField(active.context.stageId, fieldKey);
    if (!definition && !extension) return Promise.reject(new Error(`UNKNOWN_SENSORY_FIELD:${fieldKey}`));
    if (definition && !definition.stages.includes(active.context.stageId)) {
      return Promise.reject(new Error(`FIELD_NOT_ALLOWED_IN_STAGE:${fieldKey}:${active.context.stageId}`));
    }

    const observation: SensoryObservation = {
      observationId: this.observationIdFactory(active.context, fieldKey),
      sessionId: active.context.sessionId,
      sampleId: active.context.sampleId,
      stageId: active.context.stageId,
      fieldKey,
      value,
      dictionaryVersion: extension ? "sensory-0.1C" : SENSORY_DICTIONARY_VERSION,
      updatedAt: now
    };

    return this.enqueueWrite(async () => {
      if (active.slice.stageStatus === "not_started") {
        await this.repository.setStageState(active.context.sessionId, active.context.sampleId, active.context.stageId, "active", now, now);
      }
      await this.repository.saveObservation(observation);
      let observations = replaceObservation(this.active?.slice.observations ?? active.slice.observations, observation);

      if (
        observation.stageId === "final"
        && fieldKey !== "final_score_confirmed"
        && scoreAffectingField(fieldKey)
      ) {
        const scoreConfirmation = observations.find((item) => item.fieldKey === "final_score_confirmed");
        if (scoreConfirmation?.value === true) {
          const invalidated: SensoryObservation = {
            observationId: this.observationIdFactory(active.context, "final_score_confirmed"),
            sessionId: active.context.sessionId,
            sampleId: active.context.sampleId,
            stageId: "final",
            fieldKey: "final_score_confirmed",
            value: false,
            dictionaryVersion: "sensory-0.1C",
            updatedAt: now
          };
          await this.repository.saveObservation(invalidated);
          observations = replaceObservation(observations, invalidated);
        }
      }

      if (observation.stageId === "overall" && scoreAffectingField(fieldKey)) {
        const scoringObservations = await this.repository.listObservationsForStage(observation.sampleId, "scoring");
        const scoreConfirmation = scoringObservations.find((item) => item.fieldKey === "score_confirmed");
        if (scoreConfirmation?.value === true) {
          const scoringContext: EditingContext = { ...active.context, stageId: "scoring" };
          const invalidated: SensoryObservation = {
            observationId: this.observationIdFactory(scoringContext, "score_confirmed"),
            sessionId: active.context.sessionId,
            sampleId: active.context.sampleId,
            stageId: "scoring",
            fieldKey: "score_confirmed",
            value: false,
            dictionaryVersion: "sensory-flow/2.0",
            updatedAt: now
          };
          await this.repository.saveObservation(invalidated);
          await this.repository.setStageState(
            observation.sessionId,
            observation.sampleId,
            "scoring",
            "active",
            now,
            now
          );
        }
      }

      const status = deriveStageStatus(observation.stageId, observations);
      await this.repository.setStageState(
        observation.sessionId,
        observation.sampleId,
        observation.stageId,
        status,
        now,
        status === "not_started" ? undefined : now,
        status === "completed" ? now : undefined
      );

      if (
        this.active?.context.sessionId === observation.sessionId
        && this.active.context.sampleId === observation.sampleId
        && this.active.context.stageId === observation.stageId
      ) {
        this.active = {
          ...this.active,
          slice: {
            ...this.active.slice,
            stageStatus: status,
            observations
          }
        };
      }
    });
  }

  async completeActiveStage(now: string): Promise<ActiveEditingState> {
    const active = this.active;
    if (!active) throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    await this.flush();
    const slice = await this.repository.loadEditingSlice(active.context.sessionId, active.context.sampleId, active.context.stageId);
    const status = deriveStageStatus(active.context.stageId, slice.observations);
    if (status !== "completed") throw new Error(`STAGE_INCOMPLETE:${active.context.stageId}`);
    await this.repository.setStageState(active.context.sessionId, active.context.sampleId, active.context.stageId, "completed", now, now, now);
    const completedSlice = await this.repository.loadEditingSlice(active.context.sessionId, active.context.sampleId, active.context.stageId);
    this.active = { context: active.context, slice: { ...completedSlice, stageStatus: "completed" } };
    return this.active;
  }

  async refresh(): Promise<ActiveEditingState> {
    const active = this.active;
    if (!active) throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    await this.flush();
    const slice = await this.repository.loadEditingSlice(active.context.sessionId, active.context.sampleId, active.context.stageId);
    this.active = {
      context: active.context,
      slice: { ...slice, stageStatus: deriveStageStatus(active.context.stageId, slice.observations) }
    };
    return this.active;
  }

  async flush(): Promise<void> { await this.writeTail; }

  private enqueueWrite(work: () => Promise<void>): Promise<void> {
    const next = this.writeTail.then(work);
    this.writeTail = next.catch(() => undefined);
    return next;
  }
}
