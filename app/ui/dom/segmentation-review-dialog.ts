import type { OCRBox } from "../../core/ocr-layout-model";
import {
  attachROIRefinementProvenance,
  failedROIRefinement,
  refineSegmentationRegionEvidence,
  regionRecognitionAvailable,
  type ROIRefinementProvenance
} from "../../core/sample-roi-refinement";
import {
  buildSegmentationReviewModel,
  linesInsideBox,
  mergeSegmentationRegions,
  normalizeRegionBox,
  resegmentRecognizedPage,
  splitSegmentationRegion,
  type SegmentationReviewModel,
  type SegmentationReviewRegion
} from "../../core/sample-segmentation-review";
import type { RecognizedPage } from "../../core/sample-recognition-service";
import { button, element } from "./dom-helpers";

export interface SegmentationReviewDialogOptions {
  root: HTMLElement;
  page: RecognizedPage;
  file: File;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-segmentation-review]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseSegmentationReview = "true";
  style.textContent = `
    .seg-review{position:fixed;inset:0;z-index:1900;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.78);backdrop-filter:blur(5px)}
    .seg-review__panel{width:min(980px,100%);max-height:min(90vh,860px);overflow:auto;border:1px solid rgba(185,153,90,.35);border-radius:14px;padding:16px;background:#171717;color:#f1ede4;box-shadow:0 22px 60px rgba(0,0,0,.55)}
    .seg-review__header{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:12px}
    .seg-review__title{margin:0;color:#d6ad63;font-size:17px;letter-spacing:.05em}.seg-review__note{margin:5px 0 0;color:#9e988d;font-size:11px;line-height:1.5}
    .seg-review__layout{display:grid;grid-template-columns:minmax(320px,1.35fr) minmax(280px,.85fr);gap:14px}
    .seg-review__canvas-shell{position:relative;min-height:560px;border:1px solid #393939;border-radius:10px;overflow:hidden;background:#f5f1e8}
    .seg-review__canvas{position:absolute;inset:0}
    .seg-review__line{position:absolute;min-height:10px;padding:1px 3px;overflow:hidden;border:1px solid rgba(0,0,0,.13);background:rgba(255,255,255,.72);color:#39342d;font-size:8px;line-height:1.2;white-space:nowrap;text-overflow:ellipsis;pointer-events:none}
    .seg-review__region{position:absolute;border:2px solid rgba(164,111,32,.75);background:rgba(214,173,99,.09);box-sizing:border-box;cursor:pointer;transition:border-color 120ms ease,background 120ms ease}
    .seg-review__region.is-selected{border-color:#b44135;background:rgba(180,65,53,.11);box-shadow:0 0 0 1px rgba(255,255,255,.7) inset}
    .seg-review__region-index{position:absolute;left:3px;top:3px;padding:2px 5px;border-radius:999px;background:#111;color:#fff;font-size:9px;font-weight:700}
    .seg-review__side{display:grid;align-content:start;gap:10px}
    .seg-review__regions{display:grid;gap:6px;max-height:180px;overflow:auto;padding-right:2px}
    .seg-review__region-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px;min-height:38px;padding:6px 7px;border:1px solid #343434;border-radius:8px;background:#202020;color:#ddd;text-align:left;font:inherit}
    .seg-review__region-card.is-selected{border-color:#b9995a;background:#29251d;color:#fff}.seg-review__region-count{color:#8f887e;font-size:9px}
    .seg-review__editor{display:grid;gap:9px;padding:10px;border:1px solid #343434;border-radius:9px;background:#1d1d1d}
    .seg-review__label{display:grid;gap:4px;color:#c7b98f;font-size:10px}.seg-review__label input{min-height:36px;border:1px solid #464646;border-radius:7px;padding:7px 8px;background:#111;color:#fff;font:inherit}
    .seg-review__bounds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.seg-review__bound{display:grid;grid-template-columns:42px 1fr 36px;align-items:center;gap:5px;color:#aaa;font-size:9px}.seg-review__bound input{width:100%}
    .seg-review__tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.seg-review__tools button,.seg-review__actions button{min-height:38px;border-radius:8px;font:inherit;font-size:11px;font-weight:650}
    .seg-review__tool{border:1px solid #4a4439;background:#222;color:#d2c5a8}.seg-review__tool:disabled{opacity:.35}.seg-review__roi{border-color:#7b6540;background:#292218;color:#e0bf7d}.seg-review__roi.is-done{border-color:#46745a;color:#9fd1af}.seg-review__split{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;color:#999;font-size:9px}.seg-review__split input{width:100%}
    .seg-review__status{min-height:18px;color:#b9b1a6;font-size:10px;line-height:1.4}.seg-review__status.is-error{color:#f0a39b}
    .seg-review__actions{display:grid;grid-template-columns:.8fr 1.2fr;gap:8px;margin-top:4px}.seg-review__keep{border:1px solid #454545;background:#222;color:#bbb}.seg-review__apply{border:1px solid #b9995a;background:#b9995a;color:#111}
    @media(max-width:760px){.seg-review{padding:8px}.seg-review__panel{max-height:96vh;padding:12px}.seg-review__layout{grid-template-columns:1fr}.seg-review__canvas-shell{min-height:390px}.seg-review__regions{max-height:130px}}
  `;
  document.head.append(style);
}

