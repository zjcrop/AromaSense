import { STAGE_IDS, type StageId } from "../../shared/protocol/aromasense-v1";
import { visibleSampleLabel, visibleSampleMetadata } from "../core/blind-session";
import type { StageStatus } from "../core/cupping-state-machine";
import type { SampleRecord } from "../core/sample-batch-service";
import type { SessionStatus } from "../core/session-lifecycle";
import type { CuppingSessionMetadata } from "../core/session-metadata";
import type { SampleStageProgress } from "../storage/stage-progress-reader";

export type StageTone = "orange" | "pink" | "blue" | "white" | "neutral";

export interface StageViewState {
  stageId: StageId;
  label: string;
  tone: StageTone;
  status: StageStatus;
}

export interface SampleRailItemViewState {
  sampleId: string;
  displayNumber: number;
  label?: string;
  metadata: Readonly<Record<string, unknown>>;
  active: boolean;
  completedStageCount: number;
  startedStageCount: number;
  totalStageCount: number;
  stages: readonly StageViewState[];
}

export interface SampleVisibilityContext {
  metadata: CuppingSessionMetadata;
  status: SessionStatus;
}

const STAGE_META: Record<StageId, { label: string; tone: StageTone }> = {
  preparation: { label: "准备", tone: "orange" },
  aroma: { label: "香气", tone: "orange" },
  high_temp: { label: "高温", tone: "pink" },
  mid_temp: { label: "中温", tone: "blue" },
  low_temp: { label: "低温", tone: "white" },
  final: { label: "完成", tone: "neutral" }
};

function progressKey(sampleId: string, stageId: StageId): string {
  return `${sampleId}:${stageId}`;
}

export function buildSampleRailViewState(
  samples: readonly SampleRecord[],
  progress: readonly SampleStageProgress[],
  activeSampleId?: string,
  visibility?: SampleVisibilityContext
): readonly SampleRailItemViewState[] {
  const progressByKey = new Map(
    progress.map((item) => [progressKey(item.sampleId, item.stageId), item.status] as const)
  );

  return [...samples]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sample) => {
      const stages = STAGE_IDS.map((stageId): StageViewState => ({
        stageId,
        label: STAGE_META[stageId].label,
        tone: STAGE_META[stageId].tone,
        status: progressByKey.get(progressKey(sample.sampleId, stageId)) ?? "not_started"
      }));
      const completedStageCount = stages.filter((stage) => stage.status === "completed").length;
      const startedStageCount = stages.filter((stage) => stage.status !== "not_started").length;

      return {
        sampleId: sample.sampleId,
        displayNumber: sample.displayNumber,
        label: visibility
          ? visibleSampleLabel(sample.label, sample.displayNumber, visibility.metadata, visibility.status)
          : sample.label,
        metadata: visibility
          ? visibleSampleMetadata(sample.metadata, visibility.metadata, visibility.status)
          : { ...sample.metadata },
        active: sample.sampleId === activeSampleId,
        completedStageCount,
        startedStageCount,
        totalStageCount: stages.length,
        stages
      };
    });
}

export function nextStage(stageId: StageId): StageId | undefined {
  const index = STAGE_IDS.indexOf(stageId);
  if (index < 0 || index >= STAGE_IDS.length - 1) {
    return undefined;
  }
  return STAGE_IDS[index + 1];
}

export function previousStage(stageId: StageId): StageId | undefined {
  const index = STAGE_IDS.indexOf(stageId);
  if (index <= 0) {
    return undefined;
  }
  return STAGE_IDS[index - 1];
}
