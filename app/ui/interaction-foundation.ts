export type OverlayKind = "picker" | "popover" | "dialog" | "modal";
export type BackSource = "android" | "native" | "pwa" | "programmatic" | "keyboard" | "browser";
export type BackPriorityStep = "keyboard" | "picker" | "dialog" | "modal" | "workflow" | "child" | "topLevelRoot" | "appRoot";

export const BACK_PRIORITY: readonly BackPriorityStep[] = [
  "keyboard", "picker", "dialog", "modal", "workflow", "child", "topLevelRoot", "appRoot"
];

export function resolveBackStep(handlers: Readonly<Partial<Record<BackPriorityStep, () => boolean>>>): BackPriorityStep | undefined {
  for (const step of BACK_PRIORITY) if (handlers[step]?.()) return step;
  return undefined;
}

interface ManagedLayer {
  element: HTMLElement;
  kind: OverlayKind;
  sequence: number;
  zIndex: number;
}

export interface InteractionConfirmationOptions {
  id?: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
  onConfirm(): void;
  onCancel?(): void;
}

const LAYER_SELECTOR = [
  "[data-overlay-kind]",
  "[role='listbox']:not([hidden])",
  ".home-modal",
  ".yingxiang-overlay",
  ".blind-identity-editor",
  ".batch-review",
  ".manual-import",
  ".import-bundle",
  ".qr-scanner",
  ".import-source",
  ".cupping-count-dialog",
  ".seg-review",
  ".session-share",
  ".yx-coffee-edit",
  ".interaction-confirmation"
].join(",");

export class OverlayManager {
  private readonly scrimId = "aromasenseInteractionScrim";
  private readonly watchers = new Map<HTMLElement, readonly MutationObserver[]>();
  private waitingForBody = false;
  private sequence = 0;
  private syncQueued = false;

  constructor(private readonly document: Document) {}

  start(): void {
    if (!this.document.body) {
      if (!this.waitingForBody) {
        this.waitingForBody = true;
        this.document.addEventListener("DOMContentLoaded", () => {
          this.waitingForBody = false;
          this.start();
        }, { once: true });
      }
      return;
    }
    this.synchronize();
  }

  dispose(): void {
    for (const observers of this.watchers.values()) observers.forEach((observer) => observer.disconnect());
    this.watchers.clear();
    this.document.getElementById(this.scrimId)?.remove();
    this.document.documentElement.classList.remove("interaction-layer-open");
  }

  manage(element: HTMLElement, kind?: OverlayKind): HTMLElement {
    if (kind) element.dataset.overlayKind = kind;
    element.dataset.overlayManaged = "true";
    if (element.isConnected) {
      this.watch(element);
      this.synchronize();
    } else {
      queueMicrotask(() => {
        if (!element.isConnected) return;
        this.watch(element);
        this.synchronize();
      });
    }
    return element;
  }

  synchronize(): readonly ManagedLayer[] {
    this.syncQueued = false;
    const layers = this.collect();
    layers.forEach((layer) => this.watch(layer.element));
    for (const element of this.watchers.keys()) {
      if (!element.isConnected) this.unwatch(element);
    }
    const scrim = this.ensureScrim();
    const hidden = layers.length === 0;
    if (scrim.hidden !== hidden) scrim.hidden = hidden;
    this.document.documentElement.classList.toggle("interaction-layer-open", layers.length > 0);
    const minimumZ = layers.reduce((value, layer) => Math.min(value, layer.zIndex), 90);
    const scrimZ = String(Math.max(0, minimumZ - 1));
    if (scrim.style.getPropertyValue("--interaction-scrim-z") !== scrimZ) {
      scrim.style.setProperty("--interaction-scrim-z", scrimZ);
    }
    layers.forEach((layer, index) => {
      layer.element.dataset.overlayUnderlay = String(index < layers.length - 1);
    });
    return layers;
  }

  top(kind?: OverlayKind | readonly OverlayKind[]): HTMLElement | undefined {
    return this.topLayer(kind)?.element;
  }

  dismiss(kind: OverlayKind | readonly OverlayKind[], reason = "back"): boolean {
    const layer = this.topLayer(kind);
    return layer ? this.dismissLayer(layer, reason) : false;
  }