function percent(value: number): string {
  return `${Math.max(0, Math.min(100, value * 100))}%`;
}

function cloneRegion(region: SegmentationReviewRegion): SegmentationReviewRegion {
  return { ...region, box: { ...region.box }, lineIds: [...region.lineIds] };
}

function replaceRegions(model: SegmentationReviewModel, regions: readonly SegmentationReviewRegion[]): SegmentationReviewModel {
  return { ...model, regions: regions.map(cloneRegion) };
}

function boundControl(labelText: string, value: number, onInput: (value: number) => void): HTMLElement {
  const wrapper = element("label", "seg-review__bound");
  wrapper.append(element("span", "", labelText));
  const input = element("input", "");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.step = "0.5";
  input.value = String(Math.round(value * 1000) / 10);
  const output = element("span", "", `${Math.round(value * 100)}%`);
  input.addEventListener("input", () => {
    const normalized = Number(input.value) / 100;
    output.textContent = `${Math.round(normalized * 100)}%`;
    onInput(normalized);
  });
  wrapper.append(input, output);
  return wrapper;
}

function safeRegionCapability(): boolean {
  try {
    return regionRecognitionAvailable();
  } catch {
    return false;
  }
}

export function openSegmentationReviewDialog(options: SegmentationReviewDialogOptions): Promise<RecognizedPage> {
  installStyles();
  const initial = buildSegmentationReviewModel(options.page);
  if (!initial) return Promise.resolve(options.page);

  return new Promise<RecognizedPage>((resolve) => {
    let model = replaceRegions(initial, initial.regions);
    let selectedIndex = 0;
    let splitY = model.regions[0]?.box.centerY ?? 0.5;
    let settled = false;
    let refining = false;
    const refinements = new Map<string, ROIRefinementProvenance>();

    const overlay = element("div", "seg-review");
    const panel = element("section", "seg-review__panel");
    const header = element("header", "seg-review__header");
    const heading = element("div", "");
    heading.append(
      element("h2", "seg-review__title", "核对样品分区"),
      element("p", "seg-review__note", `自动分区置信度 ${Math.round(options.page.segmentationConfidence * 100)}%。可先调整分区，再按需局部重新识别；原图裁剪只在正式 Recognition Worker/native 层执行。`)
    );
    header.append(heading);

    const layout = element("div", "seg-review__layout");
    const canvasShell = element("div", "seg-review__canvas-shell");
    const canvas = element("div", "seg-review__canvas");
    canvasShell.append(canvas);
    const side = element("div", "seg-review__side");
    const regionList = element("div", "seg-review__regions");
    const editor = element("div", "seg-review__editor");
    const status = element("div", "seg-review__status");
    const actions = element("div", "seg-review__actions");
    layout.append(canvasShell, side);
    panel.append(header, layout);
    overlay.append(panel);

    const finish = (page: RecognizedPage) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(page);
    };

    const setStatus = (message: string, error = false) => {
      status.textContent = message;
      status.classList.toggle("is-error", error);
    };

    const selectedRegion = () => model.regions[selectedIndex];
    const invalidateROI = () => refinements.clear();

    const updateSelected = (patch: Partial<SegmentationReviewRegion>, invalidate = false) => {
      const current = selectedRegion();
      if (!current) return;
      if (invalidate) invalidateROI();
      const regions = model.regions.map((region, index) => index === selectedIndex ? { ...region, ...patch } : region);
      model = replaceRegions(model, regions);
      render();
    };

    const updateBoxEdge = (edge: "left" | "top" | "right" | "bottom", value: number) => {
      const current = selectedRegion();
      if (!current) return;
      const next = { ...current.box, [edge]: value } as OCRBox;
      try {
        updateSelected({ box: normalizeRegionBox(next) }, true);
        setStatus("边界已调整。原 ROI 结果已作废；可重新归属文字或执行局部重新识别。", false);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    };

    const renderCanvas = () => {
      canvas.replaceChildren();
      for (const line of model.lines) {
        const item = element("div", "seg-review__line", line.text);
        item.title = line.text;
        item.style.left = percent(line.box.left);
        item.style.top = percent(line.box.top);
        item.style.width = percent(line.box.width);
        item.style.height = percent(Math.max(0.018, line.box.height));
        canvas.append(item);
      }
      model.regions.forEach((region, index) => {
        const item = element("button", `seg-review__region${index === selectedIndex ? " is-selected" : ""}`);
        item.type = "button";
        item.style.left = percent(region.box.left);
        item.style.top = percent(region.box.top);
        item.style.width = percent(region.box.width);
        item.style.height = percent(region.box.height);
        item.title = region.label || `分区 ${index + 1}`;
        item.append(element("span", "seg-review__region-index", String(index + 1)));
        item.addEventListener("click", () => {
          selectedIndex = index;
          splitY = region.box.centerY;
          render();
        });
        canvas.append(item);
      });
    };

    const renderList = () => {
      regionList.replaceChildren();
      model.regions.forEach((region, index) => {
        const item = element("button", `seg-review__region-card${index === selectedIndex ? " is-selected" : ""}`);
        item.type = "button";
        const refined = refinements.get(region.id);
        const state = refined?.status === "success" ? " · ROI" : refined?.status === "failed" ? " · ROI失败" : "";
        item.append(
          element("strong", "", String(index + 1).padStart(2, "0")),
          element("span", "", region.label || "未命名样品"),
          element("span", "seg-review__region-count", `${region.lineIds.length} 行${state}`)
        );
        item.addEventListener("click", () => {
          selectedIndex = index;
          splitY = region.box.centerY;
          render();
        });
        regionList.append(item);
      });
    };

    const runROIRefinement = async () => {
      const region = selectedRegion();
      if (!region || refining) return;
      if (!safeRegionCapability()) {
        setStatus("当前构建未加载 recognition-roi/1.0 安全接口；不会回退主线程裁剪。", true);
        return;
      }
      refining = true;
      setStatus("正在 Worker/native 层裁剪当前区域并执行 PP-OCRv5 二次识别…", false);
      render();
      try {
        const result = await refineSegmentationRegionEvidence({
          file: options.file,
          model,
          regionIndex: selectedIndex
        });
        model = result.model;
        refinements.set(region.id, result.provenance);
        setStatus(`局部重新识别完成：${result.provenance.blockCount ?? 0} 行文字已替换当前分区证据。`, false);
      } catch (error) {
        refinements.set(region.id, failedROIRefinement(region, error));
        setStatus(`局部重新识别失败，原识别证据已保留：${error instanceof Error ? error.message : String(error)}`, true);
      } finally {
        refining = false;
        render();
      }
    };

    const renderEditor = () => {
      editor.replaceChildren();
      const region = selectedRegion();
      if (!region) return;
      const label = element("label", "seg-review__label");
      label.append(element("span", "", "样品名称（可直接修正）"));
      const labelInput = element("input", "");
      labelInput.type = "text";
      labelInput.value = region.label;
      labelInput.placeholder = "留空则由规范字段自动生成";
      labelInput.addEventListener("change", () => updateSelected({ label: labelInput.value.trim() }));
      label.append(labelInput);

      const bounds = element("div", "seg-review__bounds");
      bounds.append(
        boundControl("左", region.box.left, (value) => updateBoxEdge("left", value)),
        boundControl("右", region.box.right, (value) => updateBoxEdge("right", value)),
        boundControl("上", region.box.top, (value) => updateBoxEdge("top", value)),
        boundControl("下", region.box.bottom, (value) => updateBoxEdge("bottom", value))
      );

      const roiState = refinements.get(region.id);
      const roi = button(
        `seg-review__tool seg-review__roi${roiState?.status === "success" ? " is-done" : ""}`,
        refining ? "局部重新识别中…" : roiState?.status === "success" ? "重新执行局部识别" : "局部重新识别",
        runROIRefinement
      );
      const roiCapable = safeRegionCapability();
      roi.disabled = refining || !roiCapable;
      if (!roiCapable) roi.title = "需要 Recognition Foundation recognition-roi/1.0 Worker/native 接口";

      const reassignment = button("seg-review__tool", "按当前边界归属文字", () => {
        const ids = linesInsideBox(model.lines, region.box);
        if (!ids.length) {
          setStatus("当前分区边界内没有 OCR 文字。", true);
          return;
        }
        updateSelected({ lineIds: ids }, true);
        setStatus(`已把边界内 ${ids.length} 行文字归入当前样品；原 ROI 结果已作废。`);
      });
      reassignment.disabled = refining;

      const split = element("div", "seg-review__split");
      const splitInput = element("input", "");
      splitInput.type = "range";
      splitInput.min = String(Math.round(region.box.top * 1000) / 10);
      splitInput.max = String(Math.round(region.box.bottom * 1000) / 10);
      splitInput.step = "0.5";
      splitInput.value = String(Math.round(splitY * 1000) / 10);
      const splitOutput = element("span", "", `${Math.round(splitY * 100)}%`);
      splitInput.addEventListener("input", () => {
        splitY = Number(splitInput.value) / 100;
        splitOutput.textContent = `${Math.round(splitY * 100)}%`;
      });
      split.append(splitInput, splitOutput);

      const tools = element("div", "seg-review__tools");
      const mergePrevious = button("seg-review__tool", "与上一块合并", () => {
        try {
          invalidateROI();
          model = replaceRegions(model, mergeSegmentationRegions(model, selectedIndex - 1, selectedIndex));
          selectedIndex = Math.max(0, selectedIndex - 1);
          splitY = selectedRegion()?.box.centerY ?? 0.5;
          setStatus("已合并分区；之前的 ROI 结果已作废。", false);
          render();
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
      });
      mergePrevious.disabled = selectedIndex <= 0 || refining;
      const mergeNext = button("seg-review__tool", "与下一块合并", () => {
        try {
          invalidateROI();
          model = replaceRegions(model, mergeSegmentationRegions(model, selectedIndex, selectedIndex + 1));
          splitY = selectedRegion()?.box.centerY ?? 0.5;
          setStatus("已合并分区；之前的 ROI 结果已作废。", false);
          render();
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
      });
      mergeNext.disabled = selectedIndex >= model.regions.length - 1 || refining;
      const splitButton = button("seg-review__tool", "按横线拆成两块", () => {
        try {
          invalidateROI();
          model = replaceRegions(model, splitSegmentationRegion(model, selectedIndex, splitY));
          setStatus("已拆分分区；请分别确认两个新样品，必要时再执行局部识别。", false);
          render();
        } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
      });
      splitButton.disabled = refining;
      const remove = button("seg-review__tool", "删除当前分区", () => {
        if (model.regions.length <= 1) {
          setStatus("至少保留一个样品分区。", true);
          return;
        }
        invalidateROI();
        model = replaceRegions(model, model.regions.filter((_, index) => index !== selectedIndex));
        selectedIndex = Math.min(selectedIndex, model.regions.length - 1);
        splitY = selectedRegion()?.box.centerY ?? 0.5;
        setStatus("已删除分区；未归属文字不会进入样品。", false);
        render();
      });
      remove.disabled = refining;
      tools.append(roi, reassignment, mergePrevious, mergeNext, splitButton, remove);
      editor.append(label, bounds, split, tools);
    };

    const render = () => {
      selectedIndex = Math.max(0, Math.min(selectedIndex, model.regions.length - 1));
      renderCanvas();
      renderList();
      renderEditor();
    };

    const keep = button("seg-review__keep", "保留自动分区", () => {
      if (!refining) finish(options.page);
    });
    const apply = button("seg-review__apply", "应用分区并重新解析", () => {
      if (refining) return;
      try {
        const page = resegmentRecognizedPage(options.page, model);
        finish(attachROIRefinementProvenance(page, model, refinements));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    });
    actions.append(keep, apply);
    side.append(regionList, editor, status, actions);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && !refining) finish(options.page);
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !refining) finish(options.page);
    });
    options.root.append(overlay);
    overlay.tabIndex = -1;
    overlay.focus();
    render();
  });
}
