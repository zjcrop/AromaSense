import { SCA_CVA_CALCULATOR_VERSION } from "./sca-cva-score-engine";
import { cuppingModeFromMetadata, type CuppingMode, type CuppingSessionMetadata } from "./session-metadata";

export type CuppingScoreProfileId = "open" | "blind" | "semi_blind";
export type CuppingCalculatorVersion = typeof SCA_CVA_CALCULATOR_VERSION | "aromasense-quality-0.1c";

export interface CuppingScoreProfile {
  id: CuppingScoreProfileId;
  mode: CuppingMode;
  label: string;
  scoreLabel: string;
  scoreNote: string;
  metadataPolicy: "visible" | "hidden" | "semi_hidden";
  calculatorVersion: CuppingCalculatorVersion;
}

const PROFILES: Record<CuppingScoreProfileId, CuppingScoreProfile> = {
  open: {
    id: "open",
    mode: "open",
    label: "公开杯测",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment计算；香迹描述性强度与风味侧写不进入该分数。",
    metadataPolicy: "visible",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  },
  blind: {
    id: "blind",
    mode: "blind",
    label: "盲测",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment计算；样品身份与豆子元数据不参与计分。",
    metadataPolicy: "hidden",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  },
  semi_blind: {
    id: "semi_blind",
    mode: "semi_blind",
    label: "半盲测",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment计算；被隐藏的样品身份字段不参与计分。",
    metadataPolicy: "semi_hidden",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  }
};

export function scoreProfileForMode(mode: CuppingMode): CuppingScoreProfile {
  return PROFILES[mode];
}

export function scoreProfileForMetadata(metadata: Partial<CuppingSessionMetadata>): CuppingScoreProfile {
  return scoreProfileForMode(cuppingModeFromMetadata(metadata));
}
