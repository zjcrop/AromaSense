import { createSegmentationImagePreview } from "./image-review-preview";
import type { ManualROIBox } from "../../core/sample-manual-roi-recognition";
import { button, element } from "./dom-helpers";

export interface ManualROIRecognitionDialogOptions {
  root: HTMLElement;
  file: File;
  onRecognize(box: ManualROIBox): void | Promise<void>;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-manual-roi]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseManualRoi = "true";
  style.textContent = `
    .manual-roi{position:fixed;inset:0;z-index:14050;display:grid;place-items:center;padding:14px;background:rgba(0,0,0,.78);backdrop-filter:blur(5px)}
    .manual-roi__panel{width:min(880px,100%);max-height:94dvh;overflow:auto;box-sizing:border-box;padding:16px;border:1px solid rgba(214,173,99,.34);border-radius:14px;background:#151515;color:#f4efe4;box-shadow:0 22px 60px rgba(0,0,0,.55);scrollbar-width:none}
    .manual-roi__panel::-webkit-scrollbar{display:none;width:0;height:0}
    .manual-roi__title{margin:0 0 5px;font-size:18px}.manual-roi__note{margin:0 0 12px;color:#aaa39a;font-size:11px;line-height:1.55}
    .manual-roi__stage{position:relative;width:max-content;max-width:100%;margin:0 auto;touch-action:none;user-select:none;cursor:crosshair}
    .manual-roi__image{display:block;max-width:100%;max-height:68dvh;width:auto;height:auto;border-radius:9px;pointer-events:none}
    .manual-roi__selection{position:absolute;display:none;box-sizing:border-box;border:2px solid #d6ad63;border-radius:5px;background:rgba(214,173,99,.10);box-shadow:0 0 0 9999px rgba(0,0,0,.22);pointer-events:none}
    .manual-roi__status{min-height:18px;margin:9px 0 0;color:#aaa39a;font-size:10px}.manual-roi__status.is-error{color:#df8d85}
    .manual-roi__actions{display:grid;grid-template-columns:.7fr 1.2fr;gap:8px;margin-top:10px}.manual-roi__cancel,.manual-roi__recognize{min-height:42px;border-radius:9px;font:inherit;font-weight:750}
    .manual-roi__cancel{border:1px solid rgba(214,173,99,.28);background:#202020;color:#aaa39a}.manual-roi__recognize{border:1px solid #b9995a;background:#b9995a;color:#111}.manual-roi__recognize:disabled{opacity:.4}
  `;
  document.head.append(style);
}

export async function openManualROIRecognitionDialog(options: ManualROIRecognitionDialogOptions): Promise<boolean> {
  installStyles();
  const preview = await createSegmentationImagePreview(options.file);
  if (!preview) throw new Error("当前环境无法生成局部识别预览");
  const previewUrl = URL.createObjectURL(preview.blob);
  return new Promise<boolean>((resolve) => {
    const overlay = element("div", "manual-roi");
    const panel = element("section", "manual-roi__panel");
    panel.append(
      element("h2", "manual-roi__title", "框选补充识别"),
      element("p", "manual-roi__note", "直接在原图预览上拖出一个矩形。确认后系统按该坐标从原始照片裁取区域并使用同一 PP-OCRv5 识别；整图结果不会被静默覆盖。")
    );
    const stage = element("div", "manual-roi__stage");
    const image = element("img", "manual-roi__image");
    image.src = previewUrl;
    image.alt = "原始照片的轻量框选预览";
    const selection = element("div", "manual-roi__selection");
    stage.append(image, selection);
    const status = element("p", "manual-roi__status", "拖动框选需要补充识别的区域");
    const actions = element("div", "manual-roi__actions");
    let box: ManualROIBox | undefined;
    let startX = 0;
    let startY = 0;
    let pointerId: number | undefined;
    let busy = false;

    const finish = (accepted: boolean): void => {
      URL.revokeObjectURL(previewUrl);
      overlay.remove();
      resolve(accepted);
    };
    const cancel = button("manual-roi__cancel", "取消", () => { if (!busy) finish(false); });
    const recognize = button("manual-roi__recognize", "识别框选区域", async () => {
      if (!box || busy) return;
      busy = true; recognize.disabled = true; cancel.disabled = true;
      status.classList.remove("is-error"); status.textContent = "正在从原始照片裁取该区域并进行 PP-OCRv5 识别…";
      try {
        await options.onRecognize(box);
        finish(true);
      } catch (error) {
        busy = false; recognize.disabled = false; cancel.disabled = false;
        status.classList.add("is-error");
        status.textContent = `局部识别失败：${error instanceof Error ? error.message : String(error)}`;
      }
    });
    recognize.disabled = true;
    actions.append(cancel, recognize);
    panel.append(stage, status, actions);
    overlay.append(panel);
    options.root.append(overlay);

    const point = (event: PointerEvent): { x: number; y: number } => {
      const rect = image.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
      };
    };
    const update = (x: number, y: number): void => {
      const rect = image.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      const left = Math.min(startX, x), top = Math.min(startY, y);
      const right = Math.max(startX, x), bottom = Math.max(startY, y);
      selection.style.display = "block";
      selection.style.left = `${left}px`; selection.style.top = `${top}px`;
      selection.style.width = `${Math.max(1, right - left)}px`; selection.style.height = `${Math.max(1, bottom - top)}px`;
      const width = right - left, height = bottom - top;
      box = width >= 18 && height >= 18 ? {
        left: left / rect.width,
        top: top / rect.height,
        right: right / rect.width,
        bottom: bottom / rect.height
      } : undefined;
      recognize.disabled = !box;
      status.textContent = box ? `已框选 ${Math.round((right-left))} × ${Math.round((bottom-top))} px 预览区域` : "框选范围过小，请重新拖动";
    };
    stage.addEventListener("pointerdown", (event) => {
      if (busy || event.button > 0) return;
      const p = point(event); startX = p.x; startY = p.y; pointerId = event.pointerId;
      stage.setPointerCapture?.(event.pointerId); update(p.x, p.y); event.preventDefault();
    });
    stage.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId || busy) return;
      const p = point(event); update(p.x, p.y); event.preventDefault();
    });
    const stop = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      const p = point(event); update(p.x, p.y); pointerId = undefined; event.preventDefault();
    };
    stage.addEventListener("pointerup", stop);
    stage.addEventListener("pointercancel", stop);
    overlay.addEventListener("click", (event) => { if (event.target === overlay && !busy) finish(false); });
  });
}
