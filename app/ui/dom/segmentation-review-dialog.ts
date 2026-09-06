import type { OCRBox } from "../../core/ocr-layout-model";
import {
  assignSegmentationLinesByGeometry,
  buildSegmentationReviewModel,
  linesInsideBox,
  mergeSegmentationRegions,
  normalizeRegionBox,
  resegmentRecognizedPage,
  splitSegmentationRegion,
  splitSegmentationRegionVertically,
  type SegmentationReviewModel,
  type SegmentationReviewRegion
} from "../../core/sample-segmentation-review";
import {
  attachROIRefinementProvenance,
  failedROIRefinement,
  refineSegmentationRegionEvidence,
  regionRecognitionAvailable,
  type ROIRefinementProvenance
} from "../../core/sample-roi-refinement";
import type { RecognizedPage } from "../../core/sample-recognition-service";

export interface SegmentationReviewDialogOptions {
  root: HTMLElement;
  page: RecognizedPage;
  file: File;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, work: () => void | Promise<void>): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  node.onclick = () => { void work(); };
  return node;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function replaceRegion(model: SegmentationReviewModel, index: number, patch: Partial<SegmentationReviewRegion>): SegmentationReviewModel {
  return {
    ...model,
    regions: model.regions.map((region, itemIndex) => itemIndex === index ? { ...region, ...patch } : region)
  };
}

function replaceRegions(model: SegmentationReviewModel, regions: readonly SegmentationReviewRegion[]): SegmentationReviewModel {
  return { ...model, regions: [...regions] };
}

function moveBox(box: OCRBox, dx: number, dy: number): OCRBox {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const left = clamp(box.left + dx, 0, 1 - width);
  const top = clamp(box.top + dy, 0, 1 - height);
  return normalizeRegionBox({ left, top, right: left + width, bottom: top + height });
}

function resizeBox(box: OCRBox, dx: number, dy: number): OCRBox {
  return normalizeRegionBox({
    left: box.left,
    top: box.top,
    right: clamp(box.right + dx, box.left + 0.02, 1),
    bottom: clamp(box.bottom + dy, box.top + 0.02, 1)
  });
}

