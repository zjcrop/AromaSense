import { button, element } from "./dom-helpers";

export interface ImportSourceDialogOptions {
  root: HTMLElement;
  allowPhotos?: boolean;
  onPhotos?(): void;
  onSpreadsheet(): void;
  onLink(link: string): void | Promise<void>;
  onQr(): void;
}

type SourceKind = "photo" | "sheet" | "link" | "qr";

function sourceIcon(kind: SourceKind): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("import-source__icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  const paths: Record<SourceKind, string> = {
    photo: "M4 6.5h3l1.3-2h7.4l1.3 2h3v12H4z M12 9a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
    sheet: "M6 3.5h8l4 4v13H6z M14 3.5v4h4 M8.5 11h7 M8.5 14h7 M8.5 17h5",
    link: "M9.5 14.5l5-5 M8 16H6.5a4 4 0 0 1 0-8H10 M14 8h3.5a4 4 0 0 1 0 8H14",
    qr: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 14h2v2h-2z M14 18h2v2h-2z M18 18h2v2h-2z"
  };
  path.setAttribute("d", paths[kind]);
  svg.append(path);
  return svg;
}

function sourceButton(kind: SourceKind, title: string, note: string, onClick: () => void): HTMLButtonElement {
  const control = element("button", "import-source__option");
  control.type = "button";
  control.append(
    sourceIcon(kind),
    element("strong", "import-source__option-title", title),
    element("small", "import-source__option-note", note)
  );
  control.addEventListener("click", onClick);
  return control;
}

export function openImportSourceDialog(options: ImportSourceDialogOptions): { close(): void } {
  const overlay = element("div", "import-source");
  const panel = element("section", "import-source__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "选择批量识别来源");

  const close = () => overlay.remove();
  const header = element("header", "import-source__header");
  header.append(
    element("div", "import-source__title", "选择识别来源"),
    button("import-source__close", "关闭", close)
  );

  const grid = element("div", "import-source__grid");
  if (options.allowPhotos !== false && options.onPhotos) {
    grid.append(sourceButton("photo", "图片", "多选照片，逐张识别", () => { close(); options.onPhotos?.(); }));
  }
  grid.append(
    sourceButton("sheet", "表格", "Excel · CSV · ODS · JSON", () => { close(); options.onSpreadsheet(); }),
    sourceButton("link", "链接", "导入 AromaSense 分享链接", () => showLinkForm()),
    sourceButton("qr", "二维码", "直接扫码或读取二维码图片", () => { close(); options.onQr(); })
  );

  const linkForm = element("div", "import-source__link-form");
  linkForm.hidden = true;
  const linkInput = element("input", "import-source__link-input");
  linkInput.type = "url";
  linkInput.inputMode = "url";
  linkInput.autocomplete = "off";
  linkInput.placeholder = "粘贴 AromaSense 分享链接";
  const linkStatus = element("small", "import-source__link-status");
  const linkActions = element("div", "import-source__link-actions");
  linkActions.append(
    button("import-source__secondary", "返回", () => { linkForm.hidden = true; grid.hidden = false; linkStatus.textContent = ""; }),
    button("import-source__primary", "读取链接", () => void submitLink())
  );
  linkForm.append(linkInput, linkStatus, linkActions);

  function showLinkForm(): void {
    grid.hidden = true;
    linkForm.hidden = false;
    queueMicrotask(() => linkInput.focus());
  }

  async function submitLink(): Promise<void> {
    const link = linkInput.value.trim();
    if (!link) {
      linkStatus.textContent = "请先粘贴链接。";
      linkInput.focus();
      return;
    }
    linkStatus.textContent = "正在读取…";
    try {
      await options.onLink(link);
      close();
    } catch (error) {
      linkStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  linkInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void submitLink(); }
  });
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

  panel.append(header, grid, linkForm);
  overlay.append(panel);
  options.root.append(overlay);
  return { close };
}
