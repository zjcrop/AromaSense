import type { SensoryObservation } from "../../../shared/protocol/aromasense-v1";
import { descriptorDefinition } from "../../core/sensory-dictionary-v1";
import {
  deriveSensoryProfileConclusion,
  type FlavorFamilyId,
  type TemperatureFlavorPoint
} from "../../core/sensory-profile-conclusion";
import { element } from "./dom-helpers";
import { renderRadarSummary } from "./radar-renderer";

const FLAVOR_FAMILY_COLORS: Record<FlavorFamilyId, string> = {
  white_floral: "#e9e2d2",
  floral: "#d9a6be",
  citrus: "#e69b32",
  berry: "#a84f6c",
  stone_fruit: "#e99a74",
  tropical: "#d6be43",
  tea: "#b18449",
  sweet: "#d4a33b",
  nut_cocoa: "#86634a",
  fermented: "#934f63",
  spice_herbal: "#74815b",
  neutral: "#77736d"
};

function ensureStyles(): void {
  if (document.head.querySelector("style[data-aromasense-sensory-profile-conclusion]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseSensoryProfileConclusion = "true";
  style.textContent = `
    .sensory-conclusion{display:grid;gap:8px;margin:18px 0}.sensory-conclusion__completeness{margin:0;color:#8f8981;font-size:10px;line-height:1.45}
    .sensory-conclusion__grid{display:grid;grid-template-columns:minmax(260px,.82fr) minmax(360px,1.18fr);gap:14px;align-items:start}
    .sensory-conclusion__panel{min-width:0}.temperature-flavor-profile{padding:12px;border:1px solid rgba(185,153,90,.42);border-radius:14px;background:#1d1d1d}
    .temperature-flavor-profile__title{margin:0;font-size:15px}.temperature-flavor-profile__note{margin:5px 0 8px;color:#9c968d;font-size:10px;line-height:1.45}
    .temperature-flavor-profile__canvas{display:block;width:100%;height:auto;max-width:760px;margin:0 auto}.temperature-flavor-profile__legend{display:flex;gap:14px;flex-wrap:wrap;margin:5px 0 0;color:#aaa39a;font-size:10px}
    .temperature-flavor-profile__legend-item{display:flex;align-items:center;gap:6px}.temperature-flavor-profile__legend-line{display:block;width:25px;border-top:2px solid #e9e4da}.temperature-flavor-profile__legend-line.is-sweet{border-top-style:dashed;opacity:.75}.temperature-flavor-profile__legend-line.is-bitter{border-top-style:dotted;opacity:.55}
    .temperature-flavor-profile__stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.temperature-flavor-profile__stage{min-width:0;padding:8px 9px;border-left:4px solid var(--flavor-color,#77736d);background:rgba(255,255,255,.025)}
    .temperature-flavor-profile__stage-head{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}.temperature-flavor-profile__stage-name{font-size:11px;color:#ddd7cd}.temperature-flavor-profile__family{font-size:10px;color:var(--flavor-color,#aaa)}
    .temperature-flavor-profile__tags{margin-top:4px;color:#aaa49b;font-size:10px;line-height:1.45;overflow-wrap:anywhere}.temperature-flavor-profile__tags.is-empty{color:#6f6b65}
    @media(max-width:820px){.sensory-conclusion__grid{grid-template-columns:1fr}.temperature-flavor-profile__stages{grid-template-columns:1fr}.temperature-flavor-profile{padding:9px}}
  `;
  document.head.append(style);
}

function yFor(value: number, top: number, bottom: number): number {
  const bounded = Math.max(0, Math.min(15, value));
  return bottom - (bounded / 15) * (bottom - top);
}

function traceThreePointCurve(ctx: CanvasRenderingContext2D, xs: readonly number[], ys: readonly number[]): void {
  ctx.moveTo(xs[0]!, ys[0]!);
  for (let index = 0; index < 2; index += 1) {
    const x0 = xs[index]!;
    const x1 = xs[index + 1]!;
    const y0 = ys[index]!;
    const y1 = ys[index + 1]!;
    const dx = (x1 - x0) / 2;
    ctx.bezierCurveTo(x0 + dx, y0, x1 - dx, y1, x1, y1);
  }
}

function stageEnvelopeValue(point: TemperatureFlavorPoint): number | undefined {
  const present = [point.acidity, point.sweetness, point.bitterness]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? Math.max(...present) : undefined;
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  values: readonly (number | undefined)[],
  top: number,
  bottom: number,
  dash: readonly number[],
  alpha: number
): void {
  const ys = values.map((value) => value === undefined ? undefined : yFor(value, top, bottom));
  ctx.save();
  ctx.strokeStyle = "#eee9df";
  ctx.fillStyle = "#eee9df";
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2.2;
  ctx.setLineDash([...dash]);

  if (ys.every((value): value is number => value !== undefined)) {
    ctx.beginPath();
    traceThreePointCurve(ctx, xs, ys);
    ctx.stroke();
  } else {
    for (let index = 0; index < 2; index += 1) {
      const y0 = ys[index];
      const y1 = ys[index + 1];
      if (y0 === undefined || y1 === undefined) continue;
      const x0 = xs[index]!;
      const x1 = xs[index + 1]!;
      const dx = (x1 - x0) / 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + dx, y0, x1 - dx, y1, x1, y1);
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
  for (let index = 0; index < xs.length; index += 1) {
    const y = ys[index];
    if (y === undefined) continue;
    ctx.beginPath();
    ctx.arc(xs[index]!, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTemperatureProfile(canvas: HTMLCanvasElement, points: readonly TemperatureFlavorPoint[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || points.length !== 3) return;
  const width = canvas.width;
  const height = canvas.height;
  const left = 58;
  const right = width - 24;
  const top = 28;
  const bottom = height - 46;
  const xs = [left, (left + right) / 2, right];

  ctx.clearRect(0, 0, width, height);
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(220,215,205,.62)";
  ctx.strokeStyle = "rgba(255,255,255,.09)";
  ctx.lineWidth = 1;
  for (const tick of [0, 5, 10, 15]) {
    const y = yFor(tick, top, bottom);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillText(String(tick), left - 10, y);
  }
  for (const x of xs) {
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
  }

  const envelopeValues = points.map(stageEnvelopeValue);
  if (envelopeValues.every((value): value is number => value !== undefined)) {
    const envelopeYs = envelopeValues.map((value) => yFor(value, top, bottom));
    const gradient = ctx.createLinearGradient(left, 0, right, 0);
    gradient.addColorStop(0, FLAVOR_FAMILY_COLORS[points[0]!.flavorFamily]);
    gradient.addColorStop(0.5, FLAVOR_FAMILY_COLORS[points[1]!.flavorFamily]);
    gradient.addColorStop(1, FLAVOR_FAMILY_COLORS[points[2]!.flavorFamily]);
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(xs[0]!, bottom);
    ctx.lineTo(xs[0]!, envelopeYs[0]!);
    traceThreePointCurve(ctx, xs, envelopeYs);
    ctx.lineTo(xs[2]!, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawSeries(ctx, xs, points.map((point) => point.acidity), top, bottom, [], 1);
  drawSeries(ctx, xs, points.map((point) => point.sweetness), top, bottom, [9, 5], 0.75);
  drawSeries(ctx, xs, points.map((point) => point.bitterness), top, bottom, [2, 5], 0.52);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(230,225,215,.78)";
  points.forEach((point, index) => ctx.fillText(point.label, xs[index]!, bottom + 12));
}

function tagLabel(tagId: string): string {
  return descriptorDefinition(tagId)?.label ?? tagId;
}

export function renderSensoryProfileConclusion(root: HTMLElement, observations: readonly SensoryObservation[]): void {
  ensureStyles();
  const profile = deriveSensoryProfileConclusion(observations);
  const recordedAxes = profile.radar.filter((axis) => axis.recorded).length;
  const section = element("section", "sensory-conclusion");
  section.append(element(
    "p",
    "sensory-conclusion__completeness",
    `结构画像 ${recordedAxes}/7 维已记录；未记录维度显示为—，不按0处理。`
  ));
  const grid = element("div", "sensory-conclusion__grid");
  const radar = element("div", "sensory-conclusion__panel");
  renderRadarSummary(radar, profile.radar, {
    title: "风味结构画像",
    ariaLabel: "香气、酸质、甜感、苦味、口感、余韵与洁净度结构雷达图"
  });

  const evolution = element("section", "sensory-conclusion__panel temperature-flavor-profile");
  evolution.append(
    element("h3", "temperature-flavor-profile__title", "温度—风味演化"),
    element("p", "temperature-flavor-profile__note", "横轴表示高温→中温→低温；线高为0–15强度。填充色仅表达风味倾向，不表示温度、质量或得分；未记录点留空，不以0补线。")
  );
  const canvas = element("canvas", "temperature-flavor-profile__canvas");
  canvas.width = 760; canvas.height = 330;
  canvas.setAttribute("aria-label", "高温、中温、低温酸甜苦强度变化与风味倾向色场");
  evolution.append(canvas);
  const legend = element("div", "temperature-flavor-profile__legend");
  for (const [label, className] of [["酸质", ""], ["甜感", "is-sweet"], ["苦味", "is-bitter"]] as const) {
    const item = element("span", "temperature-flavor-profile__legend-item");
    item.append(element("i", `temperature-flavor-profile__legend-line ${className}`), document.createTextNode(label));
    legend.append(item);
  }
  evolution.append(legend);

  const stages = element("div", "temperature-flavor-profile__stages");
  for (const point of profile.temperature) {
    const card = element("div", "temperature-flavor-profile__stage");
    card.style.setProperty("--flavor-color", FLAVOR_FAMILY_COLORS[point.flavorFamily]);
    const head = element("div", "temperature-flavor-profile__stage-head");
    head.append(element("strong", "temperature-flavor-profile__stage-name", point.label), element("span", "temperature-flavor-profile__family", point.flavorFamilyLabel));
    const tags = element("div", `temperature-flavor-profile__tags${point.tags.length ? "" : " is-empty"}`, point.tags.length ? point.tags.map(tagLabel).join(" · ") : "未记录突出风味");
    card.append(head, tags); stages.append(card);
  }
  evolution.append(stages);
  grid.append(radar, evolution);
  section.append(grid);
  root.append(section);
  drawTemperatureProfile(canvas, profile.temperature);
}
