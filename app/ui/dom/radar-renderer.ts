import type { RadarAxisValue } from "../sample-summary-model";
import { clearElement, element } from "./dom-helpers";

export interface RadarRenderOptions {
  title?: string;
  ariaLabel?: string;
}

export function renderRadarSummary(
  root: HTMLElement,
  axes: readonly RadarAxisValue[],
  options: RadarRenderOptions = {}
): void {
  clearElement(root);
  const wrap = element("section", "radar-summary");
  const title = element("h2", "radar-summary__title", options.title ?? "感官趋势");
  const canvas = element("canvas", "radar-summary__canvas");
  canvas.width = 520;
  canvas.height = 420;
  canvas.setAttribute("aria-label", options.ariaLabel ?? `${options.title ?? "感官趋势"}雷达图`);
  wrap.append(title, canvas);
  root.append(wrap);

  const ctx = canvas.getContext("2d");
  if (!ctx || axes.length < 3) return;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + 8;
  const radius = Math.min(canvas.width, canvas.height) * 0.31;
  const steps = 5;
  const isRecorded = (axis: RadarAxisValue): boolean => axis.recorded !== false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(185,153,90,.34)";
  ctx.fillStyle = "#d8d1c5";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const point = (index: number, magnitude: number): [number, number] => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
    return [cx + Math.cos(angle) * radius * magnitude, cy + Math.sin(angle) * radius * magnitude];
  };

  const dataPoint = (axis: RadarAxisValue, index: number): [number, number] => {
    const magnitude = Math.max(0, Math.min(1, axis.value / axis.max));
    return point(index, magnitude);
  };

  for (let step = 1; step <= steps; step += 1) {
    ctx.beginPath();
    axes.forEach((_, index) => {
      const [x, y] = point(index, step / steps);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  axes.forEach((axis, index) => {
    const [x, y] = point(index, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    const [lx, ly] = point(index, 1.18);
    ctx.fillStyle = isRecorded(axis) ? "#d8d1c5" : "rgba(216,209,197,.46)";
    ctx.fillText(`${axis.label} ${isRecorded(axis) ? axis.value.toFixed(1) : "—"}`, lx, ly);
  });

  const complete = axes.every(isRecorded);
  ctx.strokeStyle = "rgba(185,153,90,.92)";
  ctx.lineWidth = 2;
  if (complete) {
    ctx.beginPath();
    axes.forEach((axis, index) => {
      const [x, y] = dataPoint(axis, index);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(185,153,90,.18)";
    ctx.fill();
    ctx.stroke();
    return;
  }

  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.globalAlpha = 0.7;
  for (let index = 0; index < axes.length; index += 1) {
    const next = (index + 1) % axes.length;
    const currentAxis = axes[index]!;
    const nextAxis = axes[next]!;
    if (!isRecorded(currentAxis) || !isRecorded(nextAxis)) continue;
    const [x0, y0] = dataPoint(currentAxis, index);
    const [x1, y1] = dataPoint(nextAxis, next);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();

  axes.forEach((axis, index) => {
    if (!isRecorded(axis)) return;
    const [x, y] = dataPoint(axis, index);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(185,153,90,.95)";
    ctx.fill();
  });
}
