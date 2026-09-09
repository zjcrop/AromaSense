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
      .find((button) => ["导入数据", "数据导入"].includes(button.textContent?.trim() ?? ""));
}

function openCanonicalQrImport(actions: HTMLElement): void {
  const importButton = importDataButton(actions);
  if (!importButton) {
    window.alert("二维码录入入口暂不可用，请使用“数据导入”中的二维码功能。");
    return;
  }

  importButton.click();
  queueMicrotask(() => {
    const qrOption = [...document.querySelectorAll<HTMLButtonElement>(".import-source__option")]
      .find((button) => button.querySelector<HTMLElement>(".import-source__option-title")?.textContent?.trim() === "二维码");
    if (!qrOption) {
      window.alert("二维码扫描器未能打开，请使用“数据导入”中的二维码功能。");
      return;
    }
    qrOption.click();
  });
}

function ensureQrImportAction(actions: HTMLElement): HTMLButtonElement | undefined {
  const existing = actions.querySelector<HTMLButtonElement>('[data-home-action="qr-import"]');
  if (existing) return existing;
  const importButton = importDataButton(actions);
  if (!importButton) return undefined;

  const control = document.createElement("button");
  control.type = "button";
  control.className = "batch-setup__capture batch-setup__home-capture-action";
  control.dataset.homeAction = "qr-import";
  control.textContent = "二维码录入";
  control.setAttribute("aria-label", "二维码录入");
  control.addEventListener("click", () => openCanonicalQrImport(actions));
  importButton.insertAdjacentElement("afterend", control);
  return control;
}

function ensurePhotoRecognitionAction(actions: HTMLElement): HTMLButtonElement | undefined {
  const existing = actions.querySelector<HTMLButtonElement>('[data-home-action="photo-recognition"]');
  if (existing) return existing;
  const legacy = [...actions.querySelectorAll<HTMLButtonElement>(":scope > button")]
    .find((button) => button.textContent?.trim() === "批量识别");
  if (!legacy) return undefined;
  const control = legacy.cloneNode(false) as HTMLButtonElement;
  control.type = "button";
  control.dataset.homeAction = "photo-recognition";
  control.textContent = "拍照识别";
  control.setAttribute("aria-label", "拍照识别");
  control.addEventListener("click", () => {
    const root = actions.closest<HTMLElement>(".batch-setup") ?? document.body;
    const camera = root.querySelector<HTMLInputElement>('input.batch-setup__file-input[accept="image/*"][capture="environment"]');
    if (!camera) {
      window.alert("当前拍照入口暂不可用。");
      return;
    }
    camera.click();
  });
  legacy.replaceWith(control);
  return control;
}

function normalizeActionSizing(actions: HTMLElement): void {
  for (const control of actions.querySelectorAll<HTMLButtonElement>(":scope > button")) {
    control.classList.add("batch-setup__home-capture-action");
  }
}

function normalizeSixActions(actions: HTMLElement): void {
  const photo = ensurePhotoRecognitionAction(actions);
  const split = actions.querySelector<HTMLButtonElement>("[data-manual-split-photo]")
    ?? [...actions.querySelectorAll<HTMLButtonElement>(":scope > button")].find((button) => button.textContent?.trim() === "分割识别");
  const text = [...actions.querySelectorAll<HTMLButtonElement>(":scope > button")]
    .find((button) => ["手工录入", "文字录入"].includes(button.textContent?.trim() ?? ""));
  const qr = ensureQrImportAction(actions);
  const data = importDataButton(actions);
  const clear = [...actions.querySelectorAll<HTMLButtonElement>(":scope > button")]
    .find((button) => ["清空样品", "清空列表", "清空列"].includes(button.textContent?.trim() ?? ""));

  if (photo) photo.textContent = "拍照识别";
  if (text) { text.textContent = "文字录入"; text.setAttribute("aria-label", "文字录入"); }
  if (qr) { qr.textContent = "二维码录入"; qr.setAttribute("aria-label", "二维码录入"); }
  if (data) { data.textContent = "数据导入"; data.setAttribute("aria-label", "数据导入"); }
  if (clear) { clear.textContent = "清空列"; clear.setAttribute("aria-label", "清空列"); }

  const ordered = [photo, split, text, qr, data, clear].filter((control): control is HTMLButtonElement => Boolean(control));
  if (ordered.length !== 6) return;
  const current = [...actions.querySelectorAll<HTMLButtonElement>(":scope > button")];
  if (current.length === 6 && current.every((control, index) => control === ordered[index])) return;
  actions.replaceChildren(...ordered);
}

function scan(): void {
  installHomeActionStyles();
  removeCuppingListHeading();
  removeCuppingTypeHeading();
  renameSplitRecognition();
  for (const actions of document.querySelectorAll<HTMLElement>(".batch-setup__capture-actions")) {
    normalizeActionSizing(actions);
    normalizeSixActions(actions);
  }
}

scan();
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
