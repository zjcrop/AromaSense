import type { StageId, SensoryObservation } from "../../shared/protocol/aromasense-v1";
import { sensoryFieldDefinition, SENSORY_DICTIONARY_VERSION } from "./sensory-dictionary-v1";
import type { EditingContext } from "./cupping-state-machine";
import type { EditingSlice, LocalCuppingRepository } from "../storage/local-cupping-repository";

export type ObservationIdFactory = (context: EditingContext, fieldKey: string) => string;

export interface ActiveEditingState {
  context: EditingContext;
  slice: EditingSlice;
}

/**
 * Coordinates the single active sample+stage editor.
 *
 * All writes are serialized. Context switches wait for prior writes, so the UI
 * never needs to keep a large authoritative in-memory session object.
 */
export class CuppingSessionController {
  private active?: ActiveEditingState;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: LocalCuppingRepository,
    private readonly observationIdFactory: ObservationIdFactory
  ) {}

  current(): ActiveEditingState | undefined {
    return this.active;
  }

  async open(context: EditingContext, now: string): Promise<ActiveEditingState> {
    await this.flush();

    await this.repository.setStageState(
      context.sessionId,
      context.sampleId,
      context.stageId,
      "active",
      now,
      now
    );

    const slice = await this.repository.loadEditingSlice(
      context.sessionId,
      context.sampleId,
      context.stageId
    );

    this.active = { context, slice };
    return this.active;
  }

  saveField(fieldKey: string, value: unknown, now: string): Promise<void> {
    const active = this.active;
    if (!active) {
      return Promise.reject(new Error("NO_ACTIVE_EDITING_CONTEXT"));
    }

    const definition = sensoryFieldDefinition(fieldKey);
    if (!definition) {
      return Promise.reject(new Error(`UNKNOWN_SENSORY_FIELD:${fieldKey}`));
    }
    if (!definition.stages.includes(active.context.stageId)) {
      return Promise.reject(
        new Error(`FIELD_NOT_ALLOWED_IN_STAGE:${fieldKey}:${active.context.stageId}`)
      );
    }

    const observation: SensoryObservation = {
      observationId: this.observationIdFactory(active.context, fieldKey),
      sessionId: active.context.sessionId,
      sampleId: active.context.sampleId,
      stageId: active.context.stageId,
      fieldKey,
      value,
      dictionaryVersion: SENSORY_DICTIONARY_VERSION,
      updatedAt: now
    };

    return this.enqueueWrite(async () => {
      await this.repository.saveObservation(observation);

      // Update only the currently loaded logical slice after local persistence
      // succeeds. The database remains authoritative.
      if (
        this.active?.context.sessionId === observation.sessionId &&
        this.active.context.sampleId === observation.sampleId &&
        this.active.context.stageId === observation.stageId
      ) {
        const previous = this.active.slice.observations.filter(
          (item) => item.fieldKey !== observation.fieldKey
        );
        this.active = {
          ...this.active,
          slice: {
            ...this.active.slice,
            observations: [...previous, observation].sort((a, b) =>
              a.fieldKey.localeCompare(b.fieldKey)
            )
          }
        };
      }
    });
  }

  async completeActiveStage(now: string): Promise<ActiveEditingState> {
    const active = this.active;
    if (!active) {
      throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    }

    await this.flush();
    await this.repository.setStageState(
      active.context.sessionId,
      active.context.sampleId,
      active.context.stageId,
      "completed",
      now,
      undefined,
      now
    );

    const slice = await this.repository.loadEditingSlice(
      active.context.sessionId,
      active.context.sampleId,
      active.context.stageId
    );
    this.active = { context: active.context, slice };
    return this.active;
  }

  async refresh(): Promise<ActiveEditingState> {
    const active = this.active;
    if (!active) {
      throw new Error("NO_ACTIVE_EDITING_CONTEXT");
    }

    await this.flush();
    const slice = await this.repository.loadEditingSlice(
      active.context.sessionId,
      active.context.sampleId,
      active.context.stageId
    );
    this.active = { context: active.context, slice };
    return this.active;
  }

  async flush(): Promise<void> {
    await this.writeTail;
  }

  private enqueueWrite(work: () => Promise<void>): Promise<void> {
    const next = this.writeTail.then(work);
    // Keep the internal chain usable after a rejected write while preserving
    // the rejection for the caller of this specific operation.
    this.writeTail = next.catch(() => undefined);
    return next;
  }
}
