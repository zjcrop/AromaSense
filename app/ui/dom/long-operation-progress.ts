export const LONG_OPERATION_PROGRESS_DELAY_MS = 10_000;

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

export function shouldShowLongOperationProgress(
  busySinceMs: number | undefined,
  nowMs: number,
  delayMs = LONG_OPERATION_PROGRESS_DELAY_MS
): boolean {
  return busySinceMs !== undefined && nowMs - busySinceMs >= delayMs;
}

export function parseLongOperationStatus(text: string): ParsedLongOperationProgress | undefined {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const match = normalized.match(/(正在生成轻量预览|正在解析表格|正在解析|处理|识别|完成|导入)\s*(\d+)\s*\/\s*(\d+)/u);
  if (!match) return undefined;
  const current = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0 || current <= 0 || current > total) return undefined;
  const completed = match[1] === "完成" ? current : Math.max(0, current - 1);
  const percent = Math.max(0, Math.min(100, completed / total * 100));
  return {
    current,
    total,
    completed,
    percent,
    determinate: total > 1 && completed > 0
  };
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
    .aromasense-long-progress__fill{position:absolute;inset:0 auto 0 0;width:38%;border-radius:inherit;background:#d6ad63;will-change:transform,width}
    .aromasense-long-progress.is-indeterminate .aromasense-long-progress__fill{animation:aromasense-long-progress-slide 1.15s ease-in-out infinite}
    .aromasense-long-progress.is-determinate .aromasense-long-progress__fill{transition:width .24s ease;transform:none!important}
    .aromasense-long-progress__note{margin-top:7px;color:#8f8880;font-size:9px;line-height:1.35}
    @keyframes aromasense-long-progress-slide{0%{transform:translateX(-115%)}50%{transform:translateX(95%)}100%{transform:translateX(265%)}}
    @media(prefers-reduced-motion:reduce){.aromasense-long-progress.is-indeterminate .aromasense-long-progress__fill{animation:none;width:62%;opacity:.72}}
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
  private busySinceMs?: number;
  private revealTimer?: ReturnType<typeof setTimeout>;
  private updateTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly root: HTMLElement, options: LongOperationProgressOptions = {}) {
    this.delayMs = Math.max(0, options.delayMs ?? LONG_OPERATION_PROGRESS_DELAY_MS);
    this.updateIntervalMs = Math.max(100, options.updateIntervalMs ?? 250);
    installLongOperationProgressStyles();

    this.overlay = document.createElement("section");
    this.overlay.className = "aromasense-long-progress is-indeterminate";
    this.overlay.hidden = true;
    this.overlay.setAttribute("role", "status");
    this.overlay.setAttribute("aria-live", "polite");
    this.overlay.setAttribute("aria-label", "长时间操作进度");

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
    this.fillNode = document.createElement("div");
    this.fillNode.className = "aromasense-long-progress__fill";
    this.progressNode.append(this.fillNode);

    const note = document.createElement("div");
    note.className = "aromasense-long-progress__note";
    note.textContent = "已超过 10 秒，任务仍在执行；无需重复点击。";
    this.overlay.append(head, this.progressNode, note);
    document.body.append(this.overlay);

    this.observer = new MutationObserver(() => this.syncBusyState());
    this.observer.observe(this.root, {
      attributes: true,
      attributeFilter: ["aria-busy", "data-long-operation-label"]
    });
    this.syncBusyState();
  }

  dispose(): void {
    this.observer.disconnect();
    this.clearTimers();
    this.overlay.remove();
  }

  private syncBusyState(): void {
    const busy = this.root.hasAttribute("aria-busy");
    if (!busy) {
      this.reset();
      return;
    }
    if (this.busySinceMs !== undefined) {
      if (!this.overlay.hidden) this.renderProgress();
      return;
    }

    this.busySinceMs = Date.now();
    this.overlay.hidden = true;
    this.revealTimer = setTimeout(() => {
      if (!this.root.hasAttribute("aria-busy") || this.busySinceMs === undefined) return;
      this.overlay.hidden = false;
      this.renderProgress();
      this.updateTimer = setInterval(() => this.renderProgress(), this.updateIntervalMs);
    }, this.delayMs);
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
    this.overlay.classList.remove("is-determinate");
    this.overlay.classList.add("is-indeterminate");
    this.fillNode.style.width = "38%";
    this.progressNode.removeAttribute("aria-valuenow");
    this.progressNode.removeAttribute("aria-valuemax");
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
    const elapsedSeconds = Math.max(10, Math.floor((now - this.busySinceMs) / 1000));
    const parsed = parseLongOperationStatus(status);
    this.labelNode.textContent = status;
    this.elapsedNode.textContent = `已耗时 ${elapsedSeconds} 秒`;
    this.progressNode.setAttribute("aria-valuetext", `${status}；已耗时 ${elapsedSeconds} 秒`);

    if (parsed?.determinate) {
      this.overlay.classList.remove("is-indeterminate");
      this.overlay.classList.add("is-determinate");
      this.fillNode.style.width = `${parsed.percent.toFixed(2)}%`;
      this.progressNode.setAttribute("aria-valuemax", String(parsed.total));
      this.progressNode.setAttribute("aria-valuenow", String(parsed.completed));
    } else {
      this.overlay.classList.remove("is-determinate");
      this.overlay.classList.add("is-indeterminate");
      this.fillNode.style.width = "38%";
      this.progressNode.removeAttribute("aria-valuenow");
      this.progressNode.removeAttribute("aria-valuemax");
    }
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
