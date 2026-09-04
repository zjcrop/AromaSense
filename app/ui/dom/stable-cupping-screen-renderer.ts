import type { SampleSummaryReader } from "../../storage/sample-summary-reader";
import type { SampleRecord } from "../../core/sample-batch-service";
import type { CuppingScreenController } from "../cupping-screen-controller";
import type { FlavorGroupPreferenceService } from "../flavor-group-preferences";
import {
  CuppingScreenRenderer as BaseCuppingScreenRenderer,
  type CuppingScreenRendererOptions
} from "./cupping-screen-renderer";

const BLIND_IDENTITY_FIELDS: readonly [string, string, string][] = [
  ["country", "国家", "例如 Ethiopia"],
  ["region", "产区", "例如 Guji"],
  ["farm", "庄园/处理站", "庄园、合作社或处理站"],
  ["variety", "品种", "例如 Heirloom"],
  ["process", "处理法", "例如 Washed / Natural"],
  ["roast", "烘焙度", "例如 浅烘"],
  ["roastDate", "烘焙日期", "例如 2026-07-15 / 七月十五日 / 15 Jul 2026"],
  ["altitude", "海拔", "例如 1950–2100 m"],
  ["flavorNotes", "风味信息", "包装或已知风味信息"]
];

function editableText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Keeps the cupping editor at the user's current vertical position while the
 * base renderer replaces DOM after local persistence. The user can still
 * scroll deliberately inside the editor; renderer/focus-induced page jumps
 * are cancelled and the outer document remains fixed to the viewport.
 *
 * Blind/semi-blind identity editing is deliberately attached here rather than
 * to sensory observations: identity metadata is persisted on the sample row
 * and remains hidden by the blind-session visibility policy until reveal.
 */
export class CuppingScreenRenderer {
  private readonly base: BaseCuppingScreenRenderer;
  private editor?: HTMLElement;
  private observer?: MutationObserver;
  private lastScrollTop = 0;
  private lockedScrollTop?: number;
  private suppressScrollCapture = false;
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private previousHtmlOverflow = "";
  private previousBodyOverflow = "";
  private previousRootHeight = "";
  private previousRootOverflow = "";

