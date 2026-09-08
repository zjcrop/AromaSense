import type { OCRBox } from "../../core/ocr-layout-model";
import { createReviewedRegionCropBatch } from "../../core/reviewed-region-crop-batch";
import type { SegmentationReviewRegion } from "../../core/sample-segmentation-review";
import { requireLuckyBeanRecognitionCore } from "../../core/luckybean-upstream-adapter";
import { createSegmentationImagePreview } from "./image-review-preview";

interface Point { x: number; y: number }
interface ManualRegion { id: string; box: OCRBox }

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function boxFromPoints(a: Point, b: Point): OCRBox {
  const left = clamp01(Math.min(a.x, b.x));
  const top = clamp01(Math.min(a.y, b.y));
  const right = clamp01(Math.max(a.x, b.x));
  const bottom = clamp01(Math.max(a.y, b.y));
  return {
    left, top, right, bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}
function regionValid(box: OCRBox): boolean {
  return box.width >= 0.035 && box.height >= 0.035 && box.width * box.height >= 0.0035;
}
function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-manual-split]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseManualSplit = "true";
  style.textContent = `
    .manual-split-photo{position:fixed;inset:0;z-index:1900;display:grid;place-items:center;padding:12px;background:rgba(0,0,0,.82);backdrop-filter:blur(4px)}
    .manual-split-photo__panel{width:min(920px,100%);max-height:96dvh;overflow:auto;border:1px solid rgba(185,153,90,.42);border-radius:14px;padding:14px;background:#171717;color:#f4efe4;box-shadow:0 20px 55px rgba(0,0,0,.62)}
    .manual-split-photo__title{margin:0;font-size:18px}.manual-split-photo__help{margin:5px 0 10px;color:#aaa39a;font-size:11px;line-height:1.5}
    .manual-split-photo__stage{position:relative;width:max-content;max-width:100%;margin:0 auto 10px;touch-action:none;cursor:crosshair;user-select:none}
    .manual-split-photo__image{display:block;max-width:100%;max-height:64dvh;border-radius:8px;pointer-events:none}
    .manual-split-photo__region,.manual-split-photo__draft{position:absolute;box-sizing:border-box;border:2px solid #d5ad60;background:rgba(213,173,96,.09);pointer-events:none}
    .manual-split-photo__region::after{content:attr(data-index);position:absolute;left:2px;top:2px;min-width:20px;height:20px;border-radius:10px;padding:0 5px;background:#d5ad60;color:#111;font:700 12px/20px sans-serif;text-align:center}
    .manual-split-photo__draft{border-style:dashed;background:rgba(255,255,255,.05)}
    .manual-split-photo__summary{min-height:20px;margin:6px 0;color:#b8afa0;font-size:11px}
    .manual-split-photo__tools,.manual-split-photo__actions{display:flex;flex-wrap:wrap;gap:8px}.manual-split-photo__actions{justify-content:flex-end;margin-top:10px}
    .manual-split-photo button{min-height:40px;border:1px solid rgba(185,153,90,.36);border-radius:9px;padding:7px 12px;background:#242424;color:#e7d9ba;font-weight:700}.manual-split-photo button.primary{border-color:#b9995a;background:#b9995a;color:#111}.manual-split-photo button:disabled{opacity:.45}
  `;
  document.head.append(style);
}

function existingGalleryInput(): HTMLInputElement | undefined {
  const root = document.querySelector<HTMLElement>(".batch-setup");
  if (!root) return undefined;
  return [...root.querySelectorAll<HTMLInputElement>('input[type="file"][accept="image/*"]')]
    .find((input) => input.multiple && !input.hasAttribute("capture"));
}

function toReviewRegions(regions: readonly ManualRegion[]): SegmentationReviewRegion[] {
  return regions.map((region, index) => ({
    id: region.id,
    label: `手工分区 ${index + 1}`,
    box: region.box,
    lineIds: []
  }));
}

