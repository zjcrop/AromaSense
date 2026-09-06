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

export function yingxiangSampleCodesFromDrafts(samples: readonly Pick<ImportSampleDraft, "label" | "metadata">[]): string[] {
  return samples.flatMap((sample) => {
    const explicit = metadataCode(sample.metadata ?? {});
    const label = clean(sample.label);
    const value = explicit ?? label;
    if (!value || /^待确认样品\s*\d+$/u.test(value)) return [];
    return [value];
  });
}

function codesFromRecognized(samples: readonly RecognizedSample[]): string[] {
  return yingxiangSampleCodesFromDrafts(samples.map((sample) => ({ label: sample.label, metadata: sample.metadata ?? {} })));
}

function normalizedLines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.normalize("NFKC").trim()).filter(Boolean);
}

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-sample-code-importer]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangSampleCodeImporter = "true";
  style.textContent = `
    .yx-sample-import{display:grid;gap:8px;margin-top:8px}.yx-sample-import [hidden]{display:none!important}
    .yx-sample-import__tools{display:flex;flex-wrap:wrap;gap:7px}.yx-sample-import__tools button{min-height:36px;padding:6px 10px;border:1px solid rgba(185,153,90,.3);border-radius:7px;background:#1d1b17;color:#d8c7a7;font:700 12px/1.2 system-ui,sans-serif}.yx-sample-import__tools button:disabled{opacity:.45}
    .yx-sample-import__paste{display:grid;gap:7px;padding:9px;border:1px solid rgba(185,153,90,.18);border-radius:8px;background:#101010}.yx-sample-import__paste textarea{min-height:88px!important}.yx-sample-import__status{min-height:17px;margin:0;color:#8f887d;font-size:11px;line-height:1.5;white-space:pre-wrap}
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
    const cameraInput = document.createElement("input"); cameraInput.type = "file"; cameraInput.accept = "image/*"; cameraInput.multiple = true; cameraInput.setAttribute("capture", "environment"); cameraInput.hidden = true;
    const photoInput = document.createElement("input"); photoInput.type = "file"; photoInput.accept = "image/*"; photoInput.multiple = true; photoInput.hidden = true;
    const sheetInput = document.createElement("input"); sheetInput.type = "file"; sheetInput.accept = SPREADSHEET_ACCEPT; sheetInput.hidden = true;
    const pasteBox = document.createElement("div"); pasteBox.className = "yx-sample-import__paste"; pasteBox.hidden = true;
    const textarea = document.createElement("textarea"); textarea.placeholder = "一行一个编号；也可粘贴带“编号/样品/sample/code”列的内容。";
    const apply = button("识别并替换编号列表"); this.controls.push(apply); pasteBox.append(textarea, apply);
    tools.append(camera, photos, sheet, paste, cameraInput, photoInput, sheetInput);
    this.status.className = "yx-sample-import__status";
    this.status.textContent = "导入会替换当前编号列表；仍可直接编辑上方文本框。";
    this.root.append(tools, pasteBox, this.status);

    camera.onclick = () => cameraInput.click(); photos.onclick = () => photoInput.click(); sheet.onclick = () => sheetInput.click();
    paste.onclick = () => { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) textarea.focus(); };
    cameraInput.onchange = () => void this.importPhotos([...(cameraInput.files ?? [])]);
    photoInput.onchange = () => void this.importPhotos([...(photoInput.files ?? [])]);
    sheetInput.onchange = () => { const file = sheetInput.files?.[0]; if (file) void this.importSheet(file); };
    apply.onclick = () => {
      const text = textarea.value.trim(); if (!text) return;
      try {
        const bundle = recognizeManualText(text);
        const codes = yingxiangSampleCodesFromDrafts(bundle.sessions.flatMap((session) => session.samples));
        if (!codes.length) { this.status.textContent = "粘贴内容没有形成可用的样品编号。"; return; }
        this.accept(codes, "粘贴内容"); pasteBox.hidden = true;
      } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); }
    };
  }

  setDisabled(disabled: boolean): void {
    for (const control of this.controls) control.disabled = disabled;
  }

  private async importPhotos(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    this.status.textContent = `正在识别 ${files.length} 张编号图片…`;
    const results = await this.recognizer.recognizeBatch(files, (progress) => {
      this.status.textContent = `${progress.index}/${progress.total} ${progress.fileName} · ${progress.message ?? progress.status}`;
    });
    const codes = results.flatMap((page) => page instanceof Error ? [] : codesFromRecognized(page.samples));
    if (!codes.length) { this.status.textContent = "图片没有形成可用的样品编号；可补拍、导入表格或直接粘贴。"; return; }
    this.accept(codes, "图片");
  }

  private async importSheet(file: File): Promise<void> {
    this.status.textContent = `正在读取 ${file.name}…`;
    try {
      const bundle = await parseSpreadsheetFile(file);
      const codes = yingxiangSampleCodesFromDrafts(bundle.sessions.flatMap((session) => session.samples));
      if (!codes.length) { this.status.textContent = `${file.name} 没有识别到可用编号列。`; return; }
      this.accept(codes, file.name);
      if (bundle.warnings.length) this.status.textContent += `\n${bundle.warnings.join("\n")}`;
    } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); }
  }

  private accept(codes: readonly string[], source: string): void {
    const normalized = codes.map((code) => code.normalize("NFKC").trim()).filter(Boolean);
    this.target.value = normalized.join("\n");
    this.target.dispatchEvent(new Event("input", { bubbles: true }));
    const duplicateCount = normalized.length - new Set(normalized).size;
    this.status.textContent = `${source}识别 ${normalized.length} 个样品编号，已替换当前列表。${duplicateCount ? ` 检测到 ${duplicateCount} 个重复编号，请修改后再发布。` : ""}`;
    this.options.onCodesChanged?.(normalizedLines(this.target.value));
  }
}
