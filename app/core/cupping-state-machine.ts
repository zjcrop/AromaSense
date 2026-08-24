import type { StageId } from "../../shared/protocol/aromasense-v1";

export type StageStatus = "not_started" | "active" | "completed";

export interface EditingContext {
  sessionId: string;
  sampleId: string;
  stageId: StageId;
}

export interface StageState {
  stageId: StageId;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface CuppingState {
  active?: EditingContext;
  stages: Record<string, StageState>;
}

function key(sampleId: string, stageId: StageId): string {
  return `${sampleId}:${stageId}`;
}

export function activateStage(
  state: CuppingState,
  context: EditingContext,
  now: string
): CuppingState {
  const k = key(context.sampleId, context.stageId);
  const current = state.stages[k];
  return {
    ...state,
    active: context,
    stages: {
      ...state.stages,
      [k]: {
        stageId: context.stageId,
        status: current?.status === "completed" ? "completed" : "active",
        startedAt: current?.startedAt ?? now,
        completedAt: current?.completedAt
      }
    }
  };
}

export function completeStage(
  state: CuppingState,
  context: EditingContext,
  now: string
): CuppingState {
  const k = key(context.sampleId, context.stageId);
  const current = state.stages[k];
  return {
    ...state,
    stages: {
      ...state.stages,
      [k]: {
        stageId: context.stageId,
        status: "completed",
        startedAt: current?.startedAt ?? now,
        completedAt: now
      }
    }
  };
}

export function stageStatus(
  state: CuppingState,
  sampleId: string,
  stageId: StageId
): StageStatus {
  return state.stages[key(sampleId, stageId)]?.status ?? "not_started";
}