  dismissTop(reason = "back"): boolean {
    const layer = this.topLayer();
    return layer ? this.dismissLayer(layer, reason) : false;
  }

  snapshot(): readonly Readonly<{ id: string; kind: OverlayKind; zIndex: number }>[] {
    return this.synchronize().map((layer) => ({
      id: layer.element.dataset.overlayId || layer.element.id || layer.element.classList[0] || "",
      kind: layer.kind,
      zIndex: layer.zIndex
    }));
  }

  openConfirmation(options: InteractionConfirmationOptions): HTMLElement {
    const previous = options.id ? this.document.querySelector<HTMLElement>(`[data-overlay-id="${CSS.escape(options.id)}"]`) : undefined;
    previous?.remove();
    const overlay = this.document.createElement("div");
    overlay.className = "interaction-confirmation";
    overlay.dataset.overlayId = options.id || `confirmation-${Date.now()}`;
    overlay.dataset.overlayKind = "dialog";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const panel = this.document.createElement("section");
    panel.className = "interaction-confirmation__panel";
    const heading = this.document.createElement("h2");
    heading.className = "interaction-confirmation__title";
    heading.textContent = options.title;
    const message = this.document.createElement("p");
    message.className = "interaction-confirmation__message";
    message.textContent = options.message;
    const actions = this.document.createElement("div");
    actions.className = "interaction-confirmation__actions";
    const cancel = this.document.createElement("button");
    cancel.type = "button";
    cancel.className = "interaction-confirmation__cancel";
    cancel.textContent = options.cancelLabel || "取消";
    const confirm = this.document.createElement("button");
    confirm.type = "button";
    confirm.className = `interaction-confirmation__confirm${options.danger ? " is-danger" : ""}`;
    confirm.textContent = options.confirmLabel || "确定";
    const close = (): void => { overlay.remove(); options.onCancel?.(); };
    cancel.addEventListener("click", close);
    confirm.addEventListener("click", () => options.onConfirm());
    overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    overlay.addEventListener("aromasense:request-overlay-dismiss", (event) => { event.preventDefault(); close(); });
    if (!options.hideCancel) actions.append(cancel);
    actions.append(confirm);
    panel.append(heading, message, actions);
    overlay.append(panel);
    this.document.body.append(overlay);
    this.manage(overlay, "dialog");
    return overlay;
  }

  private ensureScrim(): HTMLElement {
    let scrim = this.document.getElementById(this.scrimId);
    if (scrim) return scrim;
    scrim = this.document.createElement("div");
    scrim.id = this.scrimId;
    scrim.className = "app-interaction-scrim";
    scrim.hidden = true;
    scrim.setAttribute("aria-hidden", "true");
    this.document.body.append(scrim);
    return scrim;
  }

  private queueSynchronize(): void {
    if (this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => this.synchronize());
  }