function installStyles(): void {
  if (document.head.querySelector("style[data-segmentation-review-v2]")) return;
  const style = document.createElement("style");
  style.dataset.segmentationReviewV2 = "true";
  style.textContent = `
    .seg-review{position:fixed;inset:0;z-index:4800;display:grid;place-items:center;padding:14px;background:rgba(0,0,0,.82);color:#eee;font:14px/1.45 system-ui,sans-serif}
    .seg-review__panel{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,.72fr);gap:14px;width:min(1120px,calc(100vw - 28px));max-height:94dvh;padding:14px;border:1px solid rgba(214,173,99,.34);border-radius:12px;background:#151515;overflow:hidden}
    .seg-review__visual,.seg-review__side{min-width:0;min-height:0}.seg-review__visual{display:grid;grid-template-rows:auto minmax(0,1fr);gap:9px}.seg-review__side{display:flex;flex-direction:column;gap:10px;overflow:auto}
    .seg-review__head{display:grid;gap:4px}.seg-review__title{margin:0;color:#d6ad63;font-size:18px}.seg-review__note,.seg-review__status{margin:0;color:#9e978c;font-size:11.5px;line-height:1.55}.seg-review__status.is-error{color:#e18d80}
    .seg-review__image-stage{position:relative;min-height:300px;overflow:auto;border:1px solid #3b352a;border-radius:9px;background:#0d0d0d}.seg-review__image-wrap{position:relative;width:max-content;min-width:100%;line-height:0}.seg-review__image{display:block;width:min(100%,760px);height:auto;max-height:76dvh;object-fit:contain;margin:auto;user-select:none;-webkit-user-drag:none}
    .seg-review__layer{position:absolute;inset:0;margin:auto;width:min(100%,760px);height:100%;pointer-events:none}.seg-review__ocr{position:absolute;box-sizing:border-box;border:1px solid rgba(90,154,206,.38);background:rgba(90,154,206,.05);pointer-events:none}
    .seg-review__region{position:absolute;box-sizing:border-box;border:2px solid rgba(214,173,99,.72);background:rgba(214,173,99,.07);pointer-events:auto;touch-action:none;cursor:move}.seg-review__region.is-selected{border-color:#f0c875;background:rgba(214,173,99,.12);box-shadow:0 0 0 1px rgba(0,0,0,.5)}.seg-review__region-index{position:absolute;left:3px;top:3px;display:grid;place-items:center;min-width:24px;height:22px;padding:0 4px;border-radius:4px;background:#1d1a14;color:#f0d9a9;font:700 10px/1 ui-monospace,monospace}.seg-review__resize{position:absolute;right:-6px;bottom:-6px;width:18px;height:18px;border-radius:50%;background:#e0bb72;border:2px solid #151515;cursor:nwse-resize}
    .seg-review__regions{display:grid;gap:6px}.seg-review__region-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:8px;align-items:center;min-height:44px;padding:6px 7px;border:1px solid #383329;border-radius:7px;background:#111;color:#ddd;text-align:left}.seg-review__region-row.is-selected{border-color:#9f8353;background:#1c1913}.seg-review__region-number{display:grid;place-items:center;width:30px;height:30px;border-radius:5px;background:#242018;color:#d6ad63;font:700 10px/1 ui-monospace,monospace}.seg-review__region-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.seg-review__region-count{color:#8f887e;font-size:10px}
    .seg-review__editor{display:grid;gap:9px;padding:10px;border:1px solid #37332c;border-radius:8px;background:#121212}.seg-review__editor label{display:grid;gap:5px;color:#aaa296;font-size:11px}.seg-review__editor input{box-sizing:border-box;width:100%;min-height:40px;padding:7px 9px;border:1px solid #64563e;border-radius:6px;background:#0d0d0d;color:#eee;font:13px/1.3 system-ui,sans-serif}
    .seg-review__tools,.seg-review__actions{display:flex;flex-wrap:wrap;gap:7px}.seg-review__tool,.seg-review__keep,.seg-review__apply{min-height:40px;padding:7px 10px;border:1px solid #67583f;border-radius:7px;background:#211d16;color:#dbc79d;font-weight:700}.seg-review__tool:disabled,.seg-review__keep:disabled,.seg-review__apply:disabled{opacity:.45}.seg-review__roi{border-color:#586d82;background:#151d24;color:#bcd3e8}.seg-review__apply{flex:1;border-color:#b9995a;background:#292318;color:#f0d7a7}.seg-review__keep{flex:1}.seg-review__actions{margin-top:auto;padding-top:5px}
    @media(max-width:760px){.seg-review{padding:7px}.seg-review__panel{grid-template-columns:1fr;width:calc(100vw - 14px);max-height:97dvh;overflow:auto}.seg-review__visual{min-height:360px}.seg-review__image-stage{min-height:300px}.seg-review__side{overflow:visible}.seg-review__image{max-height:55dvh}}
  `;
  document.head.append(style);
}