  private readonly captureInteractionPosition = (): void => {
    if (!this.editor) return;
    this.lockedScrollTop = this.editor.scrollTop;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => { this.lockedScrollTop = undefined; }, 3000);
  };

  private readonly captureUserScroll = (): void => {
    if (!this.editor || this.suppressScrollCapture || this.lockedScrollTop !== undefined) return;
    this.lastScrollTop = this.editor.scrollTop;
  };

  private readonly handleBlindStatusClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".cupping-main__blind-status") : null;
    if (!target?.classList.contains("is-editable")) return;
    event.preventDefault();
    void this.openBlindIdentityEditor();
  };

  private readonly handleBlindStatusKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".cupping-main__blind-status") : null;
    if (!target?.classList.contains("is-editable")) return;
    event.preventDefault();
    void this.openBlindIdentityEditor();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: CuppingScreenController,
    flavorService: FlavorGroupPreferenceService,
    summaryReader: SampleSummaryReader,
    private readonly options: CuppingScreenRendererOptions
  ) {
    this.base = new BaseCuppingScreenRenderer(root, controller, flavorService, summaryReader, options);
  }

  async initialize(sessionId: string): Promise<void> {
    await this.base.initialize(sessionId);
    this.installViewportStability();
    this.enhanceBlindStatus();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = undefined;
    this.editor?.removeEventListener("scroll", this.captureUserScroll);
    this.root.removeEventListener("pointerdown", this.captureInteractionPosition, true);
    this.root.removeEventListener("keydown", this.captureInteractionPosition, true);
    this.root.removeEventListener("input", this.captureInteractionPosition, true);
    this.root.removeEventListener("change", this.captureInteractionPosition, true);
    this.root.removeEventListener("click", this.handleBlindStatusClick);
    this.root.removeEventListener("keydown", this.handleBlindStatusKeydown);
    this.root.querySelector(".blind-identity-editor")?.remove();
    document.documentElement.style.overflow = this.previousHtmlOverflow;
    document.body.style.overflow = this.previousBodyOverflow;
    this.root.style.height = this.previousRootHeight;
    this.root.style.overflow = this.previousRootOverflow;
    this.editor = undefined;
    this.base.dispose();
  }

  private installViewportStability(): void {
    const editor = this.root.querySelector<HTMLElement>(".cupping-main__editor");
    if (!editor) return;
    this.editor = editor;
    this.lastScrollTop = editor.scrollTop;

    this.previousHtmlOverflow = document.documentElement.style.overflow;
    this.previousBodyOverflow = document.body.style.overflow;
    this.previousRootHeight = this.root.style.height;
    this.previousRootOverflow = this.root.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    this.root.style.height = "100dvh";
    this.root.style.overflow = "hidden";
    editor.style.overflowAnchor = "none";
    editor.style.scrollBehavior = "auto";
    editor.style.overscrollBehavior = "contain";

    editor.addEventListener("scroll", this.captureUserScroll, { passive: true });
    this.root.addEventListener("pointerdown", this.captureInteractionPosition, true);
    this.root.addEventListener("keydown", this.captureInteractionPosition, true);
    this.root.addEventListener("input", this.captureInteractionPosition, true);
    this.root.addEventListener("change", this.captureInteractionPosition, true);
    this.root.addEventListener("click", this.handleBlindStatusClick);
    this.root.addEventListener("keydown", this.handleBlindStatusKeydown);

    this.observer = new MutationObserver(() => {
      this.enhanceBlindStatus();
      this.restoreViewportPosition();
    });
    this.observer.observe(this.root, { childList: true, subtree: true });
  }

  private enhanceBlindStatus(): void {
    const status = this.root.querySelector<HTMLElement>(".cupping-main__blind-status");
    if (!status) return;
    const state = this.controller.current();
    const editable = Boolean(state && state.sessionStatus !== "completed" && state.sessionStatus !== "archived");
    status.classList.toggle("is-editable", editable);
    if (!editable) {
      status.removeAttribute("role");
      status.removeAttribute("tabindex");
      status.removeAttribute("title");
      status.querySelector(".cupping-main__blind-edit-hint")?.remove();
      return;
    }
    status.setAttribute("role", "button");
    status.tabIndex = 0;
    status.title = "点击补录或修改盲测样品信息";
    if (!status.querySelector(".cupping-main__blind-edit-hint")) {
      const hint = document.createElement("span");
      hint.className = "cupping-main__blind-edit-hint";
      hint.textContent = "填写样品信息";
      status.append(hint);
    }
    this.installBlindEditorStyles();
  }

  private installBlindEditorStyles(): void {
    if (document.head.querySelector("style[data-aromasense-blind-identity-editor]")) return;
    const style = document.createElement("style");
    style.dataset.aromasenseBlindIdentityEditor = "true";
    style.textContent = `
      .cupping-main__blind-status.is-editable{cursor:pointer;user-select:none}
      .cupping-main__blind-status.is-editable:focus-visible{outline:1px solid rgba(214,173,99,.62);outline-offset:2px}
      .cupping-main__blind-edit-hint{margin-left:auto;color:#d6ad63;font-size:10px;white-space:nowrap}
      .blind-identity-editor{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:max(16px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left));background:rgba(0,0,0,.76);backdrop-filter:blur(7px)}
      .blind-identity-editor__panel{width:min(620px,100%);max-height:min(82dvh,760px);overflow:auto;box-sizing:border-box;padding:20px 22px 18px;border:1px solid rgba(214,173,99,.22);background:#111212;box-shadow:0 20px 52px rgba(0,0,0,.44)}
      .blind-identity-editor__head{display:flex;align-items:flex-start;gap:16px;margin-bottom:14px}
      .blind-identity-editor__titles{min-width:0;flex:1}
      .blind-identity-editor__title{margin:0;color:#f4f1eb;font-size:17px}
      .blind-identity-editor__note{margin:5px 0 0;color:#918d86;font-size:11px;line-height:1.55}
      .blind-identity-editor__close,.blind-identity-editor__save{appearance:none;border:0;background:transparent;font:inherit;cursor:pointer}
      .blind-identity-editor__close{color:#8f8b84;padding:2px 0;font-size:20px;line-height:1}
      .blind-identity-editor__save{color:#d6ad63;padding:9px 0;font-weight:800}
      .blind-identity-editor__sample{width:100%;box-sizing:border-box;margin:0 0 14px;padding:8px 0;border:0;border-bottom:1px solid rgba(214,173,99,.28);border-radius:0;background:#111212;color:#f4f1eb;font:inherit}
      .blind-identity-editor__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 20px}
      .blind-identity-editor__field{display:grid;gap:4px;min-width:0}
      .blind-identity-editor__field--wide{grid-column:1/-1}
      .blind-identity-editor__label{color:#918d86;font-size:10px}
      .blind-identity-editor__input{width:100%;box-sizing:border-box;padding:7px 0;border:0;border-bottom:1px solid rgba(214,173,99,.22);border-radius:0;outline:none;background:transparent;color:#f4f1eb;font:inherit;font-size:13px}
      .blind-identity-editor__input:focus{border-bottom-color:#d6ad63}
      .blind-identity-editor__footer{display:flex;justify-content:flex-end;margin-top:18px;border-top:1px solid rgba(255,255,255,.055);padding-top:8px}
      .blind-identity-editor__status{margin-right:auto;align-self:center;color:#918d86;font-size:10px}
      .blind-identity-editor__status.is-error{color:#d87b72}
      @media(max-width:620px){.blind-identity-editor__panel{max-height:88dvh;padding:17px 16px 15px}.blind-identity-editor__grid{grid-template-columns:1fr;gap:9px}.blind-identity-editor__field--wide{grid-column:auto}}
    `;
    document.head.append(style);
  }

  private async openBlindIdentityEditor(): Promise<void> {
    if (this.root.querySelector(".blind-identity-editor")) return;
    const state = this.controller.current();
    if (!state || !state.samples.length) return;
    if (state.sessionStatus === "completed" || state.sessionStatus === "archived") return;

    this.installBlindEditorStyles();
    const overlay = document.createElement("div");
    overlay.className = "blind-identity-editor";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "盲测样品信息编辑");

    const panel = document.createElement("section");
    panel.className = "blind-identity-editor__panel";
    const head = document.createElement("div");
    head.className = "blind-identity-editor__head";
    const titles = document.createElement("div");
    titles.className = "blind-identity-editor__titles";
    const title = document.createElement("h2");
    title.className = "blind-identity-editor__title";
    title.textContent = "盲测样品信息";
    const note = document.createElement("p");
    note.className = "blind-identity-editor__note";
    note.textContent = "信息会立即保存到对应样品，但盲测进行中仍按盲测规则隐藏；整场完成后统一揭盲。可在任意杯测步骤再次打开修改。";
    titles.append(title, note);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "blind-identity-editor__close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    head.append(titles, close);

    const selector = document.createElement("select");
    selector.className = "blind-identity-editor__sample";
    selector.setAttribute("aria-label", "选择样品编号");
    for (const sample of state.samples) {
      const option = document.createElement("option");
      option.value = sample.sampleId;
      option.textContent = `Sample ${String(sample.displayNumber).padStart(2, "0")}`;
      selector.append(option);
    }
    selector.value = state.active?.context.sampleId ?? state.samples[0]!.sampleId;

    const grid = document.createElement("div");
    grid.className = "blind-identity-editor__grid";
    const nameField = document.createElement("label");
    nameField.className = "blind-identity-editor__field blind-identity-editor__field--wide";
    const nameLabel = document.createElement("span");
    nameLabel.className = "blind-identity-editor__label";
    nameLabel.textContent = "样品名称";
    const nameInput = document.createElement("input");
    nameInput.className = "blind-identity-editor__input";
    nameInput.type = "text";
    nameInput.placeholder = "真实豆名，可暂时留空";
    nameField.append(nameLabel, nameInput);
    grid.append(nameField);

    const inputs = new Map<string, HTMLInputElement>();
    for (const [key, label, placeholder] of BLIND_IDENTITY_FIELDS) {
      const field = document.createElement("label");
      field.className = `blind-identity-editor__field${key === "flavorNotes" ? " blind-identity-editor__field--wide" : ""}`;
      const caption = document.createElement("span");
      caption.className = "blind-identity-editor__label";
      caption.textContent = label;
      const input = document.createElement("input");
      input.className = "blind-identity-editor__input";
      input.type = "text";
      input.placeholder = placeholder;
      field.append(caption, input);
      inputs.set(key, input);
      grid.append(field);
    }

    const footer = document.createElement("div");
    footer.className = "blind-identity-editor__footer";
    const status = document.createElement("span");
    status.className = "blind-identity-editor__status";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "blind-identity-editor__save";
    save.textContent = "保存样品信息";
    footer.append(status, save);

    const findSample = (): SampleRecord | undefined => this.controller.current()?.samples.find((item) => item.sampleId === selector.value);
    const populate = (): void => {
      const sample = findSample();
      nameInput.value = sample?.label ?? "";
      for (const [key, input] of inputs) input.value = editableText(sample?.metadata[key]);
      status.textContent = "";
      status.classList.remove("is-error");
    };
    populate();

    const dismiss = (): void => overlay.remove();
    close.onclick = dismiss;
    overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) dismiss(); });
    overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") dismiss(); });
    selector.onchange = populate;
    save.onclick = async () => {
      const sample = findSample();
      if (!sample) return;
      save.disabled = true;
      status.textContent = "保存中…";
      status.classList.remove("is-error");
      try {
        const patch: Record<string, unknown> = {};
        for (const [key, input] of inputs) patch[key] = input.value;
        await this.controller.saveSampleIdentity(sample.sampleId, nameInput.value, patch, this.options.now());
        status.textContent = "已保存，盲测仍保持隐藏";
        setTimeout(dismiss, 220);
      } catch (error) {
        status.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
        status.classList.add("is-error");
      } finally {
        save.disabled = false;
      }
    };

    panel.append(head, selector, grid, footer);
    overlay.append(panel);
    this.root.append(overlay);
    requestAnimationFrame(() => nameInput.focus());
  }

  private restoreViewportPosition(): void {
    const editor = this.editor;
    if (!editor) return;
    const target = this.lockedScrollTop ?? this.lastScrollTop;
    this.suppressScrollCapture = true;
    editor.scrollTop = target;

    requestAnimationFrame(() => {
      if (!this.editor) return;
      this.editor.scrollTop = target;
      requestAnimationFrame(() => {
        if (!this.editor) return;
        this.editor.scrollTop = target;
        this.lastScrollTop = target;
        this.lockedScrollTop = undefined;
        this.suppressScrollCapture = false;
      });
    });
  }
}

export type { CuppingScreenRendererOptions };
