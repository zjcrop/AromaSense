import { cuppingModeFromMetadata, type CuppingMode, type CuppingSessionMetadata } from "./session-metadata";

export type CuppingScoreProfileId = "open" | "blind" | "semi_blind";

export interface CuppingScoreProfile {
  id: CuppingScoreProfileId;
  mode: CuppingMode;
  label: string;
  scoreLabel: string;
  scoreNote: string;
  metadataPolicy: "visible" | "hidden" | "semi_hidden";
  calculatorVersion: "aromasense-quality-0.1c";
}

const PROFILES: Record<CuppingScoreProfileId, CuppingScoreProfile> = {
  open: {
    id: "open",
    mode: "open",
    label: "公开杯测评分",
    scoreLabel: "公开杯测总分",
    scoreNote: "依据本次综合质量分项与缺陷记录计算。",
    metadataPolicy: "visible",
    calculatorVersion: "aromasense-quality-0.1c"
  },
  blind: {
    id: "blind",
    mode: "blind",
    label: "盲测评分",
    scoreLabel: "盲测感官总分",
    scoreNote: "仅使用盲测过程中记录的感官质量与缺陷数据计算，不读取样品身份或豆子元数据。",
    metadataPolicy: "hidden",
    calculatorVersion: "aromasense-quality-0.1c"
  },
  semi_blind: {
    id: "semi_blind",
    mode: "semi_blind",
    label: "半盲测评分",
    scoreLabel: "半盲测感官总分",
    scoreNote: "仅使用杯测过程中记录的感官质量与缺陷数据计算；被隐藏的样品身份字段不参与计分。",
    metadataPolicy: "semi_hidden",
    calculatorVersion: "aromasense-quality-0.1c"
  }
};

export function scoreProfileForMode(mode: CuppingMode): CuppingScoreProfile {
  return PROFILES[mode];
}

export function scoreProfileForMetadata(metadata: Partial<CuppingSessionMetadata>): CuppingScoreProfile {
  return scoreProfileForMode(cuppingModeFromMetadata(metadata));
}
