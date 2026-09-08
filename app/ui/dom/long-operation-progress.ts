export const LONG_OPERATION_PROGRESS_DELAY_MS = 0;

export interface ParsedLongOperationProgress {
  current: number;
  total: number;
  completed: number;
  percent: number;
  determinate: boolean;
}

export interface LongOperationProgressOptions {
  delayMs?: number;
  updateIntervalMs?: number;
}

const CONTROLLERS = new WeakMap<HTMLElement, LongOperationProgressController>();
const FOUNDATION_PROGRESS_EVENT = "coffee-foundation:ocr-progress";

export function shouldShowLongOperationProgress(
  busySinceMs: number | undefined,
  nowMs: number,
  delayMs = LONG_OPERATION_PROGRESS_DELAY_MS
): boolean {
  return busySinceMs !== undefined && nowMs - busySinceMs >= delayMs;
}

function stageFraction(stage: string): number {
  switch (stage) {
    case "正在生成轻量预览": return 0.08;
    case "正在解析表格":
    case "正在解析":
    case "处理": return 0.10;
    case "识别": return 0.18;
    case "导入": return 0.85;
    case "完成": return 1;
    default: return 0;
  }
}

export function parseLongOperationStatus(text: string): ParsedLongOperationProgress | undefined {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const match = normalized.match(/(正在生成轻量预览|正在解析表格|正在解析|处理|识别|完成|导入)\s*(\d+)\s*\/\s*(\d+)/u);
  if (!match) return undefined;
  const current = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0 || current <= 0 || current > total) return undefined;
  const completed = match[1] === "完成" ? current : Math.max(0, current - 1);
  const fraction = stageFraction(match[1]);
  const percent = Math.max(0, Math.min(100, ((current - 1) + fraction) / total * 100));
  return { current, total, completed, percent, determinate: true };
}

