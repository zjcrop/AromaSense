import "./setup-list-ux-enhancements";

function installHomeActionStyles(): void {
  if (document.head.querySelector("style[data-aromasense-home-action-enhancements]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseHomeActionEnhancements = "true";
  style.textContent = `
    .batch-setup__capture-actions{
      grid-template-columns:repeat(2,minmax(0,1fr))!important;
      grid-auto-flow:row!important;
      align-items:stretch!important;
    }
    .batch-setup__capture-actions>.batch-setup__home-capture-action{
      width:100%!important;
      min-width:0!important;
      box-sizing:border-box!important;
    }
    .batch-setup__capture-actions>[data-aromasense-intake-hidden="true"]{
      display:none!important;
    }
    .batch-setup__session-meta-input{
      text-align:center!important;
      text-align-last:center!important;
    }
    .batch-setup__session-meta-input::-webkit-date-and-time-value,
    .batch-setup__session-meta-input::-webkit-datetime-edit{
      text-align:center!important;
    }
    .batch-setup__target-direct{
      text-align:center!important;
    }
    .batch-setup__target-choice{
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
      text-align:center!important;
    }
    .import-source__panel.is-batch-intake-picker{
      position:relative!important;
      display:flex!important;
      flex-direction:column!important;
      justify-content:center!important;
      min-height:min(680px,88vh)!important;
      padding-bottom:82px!important;
    }
    .import-source__panel.is-batch-intake-picker .import-source__grid{
      width:min(620px,100%)!important;
      margin:auto!important;
      grid-template-columns:repeat(2,minmax(0,1fr))!important;
    }
    .import-source__panel.is-batch-intake-picker .import-source__link-form:not([hidden]){
      width:min(620px,100%)!important;
      margin:auto!important;
    }
    .import-source__footer{
      position:absolute!important;
      left:22px!important;
      right:22px!important;
      bottom:18px!important;
      display:flex!important;
      justify-content:center!important;
      align-items:center!important;
      margin:0!important;
      padding-top:12px!important;
      border-top:1px solid rgba(255,255,255,.06)!important;
    }
    .import-source__footer .import-source__close{
      min-width:132px!important;
      min-height:40px!important;
      text-align:center!important;
      color:#b9b2a8!important;
      font-weight:700!important;
    }
    @media(max-width:620px){
      .import-source__panel.is-batch-intake-picker{
        min-height:100dvh!important;
        padding-bottom:max(82px,calc(64px + env(safe-area-inset-bottom)))!important;
      }
      .import-source__footer{
        left:16px!important;
        right:16px!important;
        bottom:max(14px,env(safe-area-inset-bottom))!important;
      }
    }
  `;
  document.head.append(style);
}

function setTextIfChanged(node: HTMLElement | undefined | null, text: string): void {
  if (node && node.textContent?.trim() !== text) node.textContent = text;
}

function removeCuppingListHeading(root: ParentNode = document): void {
  for (const title of root.querySelectorAll<HTMLElement>(".batch-setup__home-section-title")) {
    if (title.textContent?.trim() !== "杯测列表") continue;
    const section = title.closest<HTMLElement>(".batch-setup__samples-section");
    if (section) {
      section.removeAttribute("aria-labelledby");
      section.setAttribute("aria-label", "杯测样品");
    }
    title.remove();
  }
}

function removeCuppingTypeHeading(root: ParentNode = document): void {
  const candidates = root.querySelectorAll<HTMLElement>(
    ".batch-setup__session-meta h1,.batch-setup__session-meta h2,.batch-setup__session-meta h3,.batch-setup__session-meta h4,.batch-setup__session-meta legend,.batch-setup__session-meta-title,.batch-setup__session-meta-label"
  );
  for (const title of candidates) {
    if (title.textContent?.trim() !== "杯测类型") continue;
    const section = title.closest<HTMLElement>(".batch-setup__session-meta");
    if (section && !section.getAttribute("aria-label")) section.setAttribute("aria-label", "杯测信息");
    title.remove();
  }
}

function renameSplitRecognition(root: ParentNode = document): void {
  for (const control of root.querySelectorAll<HTMLButtonElement>("[data-manual-split-photo]")) {
    setTextIfChanged(control, "分割识别");
    if (control.getAttribute("aria-label") !== "分割识别") control.setAttribute("aria-label", "分割识别");
  }
  for (const title of root.querySelectorAll<HTMLElement>(".manual-split-photo__title")) {
    setTextIfChanged(title, "分割识别");
  }
  for (const panel of root.querySelectorAll<HTMLElement>(".manual-split-photo__panel")) {
    if (panel.getAttribute("aria-label") === "手工切分拍照") panel.setAttribute("aria-label", "分割识别");
  }
}

function sourceOptionTitle(option: Element): string {
  return option.querySelector<HTMLElement>(".import-source__option-title")?.textContent?.trim() ?? "";
}

function sourceIcon(kind: "split" | "text"): SVGSVGElement {
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
  path.setAttribute("d", kind === "split"
    ? "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z"
    : "M5 5h14 M5 9h14 M5 13h14 M5 17h10");
  svg.append(path);
  return svg;
}

function customSourceOption(kind: "split" | "text", title: string, note: string, onClick: () => void): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "import-source__option";
  control.dataset.batchIntakeSource = kind;
  const strong = document.createElement("strong");
  strong.className = "import-source__option-title";
  strong.textContent = title;
  const small = document.createElement("small");
  small.className = "import-source__option-note";
  small.textContent = note;
  control.append(sourceIcon(kind), strong, small);
  control.addEventListener("click", onClick);
  return control;
}

function hiddenSourceAction(selector: string): HTMLButtonElement | undefined {
  return document.querySelector<HTMLButtonElement>(`.batch-setup__capture-actions ${selector}`) ?? undefined;
}

function enhanceBatchSourcePicker(panel: HTMLElement): void {
  const grid = panel.querySelector<HTMLElement>(".import-source__grid");
  if (!grid) return;
  const existing = [...grid.querySelectorAll<HTMLButtonElement>(".import-source__option")];
  const photo = existing.find((option) => sourceOptionTitle(option) === "图片");
  if (!photo) return;

  panel.classList.add("is-batch-intake-picker");
  const overlay = panel.closest<HTMLElement>(".import-source");
  const sheet = existing.find((option) => sourceOptionTitle(option) === "表格");
  const link = existing.find((option) => sourceOptionTitle(option) === "链接");
  const qr = existing.find((option) => sourceOptionTitle(option) === "二维码");

  let split = grid.querySelector<HTMLButtonElement>('[data-batch-intake-source="split"]');
  if (!split) {
    split = customSourceOption("split", "分割识别", "复杂照片先手工框选，再按分区识别", () => {
      overlay?.remove();
      const action = hiddenSourceAction('[data-manual-split-photo]');
      if (action) action.click();
      else window.alert("分割识别入口暂不可用。");
    });
  }

  let text = grid.querySelector<HTMLButtonElement>('[data-batch-intake-source="text"]');
  if (!text) {
    text = customSourceOption("text", "文字录入", "逐行录入或整段粘贴，完成后自动分行识别", () => {
      overlay?.remove();
      const action = hiddenSourceAction('[data-home-action="manual-entry"]');
      if (action) action.click();
      else window.alert("文字录入入口暂不可用。");
    });
  }

  const ordered = [photo, split, text, sheet, link, qr].filter((option): option is HTMLButtonElement => Boolean(option));
  const current = [...grid.querySelectorAll<HTMLButtonElement>(":scope > .import-source__option")];
  if (ordered.length === 6 && (current.length !== 6 || current.some((option, index) => option !== ordered[index]))) {
    grid.replaceChildren(...ordered);
  }

  const header = panel.querySelector<HTMLElement>(".import-source__header");
  header?.querySelector<HTMLElement>(".import-source__title")?.remove();
  let footer = panel.querySelector<HTMLElement>(".import-source__footer");
  if (!footer) {
    footer = document.createElement("footer");
    footer.className = "import-source__footer";
    panel.append(footer);
  }
  const close = panel.querySelector<HTMLButtonElement>(".import-source__close");
  if (close && close.parentElement !== footer) footer.append(close);
  if (close) {
    setTextIfChanged(close, "关闭");
    if (close.getAttribute("aria-label") !== "关闭") close.setAttribute("aria-label", "关闭");
  }
  if (header && !header.children.length) header.remove();
}

function ensureHiddenQrAction(actions: HTMLElement): void {
  if (actions.querySelector('[data-home-action="qr-import"]')) return;
  const importButton = actions.querySelector<HTMLButtonElement>('[data-home-action="import-data"]');
  if (!importButton) return;
  const control = document.createElement("button");
  control.type = "button";
  control.className = "batch-setup__capture batch-setup__home-capture-action";
  control.dataset.homeAction = "qr-import";
  control.dataset.aromasenseIntakeHidden = "true";
  control.hidden = true;
  control.textContent = "二维码录入";
  control.addEventListener("click", () => {
    importButton.click();
    queueMicrotask(() => {
      const option = [...document.querySelectorAll<HTMLButtonElement>(".import-source__option")]
        .find((item) => sourceOptionTitle(item) === "二维码");
      option?.click();
    });
  });
  actions.append(control);
}

function normalizeTwoHomeActions(actions: HTMLElement): void {
  const buttons = [...actions.querySelectorAll<HTMLButtonElement>(":scope > button")];
  const batch = buttons.find((button) => button.dataset.homeAction === "batch-recognition")
    ?? buttons.find((button) => ["批量识别", "批量录入"].includes(button.textContent?.trim() ?? ""));
  const clear = buttons.find((button) => button.dataset.homeAction === "clear-list")
    ?? buttons.find((button) => ["清空样品", "清空列表", "清空列"].includes(button.textContent?.trim() ?? ""));
  const manual = buttons.find((button) => button.dataset.homeAction === "manual-entry")
    ?? buttons.find((button) => ["手工录入", "文字录入"].includes(button.textContent?.trim() ?? ""));
  const split = buttons.find((button) => button.hasAttribute("data-manual-split-photo"));
  const data = buttons.find((button) => button.dataset.homeAction === "import-data");

  if (batch) {
    setTextIfChanged(batch, "批量录入");
    if (batch.getAttribute("aria-label") !== "批量录入") batch.setAttribute("aria-label", "批量录入");
    batch.classList.add("batch-setup__home-capture-action");
  }
  if (clear) {
    setTextIfChanged(clear, "清空列表");
    if (clear.getAttribute("aria-label") !== "清空列表") clear.setAttribute("aria-label", "清空列表");
    clear.classList.add("batch-setup__home-capture-action");
  }
  if (manual) {
    setTextIfChanged(manual, "文字录入");
    if (manual.getAttribute("aria-label") !== "文字录入") manual.setAttribute("aria-label", "文字录入");
  }
  if (split) {
    setTextIfChanged(split, "分割识别");
    if (split.getAttribute("aria-label") !== "分割识别") split.setAttribute("aria-label", "分割识别");
  }
  setTextIfChanged(data, "数据导入");

  for (const button of [...actions.querySelectorAll<HTMLButtonElement>(":scope > button")]) {
    const visible = button === batch || button === clear;
    if (visible) {
      button.hidden = false;
      delete button.dataset.aromasenseIntakeHidden;
      button.removeAttribute("aria-hidden");
      if (button.tabIndex < 0) button.tabIndex = 0;
    } else {
      button.hidden = true;
      button.dataset.aromasenseIntakeHidden = "true";
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    }
  }
  ensureHiddenQrAction(actions);
}

function scan(): void {
  installHomeActionStyles();
  removeCuppingListHeading();
  removeCuppingTypeHeading();
  renameSplitRecognition();
  for (const actions of document.querySelectorAll<HTMLElement>(".batch-setup__capture-actions")) normalizeTwoHomeActions(actions);
  for (const panel of document.querySelectorAll<HTMLElement>(".import-source__panel")) enhanceBatchSourcePicker(panel);
}

const observerOptions: MutationObserverInit = { childList: true, subtree: true };
let scanTimer: number | undefined;
let observer: MutationObserver;

function scheduleScan(): void {
  if (scanTimer !== undefined) return;
  scanTimer = window.setTimeout(() => {
    scanTimer = undefined;
    observer.disconnect();
    try {
      scan();
    } finally {
      observer.observe(document.documentElement, observerOptions);
    }
  }, 0);
}

scan();
observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, observerOptions);