export function openSegmentationReviewDialog(options: SegmentationReviewDialogOptions): Promise<RecognizedPage> {
  const initialModel = buildSegmentationReviewModel(options.page);
  if (!initialModel) return Promise.resolve(options.page);
  installStyles();

  return new Promise((resolve) => {
    let model: SegmentationReviewModel = initialModel;
    let selectedIndex = 0;
    let refining = false;
    const refinements = new Map<string, ROIRefinementProvenance>();
    const imageUrl = URL.createObjectURL(options.file);

    const overlay = element("div", "seg-review");
    const panel = element("section", "seg-review__panel");
    const visual = element("div", "seg-review__visual");
    const side = element("div", "seg-review__side");
    const head = element("div", "seg-review__head");
    head.append(
      element("h2", "seg-review__title", "多条目分区确认"),
      element("p", "seg-review__note", "拖动框改变位置，拖右下角改变大小。边界变化会自动改变文字归属；只有 OCR 字符本身错误时才使用“局部重新识别”。")
    );
    const stage = element("div", "seg-review__image-stage");
    const imageWrap = element("div", "seg-review__image-wrap");
    const image = element("img", "seg-review__image");
    image.src = imageUrl;
    image.alt = `待确认多条目图片 ${options.file.name}`;
    const layer = element("div", "seg-review__layer");
    imageWrap.append(image, layer);
    stage.append(imageWrap);
    visual.append(head, stage);

    const regionList = element("div", "seg-review__regions");
    const editor = element("div", "seg-review__editor");
    const status = element("p", "seg-review__status", "调整边界后直接应用即可；无需再手动执行文字归属。 ");
    const actions = element("div", "seg-review__actions");
    side.append(regionList, editor, status, actions);
    panel.append(visual, side);
    overlay.append(panel);

    const setStatus = (text: string, error = false) => {
      status.textContent = text;
      status.classList.toggle("is-error", error);
    };

    const busy = () => refining;

    const finish = (page: RecognizedPage) => {
      URL.revokeObjectURL(imageUrl);
      overlay.remove();
      resolve(page);
    };

    const invalidateRefinement = (regionId?: string) => {
      if (regionId) refinements.delete(regionId);
      else refinements.clear();
    };

    const geometryCount = (region: SegmentationReviewRegion) => linesInsideBox(model.lines, region.box).length;

    const updateSelectedBox = (box: OCRBox) => {
      const region = model.regions[selectedIndex];
      if (!region) return;
      invalidateRefinement(region.id);
      model = replaceRegion(model, selectedIndex, { box });
    };

    const installRegionPointer = (node: HTMLElement, index: number, mode: "move" | "resize") => {
      node.addEventListener("pointerdown", (event) => {
        if (busy() || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = index;
        const startX = event.clientX;
        const startY = event.clientY;
        const startBox = model.regions[index]?.box;
        if (!startBox) return;
        const bounds = layer.getBoundingClientRect();
        if (!(bounds.width > 0) || !(bounds.height > 0)) return;
        try { node.setPointerCapture(event.pointerId); } catch { /* no-op */ }
        const onMove = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== event.pointerId) return;
          const dx = (moveEvent.clientX - startX) / bounds.width;
          const dy = (moveEvent.clientY - startY) / bounds.height;
          try {
            const next = mode === "resize" ? resizeBox(startBox, dx, dy) : moveBox(startBox, dx, dy);
            updateSelectedBox(next);
            Object.assign(node.style, {
              left: `${next.left * 100}%`, top: `${next.top * 100}%`,
              width: `${(next.right - next.left) * 100}%`, height: `${(next.bottom - next.top) * 100}%`
            });
          } catch { /* keep last valid geometry */ }
        };
        const onEnd = (endEvent: PointerEvent) => {
          if (endEvent.pointerId !== event.pointerId) return;
          node.removeEventListener("pointermove", onMove);
          node.removeEventListener("pointerup", onEnd);
          node.removeEventListener("pointercancel", onEnd);
          try { node.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
          setStatus(`边界已更新；当前框覆盖 ${geometryCount(model.regions[selectedIndex])} 行 OCR 文字。应用时会按当前框重新解析。`);
          render();
        };
        node.addEventListener("pointermove", onMove);
        node.addEventListener("pointerup", onEnd);
        node.addEventListener("pointercancel", onEnd);
      });
    };

    const renderCanvas = () => {
      layer.replaceChildren();
      for (const line of model.lines) {
        const box = element("div", "seg-review__ocr");
        Object.assign(box.style, {
          left: `${line.box.left * 100}%`, top: `${line.box.top * 100}%`,
          width: `${line.box.width * 100}%`, height: `${line.box.height * 100}%`
        });
        box.title = line.text;
        layer.append(box);
      }
      model.regions.forEach((region, index) => {
        const node = element("div", `seg-review__region${index === selectedIndex ? " is-selected" : ""}`);
        Object.assign(node.style, {
          left: `${region.box.left * 100}%`, top: `${region.box.top * 100}%`,
          width: `${(region.box.right - region.box.left) * 100}%`, height: `${(region.box.bottom - region.box.top) * 100}%`
        });
        node.append(element("span", "seg-review__region-index", String(index + 1)));
        const handle = element("span", "seg-review__resize");
        node.append(handle);
        node.onclick = () => { selectedIndex = index; render(); };
        installRegionPointer(node, index, "move");
        installRegionPointer(handle, index, "resize");
        layer.append(node);
      });
    };

    const renderList = () => {
      regionList.replaceChildren();
      model.regions.forEach((region, index) => {
        const row = button(`seg-review__region-row${index === selectedIndex ? " is-selected" : ""}`, "", () => {
          selectedIndex = index;
          render();
        });
        row.replaceChildren(
          element("span", "seg-review__region-number", String(index + 1).padStart(2, "0")),
          element("span", "seg-review__region-label", region.label || `样品 ${index + 1}`),
          element("span", "seg-review__region-count", `${geometryCount(region)} 行`)
        );
        regionList.append(row);
      });
    };

    const synchronize = () => assignSegmentationLinesByGeometry(model);

    const renderEditor = () => {
      editor.replaceChildren();
      const region = model.regions[selectedIndex];
      if (!region) return;
      const label = element("label", "", "样品名称（可留空，由识别字段生成）");
      const labelInput = element("input");
      labelInput.value = region.label;
      labelInput.placeholder = `样品 ${selectedIndex + 1}`;
      labelInput.oninput = () => { model = replaceRegion(model, selectedIndex, { label: labelInput.value }); };
      label.append(labelInput);

      const info = element("p", "seg-review__note", `当前边界覆盖 ${geometryCount(region)} 行文字。框的几何位置是最终归属依据。`);
      const tools = element("div", "seg-review__tools");

      const roi = button("seg-review__tool seg-review__roi", refining ? "局部识别中…" : "局部重新识别", async () => {
        if (busy()) return;
        let available = false;
        try { available = regionRecognitionAvailable(); } catch { available = false; }
        if (!available) { setStatus("当前 Recognition Foundation 不支持局部 ROI 识别；调整边界后仍可重新解析已有 OCR 文字。", true); return; }
        refining = true;
        renderEditor();
        try {
          const result = await refineSegmentationRegionEvidence({ file: options.file, model, regionIndex: selectedIndex });
          model = result.model;
          refinements.set(model.regions[selectedIndex].id, result.provenance);
          setStatus(`局部 OCR 已更新：${result.provenance.blockCount ?? 0} 行。现在应用会使用新的字符结果。`);
        } catch (error) {
          refinements.set(region.id, failedROIRefinement(region, error));
          setStatus(error instanceof Error ? error.message : String(error), true);
        } finally {
          refining = false;
          render();
        }
      });

      const mergePrev = button("seg-review__tool", "与上一块合并", () => {
        if (selectedIndex <= 0) return;
        try {
          model = synchronize();
          model = replaceRegions(model, mergeSegmentationRegions(model, selectedIndex - 1, selectedIndex));
          selectedIndex -= 1;
          invalidateRefinement();
          setStatus("已合并分区；请确认边界后应用。 ");
          render();
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
      });
      mergePrev.disabled = selectedIndex <= 0 || busy();

      const mergeNext = button("seg-review__tool", "与下一块合并", () => {
        if (selectedIndex >= model.regions.length - 1) return;
        try {
          model = synchronize();
          model = replaceRegions(model, mergeSegmentationRegions(model, selectedIndex, selectedIndex + 1));
          invalidateRefinement();
          setStatus("已合并分区；请确认边界后应用。 ");
          render();
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
      });
      mergeNext.disabled = selectedIndex >= model.regions.length - 1 || busy();

      const splitH = button("seg-review__tool", "横向一分为二", () => {
        try {
          model = synchronize();
          const current = model.regions[selectedIndex];
          model = replaceRegions(model, splitSegmentationRegion(model, selectedIndex, current.box.centerY));
          invalidateRefinement();
          setStatus("已按当前框中心横向拆分。 ");
          render();
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
      });
      splitH.disabled = busy();

      const splitV = button("seg-review__tool", "纵向一分为二", () => {
        try {
          model = synchronize();
          const current = model.regions[selectedIndex];
          model = replaceRegions(model, splitSegmentationRegionVertically(model, selectedIndex, current.box.centerX));
          invalidateRefinement();
          setStatus("已按当前框中心纵向拆分。 ");
          render();
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
      });
      splitV.disabled = busy();

      const remove = button("seg-review__tool", "删除当前分区", () => {
        if (model.regions.length <= 1) { setStatus("至少保留一个样品分区。", true); return; }
        model = replaceRegions(model, model.regions.filter((_, index) => index !== selectedIndex));
        selectedIndex = Math.min(selectedIndex, model.regions.length - 1);
        invalidateRefinement();
        setStatus("已删除分区；框外或未归属文字不会进入样品。 ");
        render();
      });
      remove.disabled = busy();

      tools.append(roi, mergePrev, mergeNext, splitH, splitV, remove);
      editor.append(label, info, tools);
    };

    const render = () => {
      selectedIndex = Math.max(0, Math.min(selectedIndex, model.regions.length - 1));
      renderCanvas();
      renderList();
      renderEditor();
    };

    const keep = button("seg-review__keep", "保留自动分区", () => {
      if (!busy()) finish(options.page);
    });
    const apply = button("seg-review__apply", "按当前边界重新解析", () => {
      if (busy()) return;
      try {
        const synchronized = assignSegmentationLinesByGeometry(model);
        const page = resegmentRecognizedPage(options.page, synchronized);
        finish(attachROIRefinementProvenance(page, synchronized, refinements));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    });
    actions.append(keep, apply);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && !busy()) finish(options.page);
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !busy()) finish(options.page);
    });

    options.root.append(overlay);
    overlay.tabIndex = -1;
    overlay.focus();
    image.addEventListener("load", render, { once: true });
    render();
  });
}
