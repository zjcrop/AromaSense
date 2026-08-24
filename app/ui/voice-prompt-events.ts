import type { StageId } from "../../shared/protocol/aromasense-v1";

export type VoicePromptId =
  | "prepare"
  | "aroma"
  | "high_temp"
  | "mid_temp"
  | "low_temp"
  | "complete";

export interface VoicePromptEvent {
  id: VoicePromptId;
  stageId: StageId;
  text: string;
  interrupt: boolean;
}

const PROMPTS: Record<StageId, VoicePromptEvent> = {
  preparation: {
    id: "prepare",
    stageId: "preparation",
    text: "杯测准备阶段开始，请确认样品编号与基础信息。",
    interrupt: false
  },
  aroma: {
    id: "aroma",
    stageId: "aroma",
    text: "进入香气记录阶段。",
    interrupt: false
  },
  high_temp: {
    id: "high_temp",
    stageId: "high_temp",
    text: "进入高温品鉴阶段。",
    interrupt: true
  },
  mid_temp: {
    id: "mid_temp",
    stageId: "mid_temp",
    text: "进入中温品鉴阶段。",
    interrupt: true
  },
  low_temp: {
    id: "low_temp",
    stageId: "low_temp",
    text: "进入低温品鉴阶段。",
    interrupt: true
  },
  final: {
    id: "complete",
    stageId: "final",
    text: "本轮杯测记录进入完成阶段，请检查遗漏项目。",
    interrupt: false
  }
};

export function voicePromptForStage(stageId: StageId): VoicePromptEvent {
  return PROMPTS[stageId];
}
