import { SCA_CVA_CALCULATOR_VERSION } from "./sca-cva-score-engine";
import {
  cuppingModeFromMetadata,
  normalizeCuppingMode,
  type CanonicalCuppingMode,
  type CuppingMode,
  type CuppingSessionMetadata
} from "./session-metadata";

export type CuppingScoreProfileId = CanonicalCuppingMode;
export type CuppingCalculatorVersion = typeof SCA_CVA_CALCULATOR_VERSION | "aromasense-quality-0.1c";

export interface CuppingScoreProfile {
  id: CuppingScoreProfileId;
  mode: CanonicalCuppingMode;
  label: string;
  scoreLabel: string;
  scoreNote: string;
  metadataPolicy: "visible" | "hidden" | "semi_hidden";
  calculatorVersion: CuppingCalculatorVersion;
}

const PROFILES: Record<CuppingScoreProfileId, CuppingScoreProfile> = {
  formal: {
    id: "formal",
    mode: "formal",
    label: "正式杯测",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment计算；香迹扩展信息不得改变SCA正式得分。",
    metadataPolicy: "visible",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  },
  free: {
    id: "free",
    mode: "free",
    label: "自由杯测",
    scoreLabel: "SCA CVA 参考分",
    scoreNote: "自由杯测允许香迹扩展记录；如填写完整SCA字段，可实时显示SCA CVA参考分，扩展字段不进入该分数。",
    metadataPolicy: "visible",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  },
  competition: {
    id: "competition",
    mode: "competition",
    label: "杯测赛",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment实时计算；仅在整场最终完成时锁定和提交。",
    metadataPolicy: "visible",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  },
  timed: {
    id: "timed",
    mode: "timed",
    label: "计时赛",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment实时计算；计时规则不改变SCA评分公式。",
    metadataPolicy: "visible",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  },
  blind: {
    id: "blind",
    mode: "blind",
    label: "盲测赛",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment计算；样品身份与豆子元数据不参与计分。",
    metadataPolicy: "hidden",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  },
  semi_blind: {
    id: "semi_blind",
    mode: "semi_blind",
    label: "半盲测赛",
    scoreLabel: "SCA CVA Affective Score",
    scoreNote: "按SCA-104 Affective Assessment计算；被隐藏的样品身份字段不参与计分。",
    metadataPolicy: "semi_hidden",
    calculatorVersion: SCA_CVA_CALCULATOR_VERSION
  }
};

export function scoreProfileForMode(mode: CuppingMode): CuppingScoreProfile {
  return PROFILES[normalizeCuppingMode(mode)];
}

export function scoreProfileForMetadata(metadata: Partial<CuppingSessionMetadata>): CuppingScoreProfile {
  return PROFILES[normalizeCuppingMode(cuppingModeFromMetadata(metadata))];
}
