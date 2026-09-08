import type { OCRBox } from "../../core/ocr-layout-model";
import { recognizeReviewedRegionsFromOriginal, type RegionBatchProgress } from "../../core/sample-region-batch-recognition";
import { proposeSampleRegionsFromGeometry } from "../../core/sample-region-engine";
import {
  buildSegmentationReviewModel,
  linesInsideBox,
  normalizeRegionBox,
  type SegmentationReviewModel,
  type SegmentationReviewRegion
} from "../../core/sample-segmentation-review";
import type { RecognizedPage } from "../../core/sample-recognition-service";
import { createSegmentationImagePreview } from "./image-review-preview";

export interface SegmentationReviewDialogV2Options {
  root: HTMLElement;
  page: RecognizedPage;
  file: File;
  recognizeWholePage?(): Promise<RecognizedPage>;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-segmentation-v2]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseSegmentationV2 = "true";
  style.textContent = `
    .segv2{position:fixed;inset:0;z-index:16000;display:grid;place-items:center;padding:12px;background:rgba(0,0,0,.82);backdrop-filter:blur(4px)}
    .segv2__panel{display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:10px;width:min(980px,100%);height:min(92vh,900px);padding:12px;border:1px solid rgba(214,173,99,.34);border-radius:14px;background:#151515;color:#f2eee7;box-shadow:0 20px 60px rgba(0,0,0,.55)}
    .segv2__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.segv2__title{margin:0;font-size:17px}.segv2__help{margin:4px 0 0;color:#aaa39a;font-size:11px;line-height:1.45}
    .segv2__close{border:0;background:transparent;color:#aaa39a;font-size:22px;cursor:pointer}
    .segv2__body{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:10px}@media(max-width:720px){.segv2__body{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}}
    .segv2__stage{position:relative;min-height:260px;overflow:auto;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:#0d0d0d;display:grid;place-items:center}
    .segv2__canvas{position:relative;width:min(100%,780px);user-select:none;touch-action:none;background:#202020;overflow:hidden}
    .segv2__image{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}.segv2__fallback{position:absolute;inset:0;display:grid;place-items:center;color:#777;font-size:12px;background:#1c1c1c}
    .segv2__line{position:absolute;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.025);pointer-events:none}
    .segv2__region{position:absolute;box-sizing:border-box;border:2px solid #d6ad63;background:rgba(214,173,99,.07);cursor:move;touch-action:none}.segv2__region.is-selected{border-width:3px;background:rgba(214,173,99,.12);box-shadow:0 0 0 1px rgba(0,0,0,.6)}
    .segv2__tag{position:absolute;left:-2px;top:-22px;min-width:24px;padding:3px 6px;border-radius:5px 5px 5px 0;background:#d6ad63;color:#111;font:700 10px/1 sans-serif;text-align:center}
    .segv2__handle{position:absolute;width:13px;height:13px;border:2px solid #111;border-radius:50%;background:#f4d28e;transform:translate(-50%,-50%);touch-action:none}.segv2__handle[data-h='nw']{left:0;top:0}.segv2__handle[data-h='ne']{left:100%;top:0}.segv2__handle[data-h='sw']{left:0;top:100%}.segv2__handle[data-h='se']{left:100%;top:100%}
    .segv2__side{display:grid;align-content:start;gap:8px}.segv2__status{min-height:34px;padding:8px;border-radius:8px;background:#1d1d1d;color:#bdb5a9;font-size:11px;line-height:1.45}
    .segv2__controls{display:grid;grid-template-columns:1fr 1fr;gap:6px}.segv2 button{min-height:38px;border:1px solid rgba(214,173,99,.30);border-radius:8px;background:#242424;color:#eee7dc;font:inherit;font-size:12px;cursor:pointer}.segv2 button:disabled{opacity:.45;cursor:default}.segv2 button[data-primary]{background:#d6ad63;color:#111;font-weight:760}.segv2 button[data-danger]{color:#e8a0a0}
    .segv2__progress{display:grid;gap:6px;padding:8px;border:1px solid rgba(214,173,99,.18);border-radius:8px;background:#171717}.segv2__progress[hidden]{display:none}.segv2__progress-head{display:flex;justify-content:space-between;gap:8px;color:#bbb3a6;font-size:10px}.segv2__track{height:5px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.08)}.segv2__fill{height:100%;width:0;background:#d6ad63;transition:width .18s linear}.segv2__progress-note{color:#817b73;font-size:9px}
    .segv2__foot{display:grid;grid-template-columns:.8fr 1fr 1.4fr;gap:7px}@media(max-width:560px){.segv2__foot{grid-template-columns:1fr}.segv2__panel{height:96vh;padding:9px}}
  `;
  document.head.append(style);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, action: () => void | Promise<void>): HTMLButtonElement {
  const node = element("button", "", text);
  node.type = "button";
  node.addEventListener("click", () => void action());
  return node;
}

