import { manualTextRows } from "../../core/manual-text-import";
import { button, element } from "./dom-helpers";

export interface ManualTextImportDialogOptions {
  root: HTMLElement;
  onParse(text: string): void | Promise<void>;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-line-text-entry]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseLineTextEntry = "true";
  style.textContent = `
    .manual-import__line-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;margin:8px 0}
    .manual-import__line-count{color:#9f988d;font-size:11px;line-height:1.4}
    .manual-import__next-line{min-height:36px;padding:6px 12px;border:1px solid rgba(185,153,90,.32);border-radius:8px;background:#1d1b17;color:#d6ad63;font:700 12px/1 system-ui,sans-serif}
    .manual-import__rows{display:grid;gap:5px;max-height:180px;overflow:auto;margin:8px 0 2px;padding:8px;border:1px solid rgba(185,153,90,.16);border-radius:9px;background:#111}
    .manual-import__rows[hidden]{display:none!important}
    .manual-import__row{display:grid;grid-template-columns:30px minmax(0,1fr);gap:8px;align-items:start;padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.055);color:#d4cec4;font-size:11px;line-height:1.45}
    .manual-import__row:last-child{border-bottom:0}
    .manual-import__row-number{color:#d6ad63;font:750 10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:right}
    .manual-import__row-text{min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}
    .manual-import__textarea{line-height:1.6!important;tab-size:2}
    @media(max-width:520px){.manual-import__line-tools{grid-template-columns:1fr}.manual-import__next-line{width:100%}.manual-import__rows{max-height:150px}}
  `;
  document.head.append(style);
}

function insertNextLine(textarea: HTMLTextAreaElement): void {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before.endsWith("\n") || before.length === 0 ? "" : "\n";
  textarea.value = `${before}${prefix}${after}`;
  const next = before.length + prefix.length;
  textarea.setSelectionRange(next, next);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

export function openManualTextImportDialog(options: ManualTextImportDialogOptions): void {
  installStyles();
  const overlay = element("div", "manual-import");
  const panel = element("section", "manual-import__panel");
  const header = element("header", "manual-import__header");
  header.append(
    element("div", "manual-import__header-copy", "文字录入"),
    button("manual-import__close", "关闭", () => overlay.remove())
  );

  const hint = element("p", "manual-import__hint");
  hint.textContent = "每个豆子一行，一行代表一只咖啡。可以逐行输入并点“下一行”，也可以一次粘贴多行；系统会实时显示已分出的行。完成录入后直接触发识别，不再增加单独的确认步骤。同一行内的国家、产区、品种、处理法、烘焙度、风味等仍由本地识别基座自动拆分。";

  const textarea = element("textarea", "manual-import__textarea");
  textarea.rows = 10;
  textarea.placeholder = [
    "花蝶；埃塞俄比亚；耶加雪菲；74110；水洗；浅烘；茉莉/柑橘",
    "翡翠庄园，巴拿马，波奎特，瑰夏，日晒，花香*桃子*佛手柑",
    "肯尼亚AA；Nyeri；SL28/SL34；水洗；黑加仑、莓果"
  ].join("\n");

  const lineTools = element("div", "manual-import__line-tools");
  const lineCount = element("span", "manual-import__line-count", "尚未录入行");
  const nextLine = button("manual-import__next-line", "下一行", () => insertNextLine(textarea));
  lineTools.append(lineCount, nextLine);

  const rowsPreview = element("div", "manual-import__rows");
  rowsPreview.hidden = true;
  rowsPreview.setAttribute("aria-label", "自动分行结果");

  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const renderRows = (): string[] => {
    const rows = manualTextRows(textarea.value);
    rowsPreview.replaceChildren();
    rowsPreview.hidden = rows.length === 0;
    lineCount.textContent = rows.length ? `已自动分出 ${rows.length} 行 · 每行将生成 1 个样品` : "尚未录入行";
    rows.forEach((value, index) => {
      const row = element("div", "manual-import__row");
      row.append(
        element("span", "manual-import__row-number", String(index + 1).padStart(2, "0")),
        element("span", "manual-import__row-text", value)
      );
      rowsPreview.append(row);
    });
    return rows;
  };

  const status = element("div", "manual-import__status");
  status.hidden = true;
  const actions = element("footer", "manual-import__actions");
  const primary = button("manual-import__primary", "完成录入", async () => {
    const text = textarea.value.trim();
    const rows = renderRows();
    if (!text || !rows.length) {
      status.hidden = false;
      status.textContent = "请输入至少一行样品信息。";
      return;
    }
    primary.disabled = true;
    nextLine.disabled = true;
    status.hidden = false;
    status.textContent = `正在识别并导入 ${rows.length} 行…`;
    try {
      await options.onParse(text);
      overlay.remove();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      primary.disabled = false;
      nextLine.disabled = false;
    }
  });

  textarea.addEventListener("input", () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(renderRows, 120);
  });
  textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      primary.click();
    }
  });

  actions.append(button("manual-import__secondary", "取消", () => overlay.remove()), primary);
  panel.append(header, hint, textarea, lineTools, rowsPreview, status, actions);
  overlay.append(panel);
  options.root.append(overlay);
  textarea.focus();
}
