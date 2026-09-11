const STYLE_FLAG = "data-aromasense-source-choice-layout-hotfix";
const SHEET_CLASS = "aromasense-image-source-sheet";
type ImageSourceMode = "image" | "split";

function installSourceChoiceLayout(): void {
  if (document.head.querySelector(`style[${STYLE_FLAG}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_FLAG, "true");
  style.textContent = `
    /* First-level intake picker must contain only the six source tiles. */
    .import-source__photo-form[hidden]{display:none!important}

    .${SHEET_CLASS}{
      position:fixed;inset:0;z-index:2300;display:flex;align-items:flex-end;justify-content:center;
      padding:16px;box-sizing:border-box;background:rgba(0,0,0,.66);backdrop-filter:blur(5px);
    }
    .${SHEET_CLASS}__panel{
      width:min(520px,100%);box-sizing:border-box;border:1px solid rgba(185,153,90,.38);
      border-radius:16px;padding:16px;background:#171717;color:#f4efe4;
      box-shadow:0 18px 55px rgba(0,0,0,.62);
    }
    .${SHEET_CLASS}__title{margin:0;color:#f4efe4;font-size:18px;font-weight:800;line-height:1.25}
    .${SHEET_CLASS}__help{margin:6px 0 20px;color:#aaa39a;font-size:11px;line-height:1.55}
    .${SHEET_CLASS}__choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%}
    .${SHEET_CLASS}__choice{
      min-width:0;min-height:48px;margin:0;border:1px solid rgba(185,153,90,.36);border-radius:9px;
      padding:8px 12px;background:#242424;color:#e7d9ba;font:inherit;font-size:15px;font-weight:750;cursor:pointer;
    }
    .${SHEET_CLASS}__choice.is-primary{border-color:#b9995a;background:#b9995a;color:#111}
    .${SHEET_CLASS}__cancel-row{display:flex;justify-content:center;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.055)}
    .${SHEET_CLASS}__cancel{
      min-width:116px;min-height:38px;border:0;background:transparent;color:#b9b2a8;font:inherit;font-size:13px;font-weight:700;cursor:pointer;
    }
    @media(max-width:620px){
      .${SHEET_CLASS}{padding:10px max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left))}
      .${SHEET_CLASS}__panel{width:100%;border-radius:15px;padding:15px}
      .${SHEET_CLASS}__choice{min-height:50px}
    }
  `;
  document.head.append(style);
}

function tileTitle(option: HTMLElement): string {
  return option.querySelector<HTMLElement>(".import-source__option-title")?.textContent?.trim() ?? "";
}

function activeBatchPicker(option: HTMLElement): HTMLElement | undefined {
  return option.closest<HTMLElement>(".import-source__panel.is-batch-intake-picker") ?? undefined;
}

function closeFirstLevelPicker(panel: HTMLElement): void {
  panel.closest<HTMLElement>(".import-source")?.remove();
}

function normalImageInput(useCamera: boolean): HTMLInputElement | undefined {
  const root = document.querySelector<HTMLElement>(".batch-setup") ?? document.body;
  const inputs = [...root.querySelectorAll<HTMLInputElement>('input[type="file"][accept="image/*"]')];
  if (useCamera) return inputs.find((input) => input.hasAttribute("capture"));
  return inputs.find((input) => !input.hasAttribute("capture") && input.multiple)
    ?? inputs.find((input) => !input.hasAttribute("capture"));
}

function startNormalImageSource(panel: HTMLElement, useCamera: boolean): void {
  const input = normalImageInput(useCamera);
  if (!input) {
    window.alert(useCamera ? "当前设备未提供拍照入口。" : "当前设备未提供图片上传入口。");
    return;
  }
  closeFirstLevelPicker(panel);
  input.click();
}

function startSplitImageSource(panel: HTMLElement, useCamera: boolean): void {
  const action = document.querySelector<HTMLButtonElement>('.batch-setup__capture-actions [data-manual-split-photo]');
  if (!action) {
    window.alert("分割识别入口暂不可用。");
    return;
  }
  closeFirstLevelPicker(panel);

  /* Reuse the existing split crop/worker pipeline. Its old source chooser is
     opened and resolved synchronously before paint, so only this shared sheet
     is visible to the user. */
  action.click();
  const legacy = document.querySelector<HTMLElement>(".manual-split-photo--source");
  const choice = legacy?.querySelector<HTMLButtonElement>(useCamera ? "[data-camera]" : "[data-upload]");
  if (!choice) {
    legacy?.remove();
    window.alert("分割识别图片来源暂不可用。");
    return;
  }
  choice.click();
}

function openSourceSheet(mode: ImageSourceMode, panel: HTMLElement): void {
  document.querySelector(`.${SHEET_CLASS}`)?.remove();
  const overlay = document.createElement("div");
  overlay.className = SHEET_CLASS;
  overlay.innerHTML = `
    <section class="${SHEET_CLASS}__panel" role="dialog" aria-modal="true" aria-label="选择图片来源">
      <h2 class="${SHEET_CLASS}__title">选择图片来源</h2>
      <p class="${SHEET_CLASS}__help">${mode === "split"
        ? "分割识别：先选择拍照或上传一张图片，随后进入框选分区。"
        : "图片录入：选择拍照或上传已有图片，多图上传仍按图片顺序进入识别流程。"}</p>
      <div class="${SHEET_CLASS}__choices">
        <button type="button" class="${SHEET_CLASS}__choice is-primary" data-source-camera>拍照</button>
        <button type="button" class="${SHEET_CLASS}__choice" data-source-upload>上传图片</button>
      </div>
      <div class="${SHEET_CLASS}__cancel-row"><button type="button" class="${SHEET_CLASS}__cancel" data-source-cancel>取消</button></div>
    </section>`;

  const close = (): void => overlay.remove();
  const choose = (useCamera: boolean): void => {
    close();
    if (mode === "split") startSplitImageSource(panel, useCamera);
    else startNormalImageSource(panel, useCamera);
  };
  overlay.querySelector<HTMLButtonElement>("[data-source-camera]")!.onclick = () => choose(true);
  overlay.querySelector<HTMLButtonElement>("[data-source-upload]")!.onclick = () => choose(false);
  overlay.querySelector<HTMLButtonElement>("[data-source-cancel]")!.onclick = close;
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  document.body.append(overlay);
}

function interceptSourceTile(event: Event): void {
  const target = event.target instanceof Element ? event.target : undefined;
  const option = target?.closest<HTMLElement>(".import-source__option");
  if (!option) return;
  const panel = activeBatchPicker(option);
  if (!panel) return;
  const title = tileTitle(option);
  if (title !== "图片" && title !== "分割识别") return;

  event.preventDefault();
  event.stopImmediatePropagation();
  openSourceSheet(title === "分割识别" ? "split" : "image", panel);
}

function installUnifiedSourceFlow(): void {
  installSourceChoiceLayout();
  document.addEventListener("click", interceptSourceTile, true);
}

if (typeof document !== "undefined") installUnifiedSourceFlow();