  private watch(element: HTMLElement): void {
    if (this.watchers.has(element)) return;
    const parent = element.parentElement;
    if (!parent) return;
    const attributes = new MutationObserver(() => this.queueSynchronize());
    attributes.observe(element, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
    const removal = new MutationObserver(() => {
      if (element.isConnected) return;
      this.unwatch(element);
      this.queueSynchronize();
    });
    removal.observe(parent, { childList: true });
    this.watchers.set(element, [attributes, removal]);
  }

  private unwatch(element: HTMLElement): void {
    this.watchers.get(element)?.forEach((observer) => observer.disconnect());
    this.watchers.delete(element);
  }

  private visible(element: Element): element is HTMLElement {
    const HTMLElementClass = this.document.defaultView?.HTMLElement;
    if (!HTMLElementClass || !(element instanceof HTMLElementClass) || element.hidden || !element.isConnected) return false;
    const style = this.document.defaultView?.getComputedStyle(element);
    return Boolean(style && style.display !== "none" && style.visibility !== "hidden" && !(style.opacity === "0" && style.pointerEvents === "none"));
  }

  private kindFor(element: HTMLElement): OverlayKind {
    const declared = element.dataset.overlayKind as OverlayKind | undefined;
    if (declared && ["picker", "popover", "dialog", "modal"].includes(declared)) return declared;
    if (element.matches("[role='listbox']")) return "picker";
    if (element.matches("[popover],[data-popover]")) return "popover";
    if (element.matches(".batch-review,.seg-review,.yingxiang-overlay")) return "modal";
    return "dialog";
  }

  private zIndexFor(element: HTMLElement): number {
    const value = Number.parseInt(this.document.defaultView?.getComputedStyle(element).zIndex || "", 10);
    return Number.isFinite(value) ? value : 90;
  }

  private collect(): ManagedLayer[] {
    const seen = new Set<HTMLElement>();
    return [...this.document.querySelectorAll(LAYER_SELECTOR)].filter((element): element is HTMLElement => {
      if (element.id === this.scrimId || !this.visible(element) || seen.has(element)) return false;
      const parentLayer = element.parentElement?.closest(LAYER_SELECTOR);
      if (parentLayer) return false;
      seen.add(element);
      if (!element.dataset.overlaySequence) element.dataset.overlaySequence = String(++this.sequence);
      element.dataset.overlayManaged = "true";
      element.dataset.overlayKind = this.kindFor(element);
      if (!element.matches("[role='listbox']")) element.dataset.interactionBackdrop = "true";
      return true;
    }).map((element) => ({
      element,
      kind: element.dataset.overlayKind as OverlayKind,
      sequence: Number(element.dataset.overlaySequence) || 0,
      zIndex: this.zIndexFor(element)
    })).sort((left, right) => left.zIndex - right.zIndex || left.sequence - right.sequence);
  }

  private topLayer(kind?: OverlayKind | readonly OverlayKind[]): ManagedLayer | undefined {
    const allowed = kind ? new Set(Array.isArray(kind) ? kind : [kind]) : undefined;
    return this.synchronize().filter((layer) => !allowed || allowed.has(layer.kind)).at(-1);
  }

  private dismissControl(root: HTMLElement): HTMLElement | undefined {
    const controls = [...root.querySelectorAll<HTMLElement>("button,[role='button']")].filter((control) => this.visible(control) && !(control as HTMLButtonElement).disabled);
    return controls.find((control) => control.hasAttribute("data-overlay-dismiss"))
      || controls.find((control) => /(?:^|__)(?:close|cancel|back)$/.test(control.className) || control.getAttribute("aria-label") === "关闭")
      || controls.find((control) => /^(?:关闭|取消|返回|暂存退出|退出编辑)$/.test(control.textContent?.replace(/\s+/g, " ").trim() || ""));
  }

  private dismissLayer(layer: ManagedLayer, reason: string): boolean {
    const CustomEventClass = this.document.defaultView?.CustomEvent;
    if (CustomEventClass) {
      const request = new CustomEventClass("aromasense:request-overlay-dismiss", { cancelable: true, detail: { reason } });
      layer.element.dispatchEvent(request);
      if (request.defaultPrevented || !layer.element.isConnected) { this.queueSynchronize(); return true; }
    }
    const control = this.dismissControl(layer.element);
    if (control) control.click();
    else if (layer.kind === "picker" || layer.kind === "popover") layer.element.hidden = true;
    else if (!(layer.element.matches(".seg-review") && /识别中/.test(layer.element.textContent || ""))) layer.element.remove();
    this.document.dispatchEvent(new (this.document.defaultView?.CustomEvent || CustomEvent)("aromasense:overlay-dismissed", {
      detail: { id: layer.element.dataset.overlayId || layer.element.classList[0] || "", kind: layer.kind, reason }
    }));
    this.queueSynchronize();
    return true;
  }
}

export interface NavigationEntry {
  id: string;
  previous(): void | boolean;
  active?(): boolean;
  canGoBack?(): boolean;
}

function invokeEntry(entries: readonly NavigationEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.active && !entry.active()) continue;
    if (entry.canGoBack && !entry.canGoBack()) continue;
    return entry.previous() !== false;
  }
  return false;
}

export class FlowNavigation {
  private readonly entries: NavigationEntry[] = [];

  register(entry: NavigationEntry): () => void {
    this.entries.push(entry);
    return () => {
      const index = this.entries.indexOf(entry);
      if (index >= 0) this.entries.splice(index, 1);
    };
  }