async function cropAndDispatch(source: File, regions: readonly ManualRegion[]): Promise<void> {
  const gallery = existingGalleryInput();
  if (!gallery) throw new Error("当前批量识别入口不可用");
  if (typeof DataTransfer !== "function") throw new Error("当前浏览器不支持将手工分区安全交给现有批量识别流程");
  const crops = await createReviewedRegionCropBatch(source, toReviewRegions(regions));
  if (!crops?.length || crops.length !== regions.length) throw new Error("手工分区 Worker 未能生成完整裁切结果");
  const stem = String(source.name || "capture").replace(/\.[^.]+$/, "");
  const transfer = new DataTransfer();
  crops.forEach((crop, index) => {
    transfer.items.add(new File([crop.blob], `${stem}-manual-split-${String(index + 1).padStart(2, "0")}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now()
    }));
  });
  gallery.files = transfer.files;
  gallery.dispatchEvent(new Event("change", { bubbles: true }));
}

async function openManualSplitDialog(source: File): Promise<void> {
  installStyles();
  const preview = await createSegmentationImagePreview(source, 900);
  if (!preview) throw new Error("当前设备无法建立低内存手工分区预览");
  const previewUrl = URL.createObjectURL(preview.blob);

  const overlay = document.createElement("div");
  overlay.className = "manual-split-photo";
  overlay.innerHTML = `
    <section class="manual-split-photo__panel" role="dialog" aria-modal="true" aria-label="手工切分拍照">
      <h2 class="manual-split-photo__title">手工切分拍照</h2>
      <p class="manual-split-photo__help">在一张内容复杂的照片上依次框选真正需要识别的区域。每个框会作为一张独立 OCR 输入，原图不会在主线程做全尺寸解码。</p>
      <div class="manual-split-photo__stage"><img class="manual-split-photo__image" alt="待切分照片"><div class="manual-split-photo__draft" hidden></div></div>
      <p class="manual-split-photo__summary">拖动框选第 1 个区域。</p>
      <div class="manual-split-photo__tools"><button type="button" data-full>整图作为一区</button><button type="button" data-undo>撤销上一区</button><button type="button" data-clear>清空分区</button></div>
      <div class="manual-split-photo__actions"><button type="button" data-cancel>取消</button><button type="button" class="primary" data-confirm disabled>切分并识别</button></div>
    </section>`;
  document.body.append(overlay);

  const image = overlay.querySelector<HTMLImageElement>(".manual-split-photo__image")!;
  const stage = overlay.querySelector<HTMLElement>(".manual-split-photo__stage")!;
  const draft = overlay.querySelector<HTMLElement>(".manual-split-photo__draft")!;
  const summary = overlay.querySelector<HTMLElement>(".manual-split-photo__summary")!;
  const confirm = overlay.querySelector<HTMLButtonElement>("[data-confirm]")!;
  image.src = previewUrl;

  const regions: ManualRegion[] = [];
  let activePointer: number | undefined;
  let start: Point | undefined;
  let current: OCRBox | undefined;

  const point = (event: PointerEvent): Point => {
    const rect = image.getBoundingClientRect();
    return { x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)), y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height)) };
  };
  const position = (element: HTMLElement, box: OCRBox): void => {
    const rect = image.getBoundingClientRect();
    element.style.left = `${box.left * rect.width}px`;
    element.style.top = `${box.top * rect.height}px`;
    element.style.width = `${box.width * rect.width}px`;
    element.style.height = `${box.height * rect.height}px`;
  };
  const render = (): void => {
    stage.querySelectorAll(".manual-split-photo__region").forEach((node) => node.remove());
    regions.forEach((region, index) => {
      const marker = document.createElement("div");
      marker.className = "manual-split-photo__region";
      marker.dataset.index = String(index + 1);
      position(marker, region.box);
      stage.append(marker);
    });
    confirm.disabled = regions.length === 0;
    summary.textContent = regions.length
      ? `已建立 ${regions.length} 个分区；继续拖动可增加区域。确认后按分区顺序进入现有多图 OCR。`
      : "拖动框选第 1 个区域。";
  };
  const close = (): void => {
    URL.revokeObjectURL(previewUrl);
    overlay.remove();
  };

  stage.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    activePointer = event.pointerId;
    start = point(event);
    current = undefined;
    stage.setPointerCapture?.(event.pointerId);
    draft.hidden = false;
    position(draft, boxFromPoints(start, start));
    event.preventDefault();
  });
  stage.addEventListener("pointermove", (event) => {
    if (activePointer !== event.pointerId || !start) return;
    current = boxFromPoints(start, point(event));
    position(draft, current);
    event.preventDefault();
  });
  const finishPointer = (event: PointerEvent): void => {
    if (activePointer !== event.pointerId) return;
    activePointer = undefined;
    draft.hidden = true;
    if (current && regionValid(current)) {
      regions.push({ id: `manual-${Date.now().toString(36)}-${regions.length + 1}`, box: current });
    } else if (current) {
      summary.textContent = "该框选区域过小，已忽略；请重新框选。";
    }
    start = undefined;
    current = undefined;
    render();
    event.preventDefault();
  };
  stage.addEventListener("pointerup", finishPointer);
  stage.addEventListener("pointercancel", finishPointer);
  window.addEventListener("resize", render, { signal: AbortSignal.timeout(60_000) });

  overlay.querySelector<HTMLButtonElement>("[data-full]")!.onclick = () => {
    regions.splice(0, regions.length, { id: `manual-${Date.now().toString(36)}-full`, box: boxFromPoints({ x: 0, y: 0 }, { x: 1, y: 1 }) });
    render();
  };
  overlay.querySelector<HTMLButtonElement>("[data-undo]")!.onclick = () => { regions.pop(); render(); };
  overlay.querySelector<HTMLButtonElement>("[data-clear]")!.onclick = () => { regions.length = 0; render(); };
  overlay.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = close;
  confirm.onclick = async () => {
    confirm.disabled = true;
    summary.textContent = `正在 Worker 中切分 ${regions.length} 个区域…`;
    try {
      await cropAndDispatch(source, regions);
      close();
    } catch (error) {
      confirm.disabled = false;
      summary.textContent = `切分失败：${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

async function captureForManualSplit(): Promise<void> {
  const core = requireLuckyBeanRecognitionCore();
  void core.beginOcrSession?.("aromasense-manual-split-photo");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.setAttribute("capture", "environment");
  input.hidden = true;
  document.body.append(input);
  try {
    const file = await new Promise<File | undefined>((resolve) => {
      input.onchange = () => resolve(input.files?.[0]);
      input.click();
    });
    if (file) await openManualSplitDialog(file);
  } finally {
    input.remove();
  }
}

function installButton(actions: HTMLElement): void {
  if (actions.querySelector("[data-manual-split-photo]")) return;
  const control = document.createElement("button");
  control.type = "button";
  control.className = "batch-setup__capture batch-setup__home-capture-action";
  control.dataset.manualSplitPhoto = "true";
  control.textContent = "手工切分拍照";
  control.addEventListener("click", () => void captureForManualSplit().catch((error) => {
    window.alert(`手工切分拍照失败：${error instanceof Error ? error.message : String(error)}`);
  }));
  const second = actions.children.item(1);
  if (second) actions.insertBefore(control, second);
  else actions.append(control);
}

function scan(): void {
  document.querySelectorAll<HTMLElement>(".batch-setup__capture-actions").forEach(installButton);
}

scan();
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
