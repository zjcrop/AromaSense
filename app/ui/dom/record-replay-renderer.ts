import type { CuppingRecordSnapshot } from "../../core/session-record-service";
import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import { cuppingModeLabel, cuppingModeFromMetadata } from "../../core/session-metadata";
import { scoreProfileForMetadata } from "../../core/cupping-score-profile";
import { calculateCuppingScore } from "./final-assessment-renderer";
import { renderRadarSummary } from "./radar-renderer";
import { button, clearElement, element } from "./dom-helpers";
import { comparisonFields, normalizeComparisonBundle, type ComparisonBundle, type ComparisonMapping } from "../../core/comparison-bundle";

export interface RecordReplayComparisonOptions {
  initial?: { bundle: ComparisonBundle; mapping: ComparisonMapping };
  onImport(bundle: ComparisonBundle): Promise<{ bundle: ComparisonBundle; mapping: ComparisonMapping }>;
  onClear(): void | Promise<void>;
}

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

export class RecordReplayRenderer {
  private comparison?: { bundle: ComparisonBundle; mapping: ComparisonMapping };
  constructor(
    private readonly root: HTMLElement,
    private readonly snapshot: CuppingRecordSnapshot,
    private readonly onBack: () => void | Promise<void>,
    private readonly comparisonOptions?: RecordReplayComparisonOptions
  ) { this.comparison = comparisonOptions?.initial; }

  render(): void {
    clearElement(this.root);
    this.root.classList.add("record-replay");
    const { session } = this.snapshot;
    const mode = cuppingModeFromMetadata(session.metadata);
    const scoreProfile = scoreProfileForMetadata(session.metadata);
    const header = element("header", "record-replay__header");
    const compareInput = element("input", "record-replay__compare-input"); compareInput.type = "file"; compareInput.accept = ".json,application/json"; compareInput.hidden = true;
    compareInput.addEventListener("change", () => { const file = compareInput.files?.[0]; compareInput.value = ""; if (file) void this.importComparison(file); });
    const tools = element("div", "record-replay__tools");
    tools.append(button("record-replay__compare", this.comparison ? "更换对比" : "加载对比", () => compareInput.click()));
    if (this.comparison) tools.append(button("record-replay__compare", "清除对比", () => void this.clearComparison()));
    header.append(button("record-replay__back", "返回记录", () => this.onBack()), element("h1", "record-replay__title", session.metadata.eventName || session.title || "杯测复盘"), tools, compareInput);
    this.root.append(header);

    const meta = element("section", "record-replay__meta");
    for (const [label, value] of [
      ["日期", session.metadata.date], ["时间", session.metadata.time], ["组织方", session.metadata.organizer],
      ["参与对象", session.metadata.participants], ["杯测目标", cuppingModeLabel(mode)], ["杯测会名称", session.metadata.eventName]
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

      const score = calculateCuppingScore(observations, scoreProfile);
      section.append(element("div", "record-replay__score", `${scoreProfile.scoreLabel} ${score.toFixed(1)}`));

      const fields = element("dl", "record-replay__fields");
      const comparison = this.comparison ? new Map(comparisonFields(this.snapshot, this.comparison.bundle, this.comparison.mapping, sample.sampleId).map((item) => [item.fieldKey, item] as const)) : new Map();
      for (const observation of observations) {
        if (observation.fieldKey === "final_phase" || observation.fieldKey.startsWith("blind_guess_")) continue;
        const dt = element("dt", "record-replay__field-key", observation.fieldKey);
        const compared = comparison.get(observation.fieldKey);
        const dd = element("dd", "record-replay__field-value");
        if (Array.isArray(observation.value)) {
          for (const value of observation.value) dd.append(element("span", `record-replay__own-tag${compared?.overlappingTags?.includes(String(value)) ? " is-overlap" : ""}`, String(value)));
          for (const value of compared?.peerOnlyTags ?? []) dd.append(element("span", "record-replay__peer-tag", value));
        } else {
          dd.append(document.createTextNode(readable(observation.value)));
          if (compared?.peer !== undefined) dd.append(element("small", `record-replay__peer-value ${typeof compared.peer === "number" ? "is-numeric" : "is-text"}`, typeof compared.peer === "number" ? `对方 ${compared.peer}` : readable(compared.peer)));
        }
        fields.append(dt, dd);
      }
      for (const field of comparison.values()) {
        if (observations.some((item) => item.fieldKey === field.fieldKey) || field.peer === undefined) continue;
        fields.append(element("dt", "record-replay__field-key", field.fieldKey), element("dd", "record-replay__field-value is-peer-only", readable(field.peer)));
      }
      section.append(fields);
      this.root.append(section);
    }
  }

  private async importComparison(file: File): Promise<void> {
    if (!this.comparisonOptions) return;
    try {
      const bundle = normalizeComparisonBundle(JSON.parse(await file.text()));
      if (!bundle) throw new Error("不支持的 Comparison/Submission Bundle");
      this.comparison = await this.comparisonOptions.onImport(bundle);
      this.render();
    } catch (error) { window.alert(`加载对比失败：${error instanceof Error ? error.message : String(error)}`); }
  }

  private async clearComparison(): Promise<void> {
    await this.comparisonOptions?.onClear(); this.comparison = undefined; this.render();
  }
}
