import type { SampleSummaryReader } from "../../storage/sample-summary-reader";
import type { SampleRecord } from "../../core/sample-batch-service";
import type { CuppingScreenController, CuppingScreenState } from "../cupping-screen-controller";
import type { FlavorGroupPreferenceService } from "../flavor-group-preferences";
import { OVERLAY_KINDS, type Cleanup, type OverlayManager } from "../interaction-foundation";
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

const SCROLL_MEMORY_PREFIX = "aromasense.cupping.scroll.v2:";

function editableText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function cuppingContentPageKey(state: CuppingScreenState | undefined): string | undefined {
  const active = state?.active;
  if (!state || !active) return undefined;
  const base = `${state.sessionId}:${active.context.sampleId}:${active.context.stageId}`;
  if (active.context.stageId !== "final") return base;
  const phaseValue = active.slice.observations.find((item) => item.fieldKey === "final_phase")?.value;
  const phase = typeof phaseValue === "string" && phaseValue.trim() ? phaseValue.trim() : "flavor";
  return `${base}:${phase}`;
}

function installCuppingNavigationStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cupping-navigation]") ) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCuppingNavigation = "true";
  style.textContent = `
    .cupping-layout__rail-list{
      min-height:0!important;
      overflow-y:auto!important;
      overflow-x:hidden!important;
      overscroll-behavior-y:contain;
      touch-action:pan-y;
      -webkit-overflow-scrolling:touch;
      scrollbar-width:thin;
      scrollbar-gutter:stable;
    }
    .sample-rail__active-tab{display:none!important}
    .sample-rail__item.is-active::before{
      content:"";
      position:absolute;
      z-index:1;
      left:-6px;
      right:-4px;
      top:1px;
      bottom:1px;
      border:1px solid rgba(214,173,99,.34);
      border-left:0;
      border-radius:0 999px 999px 0;
      background:linear-gradient(90deg,rgba(104,78,39,.96),rgba(128,95,45,.96));
      box-shadow:0 4px 14px rgba(0,0,0,.24),inset -1px 0 0 rgba(255,255,255,.08);
      pointer-events:none;
    }
    .sample-rail__item.is-active .sample-rail__select,
    .sample-rail__item.is-active .sample-rail__actions{position:relative;z-index:3}
    @media(prefers-reduced-motion:no-preference){
      .cupping-layout__rail-list{scroll-behavior:smooth}
    }
  `;
  document.head.append(style);
}

/**
 * Keeps each cupping content page at its own vertical position. A page is keyed
 * by session + sample + stage (and final-assessment sub-phase). First entry is
 * always the top; deliberate user scrolling is restored whenever that exact
 * page is visited again. DOM refreshes caused by local persistence do not move
 * the current viewport.
 *
 * The left sample rail uses one native scroll layer. The active background now
 * belongs to the active card itself, so sample number, identity/progress copy
 * and current marker cannot drift relative to each other while scrolling.
 *
 * Blind/semi-blind identity editing is deliberately attached here rather than
 * to sensory observations: identity metadata is persisted on the sample row
 * and remains hidden by the blind-session visibility policy until reveal.
 */
export class CuppingScreenRenderer {
  private readonly base: BaseCuppingScreenRenderer;
  private editor?: HTMLElement;
  private observer?: MutationObserver;
  private blindOverlayCleanup?: Cleanup;
  private readonly scrollMemory = new Map<string, number>();
  private currentPageKey?: string;
  private scrollSessionId?: string;
  private lockedScrollTop?: number;
  private suppressScrollCapture = false;
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private previousHtmlOverflow = "";
  private previousBodyOverflow = "";
  private previousRootHeight = "";
  private previousRootOverflow = "";