  previous(): boolean { return invokeEntry(this.entries); }
  canGoBack(): boolean { return this.entries.some((entry) => (!entry.active || entry.active()) && (!entry.canGoBack || entry.canGoBack())); }
  snapshot(): Readonly<{ depth: number }> { return { depth: this.entries.length }; }
}

export interface TopLevelRootAdapter {
  current(): string;
  isAtRoot(): boolean;
  backToRoot(): void | boolean;
}

export class NavigationManager {
  private readonly children: NavigationEntry[] = [];
  private root?: TopLevelRootAdapter;

  setTopLevelRoot(adapter: TopLevelRootAdapter): void { this.root = adapter; }
  registerChild(entry: NavigationEntry): () => void {
    this.children.push(entry);
    return () => {
      const index = this.children.indexOf(entry);
      if (index >= 0) this.children.splice(index, 1);
    };
  }
  backFromChild(): boolean { return invokeEntry(this.children); }
  backToTopLevelRoot(): boolean {
    if (!this.root || this.root.isAtRoot()) return false;
    return this.root.backToRoot() !== false;
  }
  isAtAppRoot(): boolean { return this.root?.isAtRoot() ?? false; }
  snapshot(): Readonly<{ screen: string; childDepth: number; topLevelHistoryDepth: 0 }> {
    return { screen: this.root?.current() || "", childDepth: this.children.length, topLevelHistoryDepth: 0 };
  }
}

export interface RootExitGuardOptions {
  windowMs?: number;
  guardedSources?: readonly BackSource[];
  onHint(): void;
  onConfirm(): void;
}

export class RootExitGuard {
  private lastBackAt?: number;
  readonly windowMs: number;
  private readonly guardedSources: ReadonlySet<BackSource>;

  constructor(private readonly options: RootExitGuardOptions) {
    this.windowMs = options.windowMs ?? 2200;
    this.guardedSources = new Set(options.guardedSources ?? ["android", "native", "pwa", "programmatic"]);
  }

  request(source: BackSource, now = Date.now()): boolean {
    if (!this.guardedSources.has(source)) return false;
    if (this.lastBackAt !== undefined && now - this.lastBackAt <= this.windowMs) {
      this.lastBackAt = undefined;
      this.options.onConfirm();
      return true;
    }
    this.lastBackAt = now;
    this.options.onHint();
    return true;
  }

  reset(): void { this.lastBackAt = undefined; }
  snapshot(now = Date.now()): Readonly<{ armed: boolean; windowMs: number }> {
    return { armed: this.lastBackAt !== undefined && now - this.lastBackAt <= this.windowMs, windowMs: this.windowMs };
  }
}

function isEditable(element: Element | null, document: Document): element is HTMLElement {
  const HTMLElementClass = document.defaultView?.HTMLElement;
  if (!HTMLElementClass || !(element instanceof HTMLElementClass)) return false;
  if (element.isContentEditable || element.matches("textarea,select")) return true;
  if (!element.matches("input")) return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes((element as HTMLInputElement).type.toLowerCase());
}

export class BackGestureAdapter {
  constructor(
    private readonly document: Document,
    private readonly overlays: OverlayManager,
    private readonly flows: FlowNavigation,
    private readonly navigation: NavigationManager,
    private readonly rootExit: RootExitGuard
  ) {}

  handle({ source = "programmatic" as BackSource } = {}): boolean {
    let rootStep = false;
    const step = resolveBackStep({
      keyboard: () => this.dismissKeyboard(),
      picker: () => this.overlays.dismiss(["picker", "popover"]),
      dialog: () => this.overlays.dismiss("dialog"),
      modal: () => this.overlays.dismiss("modal"),
      workflow: () => this.flows.previous(),
      child: () => this.navigation.backFromChild(),
      topLevelRoot: () => this.navigation.backToTopLevelRoot(),
      appRoot: () => {
        if (!this.navigation.isAtAppRoot()) return false;
        rootStep = true;
        return this.rootExit.request(source);
      }
    });
    if (step && !rootStep) this.rootExit.reset();
    return step !== undefined;
  }

