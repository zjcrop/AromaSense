import type { ImportBundle, ImportSessionDraft } from "../../core/import-bundle";
import { button, element } from "./dom-helpers";

export interface ImportBundleDialogOptions {
  root: HTMLElement;
  bundle: ImportBundle;
  onAccept(sessions: readonly ImportSessionDraft[]): void | Promise<void>;
}

function metadataSummary(session: ImportSessionDraft): string {
  const parts = [
    session.metadata.date,
    session.metadata.organizer,
    session.metadata.target,
    session.metadata.eventName
  ].filter((value): value is string => Boolean(value?.trim()));
  return parts.join(" · ") || "组级信息待补充";
}

export function openImportBundleDialog(options: ImportBundleDialogOptions): void {
  const overlay = element("div", "import-bundle");
  const panel = element("section", "import-bundle__panel");
  const header = element("header", "import-bundle__header");
  header.append(
    element("div", "import-bundle__title", "导入预览"),
    button("import-bundle__close", "关闭", () => overlay.remove())
  );
  const source = element("p", "import-bundle__source", `${options.bundle.source.name ?? "导入数据"} · 检测到 ${options.bundle.sessions.length} 组杯测`);
  panel.append(header, source);

  if (options.bundle.warnings.length) {
    const warning = element("details", "import-bundle__warnings");
    warning.append(element("summary", "import-bundle__warnings-title", `${options.bundle.warnings.length} 条解析提示`));
    const list = element("ul", "import-bundle__warnings-list");
    for (const message of options.bundle.warnings) list.append(element("li", "", message));
    warning.append(list);
    panel.append(warning);
  }

  const selected = new Set(options.bundle.sessions.map((_, index) => index));
  const list = element("div", "import-bundle__groups");
  options.bundle.sessions.forEach((session, index) => {
    const row = element("label", "import-bundle__group");
    const check = element("input", "import-bundle__check");
    check.type = "checkbox";
    check.checked = true;
    check.addEventListener("change", () => check.checked ? selected.add(index) : selected.delete(index));
    const copy = element("div", "import-bundle__group-copy");
    copy.append(
      element("strong", "import-bundle__group-name", session.title?.trim() || session.sourceGroup),
      element("span", "import-bundle__group-meta", `${session.samples.length} 个样品 · ${metadataSummary(session)}`),
      element("small", "import-bundle__group-source", session.sourceGroup)
    );
    row.append(check, copy);
    list.append(row);
  });
  panel.append(list);

  const actions = element("footer", "import-bundle__actions");
  const accept = button("import-bundle__primary", options.bundle.sessions.length > 1 ? "导入并逐组确认" : "导入并逐一确认", async () => {
    const sessions = options.bundle.sessions.filter((_, index) => selected.has(index));
    if (!sessions.length) return;
    accept.disabled = true;
    try {
      await options.onAccept(sessions);
      overlay.remove();
    } catch (error) {
      accept.disabled = false;
      window.alert(error instanceof Error ? error.message : String(error));
    }
  });
  actions.append(
    button("import-bundle__secondary", "取消", () => overlay.remove()),
    button("import-bundle__secondary", "全选", () => {
      selected.clear();
      options.bundle.sessions.forEach((_, index) => selected.add(index));
      list.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((input) => { input.checked = true; });
    }),
    accept
  );
  panel.append(actions);
  overlay.append(panel);
  options.root.append(overlay);
}