  private readonly captureInteractionPosition = (): void => {
    if (!this.editor) return;
    this.rememberCurrentScroll();
    this.lockedScrollTop = this.editor.scrollTop;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => { this.lockedScrollTop = undefined; }, 3000);
  };

  private readonly captureUserScroll = (): void => {
    if (!this.editor || this.suppressScrollCapture || this.lockedScrollTop !== undefined) return;
    const key = this.currentPageKey ?? cuppingContentPageKey(this.controller.current());
    if (!key) return;
    this.currentPageKey = key;
    this.scrollMemory.set(key, Math.max(0, this.editor.scrollTop));
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
    private readonly options: CuppingScreenRendererOptions,
    private readonly overlayManager?: OverlayManager
  ) {
    installCuppingNavigationStyles();
    this.base = new BaseCuppingScreenRenderer(root, controller, flavorService, summaryReader, options);
  }

  async initialize(sessionId: string): Promise<void> {
    await this.base.initialize(sessionId);
    this.scrollSessionId = sessionId;
    this.loadScrollMemory(sessionId);
    this.installViewportStability();
    this.enhanceBlindStatus();
  }

  dispose(): void {
    this.rememberCurrentScroll();
    this.persistScrollMemory();
    this.observer?.disconnect();
    this.observer = undefined;
    this.blindOverlayCleanup?.();
    this.blindOverlayCleanup = undefined;
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

  private storageKey(sessionId: string): string {
    return `${SCROLL_MEMORY_PREFIX}${sessionId}`;
  }

  private loadScrollMemory(sessionId: string): void {
    this.scrollMemory.clear();
    try {
      const raw = sessionStorage.getItem(this.storageKey(sessionId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        const position = Number(value);
        if (Number.isFinite(position) && position >= 0) this.scrollMemory.set(key, position);
      }
    } catch {
      // Session storage is an enhancement only; in-memory behavior remains valid.
    }
  }

  private persistScrollMemory(): void {
    const sessionId = this.scrollSessionId ?? this.controller.current()?.sessionId;
    if (!sessionId) return;
    try {
      sessionStorage.setItem(this.storageKey(sessionId), JSON.stringify(Object.fromEntries(this.scrollMemory)));
    } catch {
      // Ignore quota/privacy-mode failures; never block cupping edits.
    }
  }

  private rememberCurrentScroll(): void {
    if (!this.editor) return;
    const key = this.currentPageKey ?? cuppingContentPageKey(this.controller.current());
    if (!key) return;
    this.currentPageKey = key;
    this.scrollMemory.set(key, Math.max(0, this.editor.scrollTop));
  }

  private installViewportStability(): void {
    const editor = this.root.querySelector<HTMLElement>(".cupping-main__editor");
    if (!editor) return;
    this.editor = editor;
    this.currentPageKey = cuppingContentPageKey(this.controller.current());

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

    const initial = this.currentPageKey ? (this.scrollMemory.get(this.currentPageKey) ?? 0) : 0;
    editor.scrollTop = initial;

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
      .blind-identity-editor{position:fixed;inset:0;z-index:10010;display:grid;place-items:center;padding:max(16px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left));background:transparent;backdrop-filter:none}
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

    let unregister: Cleanup = () => undefined;
    const dismiss = (): void => {
      unregister();
      if (this.blindOverlayCleanup === unregister) this.blindOverlayCleanup = undefined;
      overlay.remove();
    };
    close.onclick = dismiss;
    overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) dismiss(); });
    overlay.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss();
    });
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
    unregister = this.overlayManager?.register({
      id: "blind-identity-editor",
      element: overlay,
      kind: OVERLAY_KINDS.MODAL,
      priority: 200,
      dismiss
    }) ?? (() => undefined);
    this.blindOverlayCleanup = unregister;
    requestAnimationFrame(() => nameInput.focus());
  }

  private restoreViewportPosition(): void {
    const editor = this.editor;
    if (!editor) return;

    const nextPageKey = cuppingContentPageKey(this.controller.current());
    const pageChanged = nextPageKey !== this.currentPageKey;
    let target = 0;

    if (pageChanged) {
      if (this.currentPageKey) this.scrollMemory.set(this.currentPageKey, Math.max(0, this.lockedScrollTop ?? editor.scrollTop));
      this.currentPageKey = nextPageKey;
      this.lockedScrollTop = undefined;
      target = nextPageKey ? (this.scrollMemory.get(nextPageKey) ?? 0) : 0;
      this.persistScrollMemory();
    } else if (nextPageKey) {
      target = this.lockedScrollTop ?? this.scrollMemory.get(nextPageKey) ?? editor.scrollTop;
    } else {
      target = 0;
    }

    this.suppressScrollCapture = true;
    editor.scrollTop = target;

    requestAnimationFrame(() => {
      if (!this.editor) return;
      this.editor.scrollTop = target;
      requestAnimationFrame(() => {
        if (!this.editor) return;
        this.editor.scrollTop = target;
        if (this.currentPageKey) this.scrollMemory.set(this.currentPageKey, target);
        this.lockedScrollTop = undefined;
        this.suppressScrollCapture = false;
      });
    });
  }
}

export type { CuppingScreenRendererOptions };