import type { RadarAxisValue } from "../sample-summary-model";
import { clearElement, element } from "./dom-helpers";

export function renderRadarSummary(root: HTMLElement, axes: readonly RadarAxisValue[]): void {
  clearElement(root);
  const wrap = element("section", "radar-summary");
  const title = element("h2", "radar-summary__title", "感官趋势");
  const canvas = element("canvas", "radar-summary__canvas");
  canvas.width = 520;
  canvas.height = 420;
  canvas.setAttribute("aria-label", "酸质、甜感、苦味、口感与余韵雷达图");
  wrap.append(title, canvas);
  root.append(wrap);

  const ctx = canvas.getContext("2d");
  if (!ctx || axes.length < 3) return;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + 8;
  const radius = Math.min(canvas.width, canvas.height) * 0.31;
  const steps = 5;

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
    ctx.fillText(`${axis.label} ${axis.value.toFixed(1)}`, lx, ly);
  });

  ctx.beginPath();
  axes.forEach((axis, index) => {
    const magnitude = Math.max(0, Math.min(1, axis.value / axis.max));
    const [x, y] = point(index, magnitude);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(185,153,90,.18)";
  ctx.strokeStyle = "rgba(185,153,90,.92)";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
}
