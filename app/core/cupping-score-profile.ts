import { SCA_CVA_CALCULATOR_VERSION } from "./sca-cva-score-engine";
import { cuppingModeFromMetadata, type CuppingMode, type CuppingSessionMetadata } from "./session-metadata";

export type CuppingScoreProfileId = CuppingMode;
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
  free: {
    id: "free",
    mode: "free",
    label: "自由杯测",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment计算；自由杯测仅改变计时与样品编辑约束，不改变评分公式。",
    metadataPolicy: "visible",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  },
  timed: {
    id: "timed",
    mode: "timed",
    label: "计时杯测",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment计算；计时与样品锁定不改变评分公式。",
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
