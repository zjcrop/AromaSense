export const OVERLAY_KINDS = Object.freeze({
  TRANSIENT: "transient",
  DIALOG: "dialog",
  MODAL: "modal",
  SHEET: "sheet",
  PAGE: "page"
} as const);

export type OverlayKind = typeof OVERLAY_KINDS[keyof typeof OVERLAY_KINDS];
export type BackHandler = () => void | Promise<void>;
export type Cleanup = () => void;

interface EventTargetPort {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface BackEntry {
  id: string;
  back: BackHandler;
  canBack: () => boolean;
  priority: number;
  scope?: string;
  leavesContext: boolean;
  sequence: number;
}

interface OverlayEntry {
  id: string;
  element: HTMLElement;
  kind: OverlayKind;
  dismiss: BackHandler;
  scrim: boolean;
  priority: number;
  sequence: number;
}

export interface RootExitConfirmation {
  dirty: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export interface InteractionSnapshot {
  page: string;
  overlays: readonly { id: string; kind: OverlayKind; scrim: boolean; priority: number }[];
  flows: readonly { id: string; priority: number; scope?: string; leavesContext: boolean }[];
  children: readonly { id: string; scope?: string; leavesContext: boolean }[];
  draft: { dirty: boolean; scopes: readonly string[] };
  rootExit: { native: boolean; armed: boolean; confirmOpen: boolean };
}

export interface AromaSenseNativeBridge {
  exitApp(): void;
}

export interface AromaSenseNavigationApi {
  back(options?: { source?: string }): boolean;
  systemBack(): boolean;
  canGoBack(): boolean;
  snapshot(): InteractionSnapshot;
  registerOverlay(options: RegisterOverlayOptions): Cleanup;
  registerFlowBack(options: RegisterBackOptions): Cleanup;
  registerChildBack(options: RegisterBackOptions): Cleanup;
  setDraftDirty(scope: string, dirty?: boolean): boolean;
  clearDraft(scope: string): boolean;
  isDraftDirty(scope?: string): boolean;
}

declare global {
  interface Window {
    AromaSenseNative?: AromaSenseNativeBridge;
    AromaSenseNavigation?: AromaSenseNavigationApi;
  }
}

export interface RegisterBackOptions {
  id?: string;
  back: BackHandler;
  canBack?: () => boolean;
  priority?: number;
  scope?: string;
  leavesContext?: boolean;
}

export interface RegisterOverlayOptions {
  id?: string;
  element: HTMLElement;
  kind?: OverlayKind;
  dismiss?: BackHandler;
  scrim?: boolean;
  priority?: number;
}

function invoke(handler: BackHandler): void {
  try {
    const result = handler();
    if (result && typeof (result as Promise<void>).catch === "function") {
      void (result as Promise<void>).catch((error) => console.error("AromaSense navigation handler failed", error));
    }
  } catch (error) {
    console.error("AromaSense navigation handler failed", error);
  }
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  if (!element.isConnected) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

export class DraftGuard {
  private readonly dirtyScopes = new Set<string>();
  private beforeUnloadAttached = false;
  private readonly boundBeforeUnload: EventListener;

  constructor(private readonly windowTarget?: EventTargetPort) {
    this.boundBeforeUnload = (event: Event): void => {
      if (!this.isDirty()) return;
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = "";
    };
  }

  setDirty(scope = "default", dirty = true): boolean {
    const key = scope || "default";
    if (dirty) this.dirtyScopes.add(key);
    else this.dirtyScopes.delete(key);
    this.syncBeforeUnload();
    return this.isDirty(key);
  }

  clear(scope = "default"): boolean {
    return this.setDirty(scope, false);
  }

  isDirty(scope?: string): boolean {
    return scope === undefined ? this.dirtyScopes.size > 0 : this.dirtyScopes.has(scope);
  }

  decision(scope?: string): "allow" | "confirm" {
    return this.isDirty(scope) ? "confirm" : "allow";
  }

  snapshot(): { dirty: boolean; scopes: readonly string[] } {
    return { dirty: this.isDirty(), scopes: [...this.dirtyScopes] };
  }

  dispose(): void {
    if (this.beforeUnloadAttached) this.windowTarget?.removeEventListener("beforeunload", this.boundBeforeUnload);
    this.beforeUnloadAttached = false;
    this.dirtyScopes.clear();
  }

  private syncBeforeUnload(): void {
    const shouldAttach = this.isDirty();
    if (shouldAttach === this.beforeUnloadAttached || !this.windowTarget) return;
    if (shouldAttach) this.windowTarget.addEventListener("beforeunload", this.boundBeforeUnload);
    else this.windowTarget.removeEventListener("beforeunload", this.boundBeforeUnload);
    this.beforeUnloadAttached = shouldAttach;
  }
}

export class FlowNavigation {
  private entries: BackEntry[] = [];
  private sequence = 0;

  register(options: RegisterBackOptions): Cleanup {
    const entry: BackEntry = {
      id: options.id ?? `flow-${this.sequence + 1}`,
      back: options.back,
      canBack: options.canBack ?? (() => true),
      priority: Number(options.priority ?? 0),
      scope: options.scope,
      leavesContext: options.leavesContext === true,
      sequence: ++this.sequence
    };
    this.entries.push(entry);
    return () => { this.entries = this.entries.filter((candidate) => candidate !== entry); };
  }

  peek(): BackEntry | undefined {
    return this.entries
      .filter((entry) => entry.canBack())
      .sort((left, right) => right.priority - left.priority || right.sequence - left.sequence)[0];
  }

  canBack(): boolean {
    return Boolean(this.peek());
  }

  snapshot(): readonly { id: string; priority: number; scope?: string; leavesContext: boolean }[] {
    return this.entries.map(({ id, priority, scope, leavesContext }) => ({ id, priority, scope, leavesContext }));
  }
}

export class OverlayManager {
  private entries: OverlayEntry[] = [];
  private sequence = 0;
  private readonly scrimId = "interactionScrim";

  constructor(private readonly documentTarget?: Document) {}

  start(): this {
    this.ensureScrim();
    this.syncScrim();
    return this;
  }

  stop(): void {
    this.entries = [];
    this.syncScrim();
  }

  register(options: RegisterOverlayOptions): Cleanup {
    const kind = options.kind ?? OVERLAY_KINDS.MODAL;
    const entry: OverlayEntry = {
      id: options.id ?? `overlay-${this.sequence + 1}`,
      element: options.element,
      kind,
      dismiss: options.dismiss ?? (() => options.element.remove()),
      scrim: options.scrim !== false && kind !== OVERLAY_KINDS.PAGE,
      priority: Number(options.priority ?? 0),
      sequence: ++this.sequence
    };
    this.normalize(options.element, kind);
    this.entries.push(entry);
    this.syncScrim();
    return () => {
      this.entries = this.entries.filter((candidate) => candidate !== entry);
      this.syncScrim();
    };
  }

  top(kinds?: readonly OverlayKind[]): OverlayEntry | undefined {
    const wanted = kinds ? new Set(kinds) : undefined;
    return this.entries
      .filter((entry) => isVisible(entry.element) && (!wanted || wanted.has(entry.kind)))
      .sort((left, right) => right.priority - left.priority || right.sequence - left.sequence)[0];
  }

  canDismiss(kinds?: readonly OverlayKind[]): boolean {
    return Boolean(this.top(kinds));
  }

  dismissTop(kinds?: readonly OverlayKind[]): boolean {
    const entry = this.top(kinds);
    if (!entry) return false;
    invoke(entry.dismiss);
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    queueMicrotask(() => this.syncScrim());
    return true;
  }

  snapshot(): readonly { id: string; kind: OverlayKind; scrim: boolean; priority: number }[] {
    return this.entries
      .filter((entry) => isVisible(entry.element))
      .map(({ id, kind, scrim, priority }) => ({ id, kind, scrim, priority }));
  }

  showNotice(message: string): void {
    if (!this.documentTarget?.body) return;
    this.documentTarget.getElementById("interactionNotice")?.remove();
    const notice = this.documentTarget.createElement("div");
    notice.id = "interactionNotice";
    notice.className = "interaction-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.textContent = message;
    this.documentTarget.body.append(notice);
    setTimeout(() => notice.remove(), 1800);
  }

  openSystemDialog(options: {
    id: string;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm(): void;
    onCancel?(): void;
  }): Cleanup {
    if (!this.documentTarget?.body) return () => undefined;
    const overlay = this.documentTarget.createElement("div");
    overlay.id = options.id;
    overlay.className = "interaction-system-overlay";
    overlay.dataset.interactionKind = OVERLAY_KINDS.DIALOG;
    overlay.setAttribute("role", "presentation");

    const panel = this.documentTarget.createElement("section");
    panel.className = "interaction-system-dialog";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    const title = this.documentTarget.createElement("h2");
    title.textContent = options.title;
    const message = this.documentTarget.createElement("p");
    message.textContent = options.message;
    const actions = this.documentTarget.createElement("div");
    actions.className = "interaction-system-dialog__actions";
    const cancel = this.documentTarget.createElement("button");
    cancel.type = "button";
    cancel.textContent = options.cancelLabel ?? "取消";
    const confirm = this.documentTarget.createElement("button");
    confirm.type = "button";
    confirm.textContent = options.confirmLabel;
    if (options.danger) confirm.dataset.danger = "true";
    actions.append(cancel, confirm);
    panel.append(title, message, actions);
    overlay.append(panel);
    this.documentTarget.body.append(overlay);

    let unregister: Cleanup = () => undefined;
    const close = (cancelled: boolean): void => {
      unregister();
      overlay.remove();
      this.syncScrim();
      if (cancelled) options.onCancel?.();
    };
    unregister = this.register({
      id: options.id,
      element: overlay,
      kind: OVERLAY_KINDS.DIALOG,
      priority: 1000,
      dismiss: () => close(true)
    });
    cancel.onclick = () => close(true);
    confirm.onclick = () => {
      close(false);
      options.onConfirm();
    };
    return () => close(true);
  }

  private ensureScrim(): HTMLElement | undefined {
    if (!this.documentTarget?.body) return undefined;
    let scrim = this.documentTarget.getElementById(this.scrimId);
    if (!scrim) {
      scrim = this.documentTarget.createElement("div");
      scrim.id = this.scrimId;
      scrim.className = "interaction-scrim";
      scrim.hidden = true;
      scrim.setAttribute("aria-hidden", "true");
      this.documentTarget.body.append(scrim);
    }
    return scrim;
  }

  private normalize(element: HTMLElement, kind: OverlayKind): void {
    if (kind === OVERLAY_KINDS.PAGE) return;
    element.dataset.interactionManaged = "true";
    element.style.setProperty("background", "transparent", "important");
    element.style.setProperty("backdrop-filter", "none", "important");
    element.style.setProperty("-webkit-backdrop-filter", "none", "important");
  }

  private syncScrim(): void {
    const scrim = this.ensureScrim();
    if (!scrim) return;
    const visible = this.entries.some((entry) => entry.scrim && isVisible(entry.element));
    scrim.hidden = !visible;
    scrim.setAttribute("aria-hidden", visible ? "false" : "true");
  }
}

export class RootExitGuard {
  private armedUntil = 0;
  private confirmOpen = false;

  constructor(private readonly options: {
    draftGuard: DraftGuard;
    notify(message: string): void;
    openConfirmation(options: RootExitConfirmation): void;
    exit(): void;
    isNative(): boolean;
    clock?: () => number;
    windowMs?: number;
  }) {}

  canHandle(): boolean {
    return this.options.isNative();
  }

  back(): boolean {
    if (!this.canHandle()) return false;
    if (this.confirmOpen) return true;
    const now = (this.options.clock ?? Date.now)();
    const windowMs = this.options.windowMs ?? 2000;
    if (!this.armedUntil || now > this.armedUntil) {
      this.armedUntil = now + windowMs;
      this.options.notify("再按一次返回以打开退出确认");
      return true;
    }
    this.armedUntil = 0;
    this.confirmOpen = true;
    this.options.openConfirmation({
      dirty: this.options.draftGuard.decision() === "confirm",
      onConfirm: () => {
        this.confirmOpen = false;
        this.options.exit();
      },
      onCancel: () => { this.confirmOpen = false; }
    });
    return true;
  }

  reset(): void {
    this.armedUntil = 0;
    this.confirmOpen = false;
  }

  snapshot(): { native: boolean; armed: boolean; confirmOpen: boolean } {
    const now = (this.options.clock ?? Date.now)();
    return { native: this.canHandle(), armed: Boolean(this.armedUntil && now <= this.armedUntil), confirmOpen: this.confirmOpen };
  }
}

export class NavigationManager {
  private childEntries: BackEntry[] = [];
  private childSequence = 0;
  private activePage = "setup";

  constructor(private readonly options: {
    overlayManager: OverlayManager;
    flowNavigation: FlowNavigation;
    draftGuard: DraftGuard;
    rootExitGuard: RootExitGuard;
    documentTarget?: Document;
    legacyBack?: BackHandler;
    confirmDraftLeave?: (options: { scope?: string; onConfirm(): void }) => void;
  }) {}

  setActivePage(page: string): void {
    if (page) this.activePage = page;
  }

  registerChildBack(options: RegisterBackOptions): Cleanup {
    const entry: BackEntry = {
      id: options.id ?? `child-${this.childSequence + 1}`,
      back: options.back,
      canBack: options.canBack ?? (() => true),
      priority: Number(options.priority ?? 0),
      scope: options.scope,
      leavesContext: options.leavesContext === true,
      sequence: ++this.childSequence
    };
    this.childEntries.push(entry);
    return () => { this.childEntries = this.childEntries.filter((candidate) => candidate !== entry); };
  }

  canGoBack(): boolean {
    const overlays = this.options.overlayManager;
    if (overlays.canDismiss([OVERLAY_KINDS.TRANSIENT, OVERLAY_KINDS.DIALOG, OVERLAY_KINDS.MODAL, OVERLAY_KINDS.SHEET])) return true;
    if (this.options.flowNavigation.canBack()) return true;
    if (this.topChild()) return true;
    return this.options.rootExitGuard.canHandle();
  }

  back(_options: { source?: string } = {}): boolean {
    if (this.handleKeyboard()) return true;
    const overlays = this.options.overlayManager;
    if (overlays.dismissTop([OVERLAY_KINDS.TRANSIENT])) return true;
    if (overlays.dismissTop([OVERLAY_KINDS.DIALOG])) return true;
    if (overlays.dismissTop([OVERLAY_KINDS.MODAL, OVERLAY_KINDS.SHEET])) return true;

    const flow = this.options.flowNavigation.peek();
    if (flow) return this.runEntry(flow);
    const child = this.topChild();
    if (child) return this.runEntry(child);
    if (this.options.legacyBack) {
      invoke(this.options.legacyBack);
      return true;
    }
    return this.options.rootExitGuard.back();
  }

  snapshot(): InteractionSnapshot {
    return {
      page: this.activePage,
      overlays: this.options.overlayManager.snapshot(),
      flows: this.options.flowNavigation.snapshot(),
      children: this.childEntries.map(({ id, scope, leavesContext }) => ({ id, scope, leavesContext })),
      draft: this.options.draftGuard.snapshot(),
      rootExit: this.options.rootExitGuard.snapshot()
    };
  }

  private topChild(): BackEntry | undefined {
    return this.childEntries
      .filter((entry) => entry.canBack())
      .sort((left, right) => right.priority - left.priority || right.sequence - left.sequence)[0];
  }

  private runEntry(entry: BackEntry): boolean {
    if (entry.leavesContext && this.options.draftGuard.decision(entry.scope) === "confirm") {
      this.options.confirmDraftLeave?.({ scope: entry.scope, onConfirm: () => invoke(entry.back) });
      return true;
    }
    invoke(entry.back);
    return true;
  }

  private handleKeyboard(): boolean {
    const active = this.options.documentTarget?.activeElement;
    if (!(active instanceof HTMLElement) || active === this.options.documentTarget?.body) return false;
    const tag = active.tagName.toLowerCase();
    if (!["input", "textarea", "select"].includes(tag) && !active.isContentEditable) return false;
    active.blur();
    return true;
  }
}

export class BackGestureAdapter {
  constructor(private readonly navigation: NavigationManager) {}
  back(source = "system"): boolean {
    return this.navigation.back({ source });
  }
}

export class InteractionFoundation {
  readonly overlayManager: OverlayManager;
  readonly flowNavigation: FlowNavigation;
  readonly draftGuard: DraftGuard;
  readonly rootExitGuard: RootExitGuard;
  readonly navigationManager: NavigationManager;
  readonly backGesture: BackGestureAdapter;
  readonly api: AromaSenseNavigationApi;

  constructor(options: {
    documentTarget?: Document;
    windowTarget?: Window;
    isNative?: () => boolean;
    exit?: () => void;
  } = {}) {
    const documentTarget = options.documentTarget ?? (typeof document === "undefined" ? undefined : document);
    const windowTarget = options.windowTarget ?? (typeof window === "undefined" ? undefined : window);
    this.overlayManager = new OverlayManager(documentTarget).start();
    this.flowNavigation = new FlowNavigation();
    this.draftGuard = new DraftGuard(windowTarget);
    const isNative = options.isNative ?? (() => Boolean(windowTarget?.AromaSenseNative?.exitApp));
    const exit = options.exit ?? (() => windowTarget?.AromaSenseNative?.exitApp());
    this.rootExitGuard = new RootExitGuard({
      draftGuard: this.draftGuard,
      isNative,
      exit,
      notify: (message) => this.overlayManager.showNotice(message),
      openConfirmation: ({ dirty, onConfirm, onCancel }) => {
        this.overlayManager.openSystemDialog({
          id: "interaction-root-exit-confirm",
          title: "退出香迹？",
          message: dirty ? "当前仍有未保存修改。退出应用可能丢失这些编辑内容。" : "确认退出应用。",
          confirmLabel: "退出",
          cancelLabel: "取消",
          danger: true,
          onConfirm,
          onCancel
        });
      }
    });
    this.navigationManager = new NavigationManager({
      overlayManager: this.overlayManager,
      flowNavigation: this.flowNavigation,
      draftGuard: this.draftGuard,
      rootExitGuard: this.rootExitGuard,
      documentTarget,
      confirmDraftLeave: ({ scope, onConfirm }) => {
        this.overlayManager.openSystemDialog({
          id: "interaction-draft-confirm",
          title: "存在未保存修改",
          message: scope ? `“${scope}”尚未保存。继续返回会离开当前编辑内容。` : "当前编辑尚未保存。继续返回会离开当前编辑内容。",
          confirmLabel: "继续返回",
          cancelLabel: "留在这里",
          danger: true,
          onConfirm,
          onCancel: () => undefined
        });
      }
    });
    this.backGesture = new BackGestureAdapter(this.navigationManager);
    this.api = Object.freeze({
      back: (backOptions = {}) => this.navigationManager.back(backOptions),
      systemBack: () => this.backGesture.back("android-system"),
      canGoBack: () => this.navigationManager.canGoBack(),
      snapshot: () => this.navigationManager.snapshot(),
      registerOverlay: (registration) => this.overlayManager.register(registration),
      registerFlowBack: (registration) => this.flowNavigation.register(registration),
      registerChildBack: (registration) => this.navigationManager.registerChildBack(registration),
      setDraftDirty: (scope, dirty = true) => this.draftGuard.setDirty(scope, dirty),
      clearDraft: (scope) => this.draftGuard.clear(scope),
      isDraftDirty: (scope) => this.draftGuard.isDirty(scope)
    });
  }

  dispose(): void {
    this.draftGuard.dispose();
    this.overlayManager.stop();
  }
}
