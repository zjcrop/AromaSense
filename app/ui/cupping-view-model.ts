import { STAGE_IDS, type StageId } from "../../shared/protocol/aromasense-v1";
import {
  FINAL_ASSESSMENT_PHASES,
  FINAL_PHASE_COMPLETION_HINTS,
  stageCompletionHint,
  type FinalAssessmentPhase
} from "../core/cupping-progress-policy";
import { visibleSampleLabel, visibleSampleMetadata } from "../core/blind-session";
import type { StageStatus } from "../core/cupping-state-machine";
import type { SampleRecord } from "../core/sample-batch-service";
import type { SessionStatus } from "../core/session-lifecycle";
import type { CuppingSessionMetadata } from "../core/session-metadata";
import type { SampleStageProgress } from "../storage/stage-progress-reader";

export type StageTone = "orange" | "pink" | "blue" | "white" | "neutral";
export type StageIndicatorState = StageStatus;

export interface FinalPhaseViewState {
  phase: FinalAssessmentPhase;
  label: string;
  status: StageStatus;
  indicatorState: StageIndicatorState;
  completionHint: string;
}

export interface StageViewState {
  stageId: StageId;
  label: string;
  tone: StageTone;
  status: StageStatus;
  indicatorState: StageIndicatorState;
  completionHint: string;
  finalPhases?: readonly FinalPhaseViewState[];
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
  final: { label: "终评", tone: "neutral" }
};

const FINAL_PHASE_LABELS: Readonly<Record<FinalAssessmentPhase, string>> = {
  flavor: "风味描述",
  overall: "综评",
  score: "评分"
};

function progressKey(sampleId: string, stageId: StageId): string {
  return `${sampleId}:${stageId}`;
}

function finalPhases(progress: SampleStageProgress | undefined): readonly FinalPhaseViewState[] {
  const byPhase = new Map((progress?.finalPhases ?? []).map((item) => [item.phase, item] as const));
  return FINAL_ASSESSMENT_PHASES.map((phase) => {
    const item = byPhase.get(phase);
    const status = item?.status ?? "not_started";
    return {
      phase,
      label: FINAL_PHASE_LABELS[phase],
      status,
      indicatorState: status,
      completionHint: item?.completionHint ?? FINAL_PHASE_COMPLETION_HINTS[phase]
    };
  });
}

export function buildSampleRailViewState(
  samples: readonly SampleRecord[],
  progress: readonly SampleStageProgress[],
  activeSampleId?: string,
  visibility?: SampleVisibilityContext
): readonly SampleRailItemViewState[] {
  const progressByKey = new Map(
    progress.map((item) => [progressKey(item.sampleId, item.stageId), item] as const)
  );

  return [...samples]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sample) => {
      const stages = STAGE_IDS.map((stageId): StageViewState => {
        const stageProgress = progressByKey.get(progressKey(sample.sampleId, stageId));
        const status = stageProgress?.status ?? "not_started";
        return {
          stageId,
          label: STAGE_META[stageId].label,
          tone: STAGE_META[stageId].tone,
          status,
          indicatorState: status,
          completionHint: stageCompletionHint(stageId),
          finalPhases: stageId === "final" ? finalPhases(stageProgress) : undefined
        };
      });
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
  if (index < 0 || index >= STAGE_IDS.length - 1) return undefined;
  return STAGE_IDS[index + 1];
}

export function previousStage(stageId: StageId): StageId | undefined {
  const index = STAGE_IDS.indexOf(stageId);
  if (index <= 0) return undefined;
  return STAGE_IDS[index - 1];
}
