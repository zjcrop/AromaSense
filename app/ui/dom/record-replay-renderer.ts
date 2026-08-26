import type { CuppingRecordSnapshot } from "../../core/session-record-service";
import {
  calculateBlindIdentificationScore,
  type BlindIdentificationScore
} from "../../core/blind-scoring";
import { blindModeLabel } from "../../core/blind-session";
import { normalizeBlindMode } from "../../core/session-metadata";
import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import { calculateAromaSenseScore } from "./final-assessment-renderer";
import { renderRadarSummary } from "./radar-renderer";
import { button, clearElement, element } from "./dom-helpers";

const PROFILE_AXES = [
  ["profile_floral", "花香"], ["profile_fruit", "果香"], ["profile_tea", "茶感"],
  ["profile_nut", "坚果"], ["profile_ferment", "酵感"], ["profile_spice", "香料"]
] as const;
const QUALITY_AXES = [
  ["quality_flavor", "风味"], ["quality_aftertaste", "余韵"], ["quality_acidity", "酸质"], ["quality_sweetness", "甜感"],
  ["quality_body", "醇厚度"], ["quality_clean", "干净度"], ["quality_uniformity", "一致性"], ["quality_balance", "平衡性"]
] as const;

function numeric(observations: readonly SensoryObservation[], key: string): number {
  const item = observations.find((entry) => entry.fieldKey === key);
  return typeof item?.value === "number" && Number.isFinite(item.value) ? item.value : 0;
}

function readable(value: unknown): string {
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function renderBlindScore(score: BlindIdentificationScore): HTMLElement {
  const section = element("div", "record-replay__blind-score");
  const mode = blindModeLabel(score.mode);
  section.append(element("strong", "record-replay__score", score.total
    ? `${mode}识别分 ${score.percent?.toFixed(1)}% · ${score.correct}/${score.total}`
    : `${mode}识别分：参考资料不足，暂不计分`));
  const details = element("dl", "record-replay__fields");
  for (const item of score.items) {
    const dt = element("dt", "record-replay__field-key", item.label);
    const value = item.scorable
      ? `判断：${item.guess || "未填写"} · 揭盲：${item.truth || "—"} · ${item.correct ? "命中" : "未命中"}`
      : `判断：${item.guess || "未填写"} · 参考资料为空，不计分`;
    const dd = element("dd", "record-replay__field-value", value);
    details.append(dt, dd);
  }
  section.append(details);
  return section;
}

export class RecordReplayRenderer {
  constructor(
    private readonly root: HTMLElement,
    private readonly snapshot: CuppingRecordSnapshot,
    private readonly onBack: () => void | Promise<void>
  ) {}

  render(): void {
    clearElement(this.root);
    this.root.classList.add("record-replay");
    const { session } = this.snapshot;
    const blindMode = normalizeBlindMode(session.metadata.blindMode);
    const header = element("header", "record-replay__header");
    header.append(button("record-replay__back", "返回记录", () => this.onBack()), element("h1", "record-replay__title", session.metadata.eventName || session.title || "杯测复盘"), element("span", "record-replay__readonly", "只读"));
    this.root.append(header);

    const meta = element("section", "record-replay__meta");
    for (const [label, value] of [
      ["日期", session.metadata.date], ["时间", session.metadata.time], ["组织方", session.metadata.organizer],
      ["参与对象", session.metadata.participants], ["测试目标", session.metadata.target], ["杯测会名称", session.metadata.eventName],
      ["模式", blindMode === "open" ? "普通/自定义" : blindModeLabel(blindMode)]
    ] as const) {
      if (!value) continue;
      const item = element("span", "record-replay__meta-item"); item.append(element("small", "", label), element("strong", "", value)); meta.append(item);
    }
    this.root.append(meta);

    for (const sample of this.snapshot.samples) {
      const observations = this.snapshot.observations.filter((item) => item.sampleId === sample.sampleId);
      const section = element("section", "record-replay__sample");
      section.append(element("h2", "record-replay__sample-title", `${String(sample.displayNumber).padStart(2, "0")} · ${sample.label ?? "未命名样品"}`));

      const radars = element("div", "record-replay__radars");
      const profile = element("div", "record-replay__radar");
      renderRadarSummary(profile, PROFILE_AXES.map(([key, label]) => ({ key, label, value: numeric(observations, key), max: 10 })), { title: "风味倾向雷达图" });
      const quality = element("div", "record-replay__radar");
      renderRadarSummary(quality, QUALITY_AXES.map(([key, label]) => ({ key, label, value: numeric(observations, key), max: 10 })), { title: "感官质量雷达图" });
      radars.append(profile, quality); section.append(radars);

      const score = calculateAromaSenseScore(observations);
      section.append(element("div", "record-replay__score", `AromaSense 感官质量总分 ${score.toFixed(1)}`));
      if (blindMode !== "open") {
        section.append(renderBlindScore(calculateBlindIdentificationScore(
          sample.metadata,
          observations,
          blindMode,
          session.metadata.semiBlindVisibleFields
        )));
      }

      const fields = element("dl", "record-replay__fields");
      for (const observation of observations) {
        if (observation.fieldKey === "final_phase" || observation.fieldKey.startsWith("blind_guess_")) continue;
        const dt = element("dt", "record-replay__field-key", observation.fieldKey);
        const dd = element("dd", "record-replay__field-value", readable(observation.value));
        fields.append(dt, dd);
      }
      section.append(fields);
      this.root.append(section);
    }
  }
}