function boxCss(box: OCRBox): Partial<CSSStyleDeclaration> {
  return {
    left: `${box.left * 100}%`,
    top: `${box.top * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`
  };
}

function unionBox(a: OCRBox, b: OCRBox): OCRBox {
  return normalizeRegionBox({
    left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom)
  });
}

function modelFromGeometry(base: SegmentationReviewModel): SegmentationReviewModel {
  const result = proposeSampleRegionsFromGeometry(base.lines.map((line) => ({ id: line.id, box: line.box })));
  if (result.regions.length < 2) return base;
  return {
    ...base,
    regions: result.regions.map((region, index) => ({
      id: `geometry-${index + 1}`,
      label: "",
      box: region.box,
      lineIds: region.lineIds
    }))
  };
}

function withRegions(model: SegmentationReviewModel, regions: readonly SegmentationReviewRegion[]): SegmentationReviewModel {
  return { ...model, regions };
}

function regionWithBox(model: SegmentationReviewModel, region: SegmentationReviewRegion, box: OCRBox): SegmentationReviewRegion {
  return { ...region, box, lineIds: linesInsideBox(model.lines, box) };
}

function splitRegion(model: SegmentationReviewModel, index: number, vertical: boolean): SegmentationReviewModel {
  const region = model.regions[index];
  if (!region) return model;
  const firstBox = vertical
    ? normalizeRegionBox({ left: region.box.left, top: region.box.top, right: region.box.centerX, bottom: region.box.bottom })
    : normalizeRegionBox({ left: region.box.left, top: region.box.top, right: region.box.right, bottom: region.box.centerY });
  const secondBox = vertical
    ? normalizeRegionBox({ left: region.box.centerX, top: region.box.top, right: region.box.right, bottom: region.box.bottom })
    : normalizeRegionBox({ left: region.box.left, top: region.box.centerY, right: region.box.right, bottom: region.box.bottom });
  const first = regionWithBox(model, { ...region, id: `${region.id}-a`, label: "" }, firstBox);
  const second = regionWithBox(model, { ...region, id: `${region.id}-b`, label: "" }, secondBox);
  return withRegions(model, model.regions.flatMap((item, itemIndex) => itemIndex === index ? [first, second] : [item]));
}

class SmoothBatchProgress {
  private timer?: ReturnType<typeof setInterval>;
  private displayed = 0;
  private confirmed = 0;
  private ceiling = 0.05;
  private remainingMs?: number;
  private message = "准备识别";

  constructor(
    private readonly shell: HTMLElement,
    private readonly fill: HTMLElement,
    private readonly label: HTMLElement,
    private readonly eta: HTMLElement
  ) {}

  start(): void {
    this.shell.hidden = false;
    this.displayed = 0.01;
    this.confirmed = 0.01;
    this.render();
    this.timer = setInterval(() => this.tick(), 120);
  }

  update(progress: RegionBatchProgress): void {
    this.confirmed = Math.max(this.confirmed, progress.fraction);
    this.message = progress.message;
    this.remainingMs = progress.estimatedRemainingMs;
    if (progress.phase === "recognizing") {
      const perItemEnd = 0.04 + (progress.current / Math.max(1, progress.total)) * 0.88;
      this.ceiling = Math.max(this.ceiling, Math.min(0.97, perItemEnd - 0.008));
    } else if (progress.phase === "completed") this.ceiling = 1;
    else this.ceiling = Math.max(this.ceiling, Math.min(0.98, progress.fraction + 0.025));
    this.render();
  }

  finish(): void {
    this.confirmed = 1;
    this.ceiling = 1;
    this.displayed = 1;
    this.message = "识别完成";
    this.remainingMs = 0;
    this.render();
    this.stopTimer();
  }

  fail(message: string): void {
    this.message = message;
    this.remainingMs = undefined;
    this.render();
    this.stopTimer();
    setTimeout(() => { this.shell.hidden = true; }, 1200);
  }

  dispose(): void { this.stopTimer(); }

  private tick(): void {
    const target = Math.max(this.confirmed, Math.min(this.ceiling, 0.985));
    if (this.displayed < target) {
      const delta = target - this.displayed;
      this.displayed = Math.min(target, this.displayed + Math.max(0.0015, delta * 0.085));
      this.render();
    }
    if (this.remainingMs !== undefined) this.remainingMs = Math.max(0, this.remainingMs - 120);
  }

