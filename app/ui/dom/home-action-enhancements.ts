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
  `;
  document.head.append(style);
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
    if (control.textContent?.trim() !== "分割识别") control.textContent = "分割识别";
    control.setAttribute("aria-label", "分割识别");
  }
  for (const title of root.querySelectorAll<HTMLElement>(".manual-split-photo__title")) {
    if (title.textContent?.trim() !== "分割识别") title.textContent = "分割识别";
  }
  for (const panel of root.querySelectorAll<HTMLElement>(".manual-split-photo__panel")) {
    if (panel.getAttribute("aria-label") === "手工切分拍照") panel.setAttribute("aria-label", "分割识别");
  }
}

function importDataButton(actions: HTMLElement): HTMLButtonElement | undefined {
  return actions.querySelector<HTMLButtonElement>('[data-home-action="import-data"]')
    ?? [...actions.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "导入数据");
}

function openCanonicalQrImport(actions: HTMLElement): void {
  const importButton = importDataButton(actions);
  if (!importButton) {
    window.alert("二维码导入入口暂不可用，请使用“导入数据”中的二维码功能。");
    return;
  }

  importButton.click();
  queueMicrotask(() => {
    const qrOption = [...document.querySelectorAll<HTMLButtonElement>(".import-source__option")]
      .find((button) => button.querySelector<HTMLElement>(".import-source__option-title")?.textContent?.trim() === "二维码");
    if (!qrOption) {
      window.alert("二维码扫描器未能打开，请使用“导入数据”中的二维码功能。");
      return;
    }
    qrOption.click();
  });
}

function ensureQrImportAction(actions: HTMLElement): void {
  if (actions.querySelector('[data-home-action="qr-import"]')) return;
  const importButton = importDataButton(actions);
  if (!importButton) return;

  const control = document.createElement("button");
  control.type = "button";
  control.className = "batch-setup__capture batch-setup__home-capture-action";
  control.dataset.homeAction = "qr-import";
  control.textContent = "二维码导入";
  control.setAttribute("aria-label", "二维码导入");
  control.addEventListener("click", () => openCanonicalQrImport(actions));
  importButton.insertAdjacentElement("afterend", control);
}

function normalizeActionSizing(actions: HTMLElement): void {
  for (const control of actions.querySelectorAll<HTMLButtonElement>(":scope > button")) {
    control.classList.add("batch-setup__home-capture-action");
  }
}

function scan(): void {
  installHomeActionStyles();
  removeCuppingListHeading();
  removeCuppingTypeHeading();
  renameSplitRecognition();
  for (const actions of document.querySelectorAll<HTMLElement>(".batch-setup__capture-actions")) {
    ensureQrImportAction(actions);
    normalizeActionSizing(actions);
  }
}

scan();
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
