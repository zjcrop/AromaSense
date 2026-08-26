import { button, element } from "./dom-helpers";

export interface ManualTextImportDialogOptions {
  root: HTMLElement;
  onParse(text: string): void | Promise<void>;
}

export function openManualTextImportDialog(options: ManualTextImportDialogOptions): void {
  const overlay = element("div", "manual-import");
  const panel = element("section", "manual-import__panel");
  const header = element("header", "manual-import__header");
  header.append(
    element("div", "manual-import__header-copy", "手工录入"),
    button("manual-import__close", "关闭", () => overlay.remove())
  );

  const hint = element("p", "manual-import__hint");
  hint.textContent = "每个豆子一行。同一行可用 ， , 。 ； ; / \\ | - * · … 等符号分段；日期、海拔范围和 SL28/SL34 等组合会自动保护，不会被错误拆开。建议顺序：名称 / 国家 / 产区 / 庄园 / 品种 / 处理法 / 烘焙度 / 风味。";

  const textarea = element("textarea", "manual-import__textarea");
  textarea.rows = 12;
  textarea.placeholder = [
    "花蝶；埃塞俄比亚；耶加雪菲；74110；水洗；浅烘；茉莉/柑橘",
    "翡翠庄园，巴拿马，波奎特，瑰夏，日晒，花香*桃子*佛手柑",
    "肯尼亚AA；Nyeri；SL28/SL34；水洗；黑加仑、莓果"
  ].join("\n");

  const status = element("div", "manual-import__status");
  status.hidden = true;
  const actions = element("footer", "manual-import__actions");
  const parse = button("manual-import__primary", "解析并逐一确认", async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.hidden = false;
      status.textContent = "请输入至少一行样品信息。";
      return;
    }
    parse.disabled = true;
    status.hidden = false;
    status.textContent = "正在使用 LuckyBean 识别核心解析文本…";
    try {
      await options.onParse(text);
      overlay.remove();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      parse.disabled = false;
    }
  });
  actions.append(button("manual-import__secondary", "取消", () => overlay.remove()), parse);
  panel.append(header, hint, textarea, status, actions);
  overlay.append(panel);
  options.root.append(overlay);
  textarea.focus();
}