  handleAndroidBack(): boolean { return this.handle({ source: "android" }); }
  handlePwaBack(): boolean { return this.handle({ source: "pwa" }); }
  handleBrowserBack(): false { return false; }

  private dismissKeyboard(): boolean {
    const active = this.document.activeElement;
    if (!isEditable(active, this.document)) return false;
    active.blur();
    return true;
  }
}

export interface InteractionFoundation {
  overlays: OverlayManager;
  navigation: NavigationManager;
  flows: FlowNavigation;
  back: BackGestureAdapter;
  rootExit: RootExitGuard;
}

type InteractionGlobals = Window & {
  AromaSenseInteraction?: InteractionFoundation;
  AromaSenseOverlayManager?: OverlayManager;
  OverlayManager?: OverlayManager;
  NavigationManager?: NavigationManager;
  FlowNavigation?: FlowNavigation;
  BackGestureAdapter?: BackGestureAdapter;
  RootExitGuard?: RootExitGuard;
  AromaSenseBackGestureAdapter?: BackGestureAdapter;
  AromaSenseNative?: { exitApp?(): void };
};

export function installInteractionFoundation(document: Document = globalThis.document): InteractionFoundation {
  const globals = document.defaultView as InteractionGlobals;
  if (globals.AromaSenseInteraction) return globals.AromaSenseInteraction;
  const overlays = new OverlayManager(document);
  const navigation = new NavigationManager();
  const flows = new FlowNavigation();
  let hintTimer: number | undefined;
  const showHint = (): void => {
    let hint = document.getElementById("aromasenseBackHint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "aromasenseBackHint";
      hint.className = "interaction-back-hint";
      hint.setAttribute("role", "status");
      document.body.append(hint);
    }
    hint.textContent = "再次返回可选择退出";
    hint.classList.add("is-visible");
    if (hintTimer !== undefined) globals.clearTimeout(hintTimer);
    hintTimer = globals.setTimeout(() => hint?.classList.remove("is-visible"), 1800);
  };
  const requestExit = (): void => {
    document.querySelector<HTMLElement>("[data-overlay-id='root-exit-confirmation']")?.remove();
    overlays.synchronize();
    document.dispatchEvent(new CustomEvent("aromasense:explicit-exit-requested"));
    globals.AromaSenseNative?.exitApp?.();
  };
  const rootExit = new RootExitGuard({
    onHint: showHint,
    onConfirm: () => {
      overlays.openConfirmation({
        id: "root-exit-confirmation",
        title: "退出 AromaSense？",
        message: "已保存的数据会保留在本机。",
        confirmLabel: "退出",
        danger: true,
        onConfirm: requestExit
      });
    }
  });
  const back = new BackGestureAdapter(document, overlays, flows, navigation, rootExit);
  const foundation = { overlays, navigation, flows, back, rootExit };
  globals.AromaSenseInteraction = foundation;
  globals.AromaSenseOverlayManager = overlays;
  globals.OverlayManager = overlays;
  globals.NavigationManager = navigation;
  globals.FlowNavigation = flows;
  globals.BackGestureAdapter = back;
  globals.RootExitGuard = rootExit;
  globals.AromaSenseBackGestureAdapter = back;
  overlays.start();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && back.handle({ source: "keyboard" })) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("pointerdown", () => rootExit.reset(), true);
  return foundation;
}

export function manageInteractionLayer<T extends HTMLElement>(element: T, kind?: OverlayKind): T {
  installInteractionFoundation(element.ownerDocument).overlays.manage(element, kind);
  return element;
}

export function interactionConfirm(options: Omit<InteractionConfirmationOptions, "onConfirm" | "onCancel">): Promise<boolean> {
  const foundation = installInteractionFoundation();
  let layer: HTMLElement | undefined;
  return new Promise<boolean>((resolve) => {
    layer = foundation.overlays.openConfirmation({ ...options, onConfirm: () => resolve(true), onCancel: () => resolve(false) });
  }).finally(() => layer?.remove());
}

export async function interactionAlert(message: string, title = "提示"): Promise<void> {
  await interactionConfirm({ title, message, confirmLabel: "知道了", hideCancel: true });
}