function installLongOperationProgressStyles(): void {
  if (document.head.querySelector("style[data-aromasense-long-operation-progress]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseLongOperationProgress = "true";
  style.textContent = `
    .aromasense-long-progress{
      position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));z-index:12000;
      width:min(520px,calc(100vw - 28px));box-sizing:border-box;transform:translateX(-50%);
      padding:12px 14px 11px;border:1px solid rgba(214,173,99,.34);border-radius:12px;
      background:rgba(21,21,21,.96);color:#f4f1eb;box-shadow:0 12px 34px rgba(0,0,0,.42);
      backdrop-filter:blur(8px);pointer-events:none;
    }
    .aromasense-long-progress[hidden]{display:none!important}
    .aromasense-long-progress__head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:8px}
    .aromasense-long-progress__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:720;letter-spacing:.02em}
    .aromasense-long-progress__elapsed{flex:0 0 auto;color:#9f978b;font-size:10px;font-variant-numeric:tabular-nums}
    .aromasense-long-progress__track{position:relative;height:5px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.09)}
    .aromasense-long-progress__fill{position:absolute;inset:0 auto 0 0;width:0;border-radius:inherit;background:#d6ad63;will-change:width;transition:width .28s ease;transform:none!important}
    .aromasense-long-progress__note{margin-top:7px;color:#8f8880;font-size:9px;line-height:1.35}
    @media(prefers-reduced-motion:reduce){.aromasense-long-progress__fill{transition:none}}
  `;
  document.head.append(style);
}

function rootFallbackLabel(root: HTMLElement): string {
  switch (root.dataset.screen) {
    case "setup": return "正在处理录入任务…";
    case "cupping": return "正在保存杯测数据…";
    case "records": return "正在处理杯测记录…";
    case "account": return "正在处理账户任务…";
    default: return "操作仍在进行…";
  }
}

export class LongOperationProgressController {
  private readonly delayMs: number;
  private readonly updateIntervalMs: number;
  private readonly overlay: HTMLElement;
  private readonly labelNode: HTMLElement;
  private readonly elapsedNode: HTMLElement;
  private readonly progressNode: HTMLElement;
  private readonly fillNode: HTMLElement;
  private readonly observer: MutationObserver;
  private readonly foundationProgressListener: EventListener;
  private busySinceMs?: number;
  private revealTimer?: ReturnType<typeof setTimeout>;
  private updateTimer?: ReturnType<typeof setInterval>;
  private latestPercent = 0;
  private foundationPercent?: number;
  private foundationStatus = "";

  constructor(private readonly root: HTMLElement, options: LongOperationProgressOptions = {}) {
    this.delayMs = Math.max(0, options.delayMs ?? LONG_OPERATION_PROGRESS_DELAY_MS);
    this.updateIntervalMs = Math.max(100, options.updateIntervalMs ?? 250);
    installLongOperationProgressStyles();

    this.overlay = document.createElement("section");
    this.overlay.className = "aromasense-long-progress is-determinate";
    this.overlay.hidden = true;
    this.overlay.setAttribute("role", "status");
    this.overlay.setAttribute("aria-live", "polite");
    this.overlay.setAttribute("aria-label", "任务进度");

    const head = document.createElement("div");
    head.className = "aromasense-long-progress__head";
    this.labelNode = document.createElement("span");
    this.labelNode.className = "aromasense-long-progress__label";
    this.elapsedNode = document.createElement("span");
    this.elapsedNode.className = "aromasense-long-progress__elapsed";
    head.append(this.labelNode, this.elapsedNode);

    this.progressNode = document.createElement("div");
    this.progressNode.className = "aromasense-long-progress__track";
    this.progressNode.setAttribute("role", "progressbar");
    this.progressNode.setAttribute("aria-valuemin", "0");
    this.progressNode.setAttribute("aria-valuemax", "100");
    this.fillNode = document.createElement("div");
    this.fillNode.className = "aromasense-long-progress__fill";
    this.progressNode.append(this.fillNode);

    const note = document.createElement("div");
    note.className = "aromasense-long-progress__note";
    note.textContent = "进度只向右推进；识别阶段优先使用 PP-OCRv5 实际运行进度。";
    this.overlay.append(head, this.progressNode, note);
    document.body.append(this.overlay);

    this.foundationProgressListener = ((event: Event) => this.onFoundationProgress(event)) as EventListener;
    globalThis.addEventListener(FOUNDATION_PROGRESS_EVENT, this.foundationProgressListener);

    this.observer = new MutationObserver(() => this.syncBusyState());
    this.observer.observe(this.root, {
      attributes: true,
      attributeFilter: ["aria-busy", "data-long-operation-label"],
      childList: true,
      subtree: true,
      characterData: true
    });
    this.syncBusyState();
  }

  dispose(): void {
    this.observer.disconnect();
    globalThis.removeEventListener(FOUNDATION_PROGRESS_EVENT, this.foundationProgressListener);
    this.clearTimers();
    this.overlay.remove();
  }

  private onFoundationProgress(event: Event): void {
    if (!this.root.hasAttribute("aria-busy")) return;
    const detail = (event as CustomEvent<{ progress?: number; status?: string }>).detail;
    const progress = Number(detail?.progress);
    if (!Number.isFinite(progress)) return;
    const bounded = Math.max(0, Math.min(100, progress));
    const parsed = parseLongOperationStatus(this.statusText());
    this.foundationPercent = parsed
      ? Math.max(0, Math.min(100, ((parsed.current - 1) + bounded / 100) / parsed.total * 100))
      : bounded;
    this.foundationStatus = String(detail?.status || "").trim();
    this.renderProgress();
  }

  private syncBusyState(): void {
    const busy = this.root.hasAttribute("aria-busy");
    if (!busy) {
      this.reset();
      return;
    }
    if (this.busySinceMs !== undefined) {
      this.renderProgress();
      return;
    }

    this.busySinceMs = Date.now();
    this.latestPercent = 0;
    this.foundationPercent = undefined;
    this.foundationStatus = "";

    const reveal = () => {
      if (!this.root.hasAttribute("aria-busy") || this.busySinceMs === undefined) return;
      this.overlay.hidden = false;
      this.renderProgress();
      if (!this.updateTimer) this.updateTimer = setInterval(() => this.renderProgress(), this.updateIntervalMs);
    };

    if (this.delayMs === 0) reveal();
    else this.revealTimer = setTimeout(reveal, this.delayMs);
  }

  private clearTimers(): void {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    if (this.updateTimer) clearInterval(this.updateTimer);
    this.revealTimer = undefined;
    this.updateTimer = undefined;
  }

  private reset(): void {
    this.clearTimers();
    this.busySinceMs = undefined;
    this.overlay.hidden = true;
    this.latestPercent = 0;
    this.foundationPercent = undefined;
    this.foundationStatus = "";
    this.fillNode.style.width = "0%";
    this.progressNode.setAttribute("aria-valuenow", "0");
    this.progressNode.removeAttribute("aria-valuetext");
  }

  private statusText(): string {
    const explicit = this.root.dataset.longOperationLabel?.trim();
    if (explicit) return explicit;
    const setupStatus = this.root.querySelector<HTMLElement>(".batch-setup__status:not([hidden])");
    const status = setupStatus?.textContent?.replace(/\s+/gu, " ").trim();
    return status || rootFallbackLabel(this.root);
  }

  private renderProgress(): void {
    if (this.busySinceMs === undefined || !this.root.hasAttribute("aria-busy")) return;
    const now = Date.now();
    if (!shouldShowLongOperationProgress(this.busySinceMs, now, this.delayMs)) return;

    const status = this.statusText();
    const elapsedSeconds = Math.max(0, Math.floor((now - this.busySinceMs) / 1000));
    const parsed = parseLongOperationStatus(status);
    const candidate = Math.max(1, parsed?.percent ?? 1, this.foundationPercent ?? 0);
    this.latestPercent = Math.max(this.latestPercent, Math.min(100, candidate));

    const detailLabel = this.foundationStatus && /识别/u.test(status)
      ? `${status} · ${this.foundationStatus}`
      : status;
    this.labelNode.textContent = detailLabel;
    this.elapsedNode.textContent = `已耗时 ${elapsedSeconds} 秒`;
    this.fillNode.style.width = `${this.latestPercent.toFixed(2)}%`;
    this.progressNode.setAttribute("aria-valuenow", this.latestPercent.toFixed(2));
    this.progressNode.setAttribute("aria-valuetext", `${detailLabel}；${Math.round(this.latestPercent)}%；已耗时 ${elapsedSeconds} 秒`);
  }
}

export function ensureLongOperationProgress(
  root: HTMLElement,
  options: LongOperationProgressOptions = {}
): LongOperationProgressController {
  const existing = CONTROLLERS.get(root);
  if (existing) return existing;
  const controller = new LongOperationProgressController(root, options);
  CONTROLLERS.set(root, controller);
  return controller;
}