  private render(): void {
    this.fill.style.width = `${Math.max(0, Math.min(100, this.displayed * 100)).toFixed(2)}%`;
    this.label.textContent = this.message;
    this.eta.textContent = this.remainingMs === undefined
      ? "预计时间计算中"
      : this.remainingMs < 800 ? "即将完成" : `预计剩余 ${Math.max(1, Math.round(this.remainingMs / 1000))} 秒`;
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export function openSegmentationReviewDialogV2(options: SegmentationReviewDialogV2Options): Promise<RecognizedPage> {
  installStyles();
  const built = buildSegmentationReviewModel(options.page);
  if (!built) return Promise.resolve(options.page);

  return new Promise<RecognizedPage>((resolve) => {
    let model = modelFromGeometry(built);
    let selected = 0;
    let busy = false;
    let previewUrl = "";

    const overlay = element("section", "segv2");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "原图分区复核");
    const panel = element("div", "segv2__panel");
    const head = element("header", "segv2__head");
    const headCopy = element("div");
    headCopy.append(element("h2", "segv2__title", "原图分区复核"), element("p", "segv2__help", "自动框只使用文字块位置，不使用第一次 OCR 的文字内容。拖动框或四角后，确认时每个框都会从原始照片重新识别。"));
    const close = button("×", () => finish(options.page)); close.className = "segv2__close";
    head.append(headCopy, close);

    const body = element("div", "segv2__body");
    const stage = element("div", "segv2__stage");
    const canvas = element("div", "segv2__canvas");
    canvas.style.aspectRatio = "4 / 3";
    const fallback = element("div", "segv2__fallback", "正在生成轻量原图预览…");
    canvas.append(fallback);
    stage.append(canvas);

    const side = element("aside", "segv2__side");
    const status = element("div", "segv2__status");
    const controls = element("div", "segv2__controls");
    const add = button("新增框", () => {
      if (busy) return;
      const box = normalizeRegionBox({ left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 });
      const region: SegmentationReviewRegion = { id: `manual-${Date.now()}`, label: "", box, lineIds: linesInsideBox(model.lines, box) };
      model = withRegions(model, [...model.regions, region]); selected = model.regions.length - 1; render();
    });
    const splitH = button("上下拆分", () => { if (!busy) { model = splitRegion(model, selected, false); selected = Math.min(selected, model.regions.length - 1); render(); } });
    const splitV = button("左右拆分", () => { if (!busy) { model = splitRegion(model, selected, true); selected = Math.min(selected, model.regions.length - 1); render(); } });
    const mergeNext = button("合并下一框", () => {
      if (busy || model.regions.length < 2) return;
      const next = selected + 1 < model.regions.length ? selected + 1 : selected - 1;
      if (next < 0) return;
      const a = model.regions[selected], b = model.regions[next];
      const mergedBox = unionBox(a.box, b.box);
      const merged: SegmentationReviewRegion = { id: `${a.id}+${b.id}`, label: "", box: mergedBox, lineIds: linesInsideBox(model.lines, mergedBox) };
      const low = Math.min(selected, next), high = Math.max(selected, next);
      model = withRegions(model, model.regions.flatMap((item, index) => index === low ? [merged] : index === high ? [] : [item]));
      selected = low; render();
    });
    const remove = button("删除当前框", () => {
      if (busy || model.regions.length <= 1) return;
      model = withRegions(model, model.regions.filter((_, index) => index !== selected)); selected = Math.max(0, Math.min(selected, model.regions.length - 1)); render();
    }); remove.dataset.danger = "true";
    const reset = button("恢复自动框", () => { if (!busy) { model = modelFromGeometry(built); selected = 0; render(); } });
    controls.append(add, splitH, splitV, mergeNext, remove, reset);

    const progressShell = element("div", "segv2__progress"); progressShell.hidden = true;
    const progressHead = element("div", "segv2__progress-head");
    const progressLabel = element("span", "", "准备识别"); const progressEta = element("span", "", "");
    progressHead.append(progressLabel, progressEta);
    const track = element("div", "segv2__track"); const fill = element("div", "segv2__fill"); track.append(fill);
    progressShell.append(progressHead, track, element("div", "segv2__progress-note", "进度按预计耗时连续推进；分区实际完成会校准预测，不允许倒退。"));
    const smooth = new SmoothBatchProgress(progressShell, fill, progressLabel, progressEta);
    side.append(status, controls, progressShell);
    body.append(stage, side);

    const foot = element("footer", "segv2__foot");
    const cancel = button("取消，保留原结果", () => finish(options.page));
    const rescan = button("整图重新识别", async () => {
      if (busy || !options.recognizeWholePage) return;
      setBusy(true); status.textContent = "正在重新读取完整原图…";
      try { finish(await options.recognizeWholePage()); }
      catch (error) { status.textContent = `整图重新识别失败：${String((error as Error)?.message ?? error)}`; setBusy(false); }
    });
    rescan.disabled = !options.recognizeWholePage;
    const apply = button("按当前分区从原图逐一识别", async () => {
      if (busy) return;
      setBusy(true); smooth.start();
      try {
        const result = await recognizeReviewedRegionsFromOriginal({ file: options.file, page: options.page, model, onProgress: (state) => smooth.update(state) });
        smooth.finish();
        status.textContent = `已从原图重新识别 ${result.page.samples.length} 个分区。`;
        await new Promise((done) => setTimeout(done, 280));
        finish(result.page);
      } catch (error) {
        const message = `分区重新识别失败：${String((error as Error)?.message ?? error)}`;
        status.textContent = `${message}。未使用旧 OCR 结果完成本次分区。`;
        smooth.fail(message); setBusy(false);
      }
    }); apply.dataset.primary = "true";
    foot.append(cancel, rescan, apply);
    panel.append(head, body, foot); overlay.append(panel); document.body.append(overlay);

    const allButtons = () => [...overlay.querySelectorAll<HTMLButtonElement>("button")];
    function setBusy(value: boolean): void {
      busy = value;
      overlay.setAttribute("aria-busy", value ? "true" : "false");
      for (const item of allButtons()) item.disabled = value;
      if (!value) { close.disabled = false; cancel.disabled = false; rescan.disabled = !options.recognizeWholePage; }
    }

    function finish(page: RecognizedPage): void {
      smooth.dispose();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      overlay.remove();
      resolve(page);
    }

    function replaceBox(index: number, next: OCRBox): void {
      const region = model.regions[index]; if (!region) return;
      const regions = [...model.regions]; regions[index] = regionWithBox(model, region, next); model = withRegions(model, regions);
    }

    function render(): void {
      canvas.querySelectorAll(".segv2__line,.segv2__region").forEach((node) => node.remove());
      model.lines.forEach((line) => {
        const node = element("div", "segv2__line"); Object.assign(node.style, boxCss(line.box)); canvas.append(node);
      });
      model.regions.forEach((region, index) => {
        const node = element("div", `segv2__region${index === selected ? " is-selected" : ""}`); Object.assign(node.style, boxCss(region.box));
        node.dataset.index = String(index); node.append(element("span", "segv2__tag", String(index + 1)));
        for (const handleName of ["nw", "ne", "sw", "se"] as const) { const handle = element("span", "segv2__handle"); handle.dataset.h = handleName; node.append(handle); }
        node.addEventListener("pointerdown", (event) => beginDrag(event, index)); canvas.append(node);
      });
      status.textContent = `当前 ${model.regions.length} 个分区；选中第 ${selected + 1} 个。框内旧文字只用于显示位置，确认后全部由原图重新 OCR。`;
    }

    function beginDrag(event: PointerEvent, index: number): void {
      if (busy) return;
      event.preventDefault(); event.stopPropagation(); selected = index; render();
      const region = model.regions[index]; if (!region) return;
      const handle = (event.target as HTMLElement)?.dataset.h ?? "move";
      const rect = canvas.getBoundingClientRect();
      const startX = event.clientX, startY = event.clientY, start = region.box;
      const move = (nextEvent: PointerEvent) => {
        const dx = (nextEvent.clientX - startX) / Math.max(1, rect.width);
        const dy = (nextEvent.clientY - startY) / Math.max(1, rect.height);
        let left = start.left, top = start.top, right = start.right, bottom = start.bottom;
        if (handle === "move") {
          const width = start.width, height = start.height;
          left = Math.max(0, Math.min(1 - width, start.left + dx)); top = Math.max(0, Math.min(1 - height, start.top + dy)); right = left + width; bottom = top + height;
        } else {
          if (handle.includes("w")) left = Math.max(0, Math.min(right - 0.01, start.left + dx));
          if (handle.includes("e")) right = Math.min(1, Math.max(left + 0.01, start.right + dx));
          if (handle.includes("n")) top = Math.max(0, Math.min(bottom - 0.01, start.top + dy));
          if (handle.includes("s")) bottom = Math.min(1, Math.max(top + 0.01, start.bottom + dy));
        }
        try { replaceBox(index, normalizeRegionBox({ left, top, right, bottom })); render(); } catch { /* keep last valid box */ }
      };
      const up = () => { globalThis.removeEventListener("pointermove", move); globalThis.removeEventListener("pointerup", up); };
      globalThis.addEventListener("pointermove", move); globalThis.addEventListener("pointerup", up, { once: true });
    }

    render();
    void createSegmentationImagePreview(options.file).then((preview) => {
      if (!document.body.contains(overlay) || !preview) { fallback.textContent = "预览不可用，但分区坐标仍对应原图"; return; }
      previewUrl = URL.createObjectURL(preview.blob);
      const image = element("img", "segv2__image"); image.alt = "分区审阅轻量预览"; image.src = previewUrl;
      canvas.style.aspectRatio = `${preview.width} / ${preview.height}`; fallback.remove(); canvas.prepend(image);
    }).catch(() => { fallback.textContent = "预览生成失败；不会影响原图 OCR"; });
  });
}
