import { recognizeManualText } from "../../core/manual-text-recognizer";
import { SampleRecognitionService, type RecognizedSample } from "../../core/sample-recognition-service";
import { parseSpreadsheetFile, SPREADSHEET_ACCEPT } from "../../core/spreadsheet-import";
import type { ImportSampleDraft } from "../../core/import-bundle";

export interface YingxiangSampleCodeImporterOptions {
  onCodesChanged?(codes: readonly string[]): void;
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").normalize("NFKC").trim();
  return text || undefined;
}

function metadataCode(metadata: Record<string, unknown>): string | undefined {
  for (const key of ["sampleCode", "sample_code", "code", "number", "no", "id", "编号"] as const) {
    const value = clean(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function normalizedLines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.normalize("NFKC").trim()).filter(Boolean);
}

export function yingxiangSampleCodesFromDrafts(samples: readonly Pick<ImportSampleDraft, "label" | "metadata">[]): string[] {
  return samples.flatMap((sample) => {
    const explicit = metadataCode(sample.metadata ?? {});
    const label = clean(sample.label);
    const value = explicit ?? label;
    if (!value || /^待确认样品\s*\d+$/u.test(value)) return [];
    return [value];
  });
}

function strictOcrCodeLines(text: string): string[] {
  const lines = normalizedLines(text);
  if (!lines.length || lines.some((line) => !/^[\p{L}\p{N}][\p{L}\p{N}._#-]{0,31}$/u.test(line))) return [];
  return lines;
}

function codesFromRecognized(samples: readonly RecognizedSample[]): string[] {
  return samples.flatMap((sample) => {
    const extracted = yingxiangSampleCodesFromDrafts([{ label: sample.label, metadata: sample.metadata ?? {} }]);
    if (extracted.length) return extracted;
    return strictOcrCodeLines(sample.rawText);
  });
}

function looksLikeStructuredPaste(text: string): boolean {
  const lines = normalizedLines(text);
  return lines.some((line) => /[\t,，;；|]/u.test(line))
    || lines.some((line) => /^(?:编号|样品(?:编号)?|sample(?:\s+code)?|code)\s*[:：]/iu.test(line));
}

/** The sample-code box is not a coffee-description field. One code per line is
 * preserved verbatim; only structured tabular text is sent through semantic parsing. */
export function yingxiangSampleCodesFromPastedText(text: string): string[] {
  const lines = normalizedLines(text);
  if (!lines.length) return [];
  if (!looksLikeStructuredPaste(text)) return lines;
  const bundle = recognizeManualText(text);
  return yingxiangSampleCodesFromDrafts(bundle.sessions.flatMap((session) => session.samples));
}

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-sample-code-importer]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangSampleCodeImporter = "true";
  style.textContent = `
    .yx-sample-import{display:grid;gap:8px;margin-top:8px}.yx-sample-import [hidden]{display:none!important}
    .yx-sample-import__tools{display:flex;flex-wrap:wrap;gap:7px}.yx-sample-import__tools button{min-height:36px;padding:6px 10px;border:1px solid rgba(185,153,90,.3);border-radius:7px;background:#1d1b17;color:#d8c7a7;font:700 12px/1.2 system-ui,sans-serif}.yx-sample-import__tools button:disabled{opacity:.45}
    .yx-sample-import__paste{display:grid;gap:7px;padding:9px;border:1px solid rgba(185,153,90,.18);border-radius:8px;background:#101010}.yx-sample-import__paste textarea{min-height:88px!important}.yx-sample-import__status{min-height:17px;margin:0;color:#8f887d;font-size:11px;line-height:1.5;white-space:pre-wrap}
    .yx-sample-import__progress{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 8px;align-items:center}.yx-sample-import__progress[hidden]{display:none!important}.yx-sample-import__progress-label{color:#a7a095;font-size:10px}.yx-sample-import__progress-value{color:#d6ad63;font-size:10px;font-variant-numeric:tabular-nums}.yx-sample-import__progress-track{grid-column:1/-1;height:4px;overflow:hidden;border-radius:99px;background:#292724}.yx-sample-import__progress-fill{height:100%;width:0;border-radius:inherit;background:#b9995a;transition:width .22s ease}
  `;
  document.head.append(style);
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button"); element.type = "button"; element.textContent = label; return element;
}

export class YingxiangSampleCodeImporter {
  private readonly recognizer = new SampleRecognitionService();
  private readonly controls: HTMLButtonElement[] = [];
  private readonly status = document.createElement("p");
  private readonly progress = document.createElement("div");
  private readonly progressLabel = document.createElement("span");
  private readonly progressValue = document.createElement("strong");
  private readonly progressFill = document.createElement("div");

  constructor(
    private readonly root: HTMLElement,
    private readonly target: HTMLTextAreaElement,
    private readonly options: YingxiangSampleCodeImporterOptions = {}
  ) { installStyles(); }

  render(): void {
    this.root.replaceChildren(); this.root.classList.add("yx-sample-import");
    const tools = document.createElement("div"); tools.className = "yx-sample-import__tools";
    const camera = button("拍摄编号"), photos = button("上传图片"), sheet = button("导入表格"), paste = button("粘贴识别");
    this.controls.splice(0, this.controls.length, camera, photos, sheet, paste);
    const cameraInput = document.createElement("input"); cameraInput.type = "file"; cameraInput.accept = "image/*"; cameraInput.multiple = false; cameraInput.setAttribute("capture", "environment"); cameraInput.hidden = true;
    const photoInput = document.createElement("input"); photoInput.type = "file"; photoInput.accept = "image/*"; photoInput.multiple = true; photoInput.hidden = true;
    const sheetInput = document.createElement("input"); sheetInput.type = "file"; sheetInput.accept = SPREADSHEET_ACCEPT; sheetInput.hidden = true;
    const pasteBox = document.createElement("div"); pasteBox.className = "yx-sample-import__paste"; pasteBox.hidden = true;
    const textarea = document.createElement("textarea"); textarea.placeholder = "一行一个编号；也可粘贴带“编号/样品/sample/code”列的内容。";
    const apply = button("识别并替换编号列表"); this.controls.push(apply); pasteBox.append(textarea, apply);
    tools.append(camera, photos, sheet, paste, cameraInput, photoInput, sheetInput);
    this.status.className = "yx-sample-import__status"; this.status.textContent = "导入会替换当前编号列表；仍可直接编辑上方文本框。";
    this.progress.className = "yx-sample-import__progress"; this.progress.hidden = true;
    this.progressLabel.className = "yx-sample-import__progress-label"; this.progressValue.className = "yx-sample-import__progress-value";
    const track = document.createElement("div"); track.className = "yx-sample-import__progress-track"; this.progressFill.className = "yx-sample-import__progress-fill"; track.append(this.progressFill); this.progress.append(this.progressLabel, this.progressValue, track);
    this.root.append(tools, pasteBox, this.status, this.progress);

    camera.onclick = () => cameraInput.click(); photos.onclick = () => photoInput.click(); sheet.onclick = () => sheetInput.click();
    paste.onclick = () => { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) textarea.focus(); };
    cameraInput.onchange = () => { const files = [...(cameraInput.files ?? [])]; cameraInput.value = ""; void this.importPhotos(files); };
    photoInput.onchange = () => { const files = [...(photoInput.files ?? [])]; photoInput.value = ""; void this.importPhotos(files); };
    sheetInput.onchange = () => { const file = sheetInput.files?.[0]; sheetInput.value = ""; if (file) void this.importSheet(file); };
    apply.onclick = () => {
      const text = textarea.value.trim(); if (!text) return;
      try {
        const codes = yingxiangSampleCodesFromPastedText(text);
        if (!codes.length) { this.status.textContent = "粘贴内容没有形成可用的样品编号。"; return; }
        this.accept(codes, "粘贴内容"); pasteBox.hidden = true;
      } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); }
    };
  }

  setDisabled(disabled: boolean): void { for (const control of this.controls) control.disabled = disabled; }

  private showProgress(percent: number, label: string): void {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    this.progress.hidden = false; this.progressLabel.textContent = label; this.progressValue.textContent = `${value}%`; this.progressFill.style.width = `${value}%`;
  }
  private hideProgress(): void { this.progress.hidden = true; this.progressFill.style.width = "0"; }

  private async importPhotos(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    this.setDisabled(true); this.status.textContent = `正在识别 ${files.length} 张编号图片…`; this.showProgress(4, "准备图片");
    let predicted = 6;
    const timer = window.setInterval(() => { predicted = Math.min(88, predicted + (predicted < 35 ? 3 : 1)); this.showProgress(predicted, "PP-OCRv5 正在识别编号"); }, 420);
    try {
      const results = await this.recognizer.recognizeBatch(files, (progress) => {
        const base = ((Math.max(0, progress.index - 1)) / Math.max(1, progress.total)) * 86;
        const bounded = Math.max(predicted, Math.min(92, 6 + base));
        predicted = bounded;
        this.showProgress(bounded, `${progress.index}/${progress.total} ${progress.fileName} · ${progress.message ?? progress.status}`);
        this.status.textContent = `${progress.index}/${progress.total} ${progress.fileName} · ${progress.message ?? progress.status}`;
      });
      const codes = results.flatMap((page) => page instanceof Error ? [] : codesFromRecognized(page.samples));
      if (!codes.length) throw new Error("图片没有形成可用的样品编号；可补拍、导入表格或直接粘贴。");
      this.showProgress(96, "整理编号列表"); this.accept(codes, "图片"); this.showProgress(100, "编号识别完成");
      window.setTimeout(() => this.hideProgress(), 450);
    } catch (error) {
      this.status.textContent = `拍照编号失败：${error instanceof Error ? error.message : String(error)}`; this.hideProgress();
    } finally {
      window.clearInterval(timer); this.setDisabled(false);
    }
  }

  private async importSheet(file: File): Promise<void> {
    this.setDisabled(true); this.status.textContent = `正在读取 ${file.name}…`; this.showProgress(15, "读取表格");
    try {
      const bundle = await parseSpreadsheetFile(file); this.showProgress(82, "整理编号列表");
      const codes = yingxiangSampleCodesFromDrafts(bundle.sessions.flatMap((session) => session.samples));
      if (!codes.length) throw new Error(`${file.name} 没有识别到可用编号列。`);
      this.accept(codes, file.name); if (bundle.warnings.length) this.status.textContent += `\n${bundle.warnings.join("\n")}`; this.showProgress(100, "导入完成"); window.setTimeout(() => this.hideProgress(), 350);
    } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); this.hideProgress(); }
    finally { this.setDisabled(false); }
  }

  private accept(codes: readonly string[], source: string): void {
    const normalized = codes.map((code) => code.normalize("NFKC").trim()).filter(Boolean);
    this.target.value = normalized.join("\n"); this.target.dispatchEvent(new Event("input", { bubbles: true }));
    const duplicateCount = normalized.length - new Set(normalized).size;
    this.status.textContent = `${source}识别 ${normalized.length} 个样品编号，已替换当前列表。${duplicateCount ? ` 检测到 ${duplicateCount} 个重复编号，请修改后再发布。` : ""}`;
    this.options.onCodesChanged?.(normalizedLines(this.target.value));
  }
}
