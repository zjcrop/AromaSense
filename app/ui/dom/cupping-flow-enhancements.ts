import type { StageId } from "../../../shared/protocol/aromasense-v1";
import { hasMeaningfulValue } from "../../core/cupping-progress-policy";
import {
  competitionStarted,
  cuppingModeFromMetadata,
  isCompetitionCupping
} from "../../core/session-metadata";
import { sensoryFieldDefinition } from "../../core/sensory-dictionary-v1";
import type { SampleSummaryReader } from "../../storage/sample-summary-reader";
import type { CuppingScreenController, CuppingScreenState } from "../cupping-screen-controller";
import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const PATCH_FLAG = Symbol.for("aromasense.cupping.flow-enhancements.v1");
const PAGE_MEMORY_PREFIX = "aromasense.cupping.last-page.v1:";
const GESTURE_EDGE_PX = 28;
const HORIZONTAL_THRESHOLD_PX = 46;
const VERTICAL_THRESHOLD_PX = 54;
const AXIS_DOMINANCE = 1.2;
const MILESTONE_SECONDS = 30 * 60;

interface RendererInternals {
  root: HTMLElement;
  controller: CuppingScreenController;
  summaryReader: SampleSummaryReader;
  options: {
    now(): string;
    onExit?(sessionId: string): void | Promise<void>;
  };
  state?: CuppingScreenState;
  run(work: () => Promise<void>): Promise<void>;
  setBusy(busy: boolean): void;
  setStatus(text: string, error?: boolean): void;
}

interface RendererPrototype {
  [PATCH_FLAG]?: boolean;
  initialize(this: RendererInternals, sessionId: string): Promise<void>;
  render(this: RendererInternals): Promise<void>;
  leaveSession(this: RendererInternals): Promise<void>;
  finishFromEnd(this: RendererInternals): Promise<void>;
  dispose(this: RendererInternals): void;
}

interface PageMemory {
  version: 1;
  lastSampleId: string;
  samples: Record<string, { stageId: StageId; finalPhase?: string }>;
}

interface CellTarget {
  sampleId: string;
  stageId: StageId;
  finalPhase?: string;
}

interface PointerStart {
  pointerId: number;
  x: number;
  y: number;
  target: Element;
  editorAtTop: boolean;
  editorAtBottom: boolean;
}

interface WakeLockLike {
  released?: boolean;
  release(): Promise<void>;
}

interface RuntimeState {
  pointer?: PointerStart;
  cleanup: Array<() => void>;
  milestoneTimer?: number;
  lastMilestone?: number;
  toastTimer?: number;
  completionToastKey?: string;
  wakeLock?: WakeLockLike;
  audioPrimed: boolean;
}

const runtimeByRenderer = new WeakMap<object, RuntimeState>();

function runtime(host: RendererInternals): RuntimeState {
  let value = runtimeByRenderer.get(host as object);
  if (!value) {
    value = { cleanup: [], audioPrimed: false };
    runtimeByRenderer.set(host as object, value);
  }
  return value;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cupping-flow-enhancements]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCuppingFlowEnhancements = "true";
  style.textContent = `
    .cupping-main__stage-strip{align-items:stretch!important;gap:5px!important;overflow-x:auto!important;scrollbar-width:none!important}
    .cupping-main__stage-strip::-webkit-scrollbar{display:none!important}
    .cupping-stage-step{position:relative!important;min-width:48px!important;min-height:62px!important;padding:6px 7px!important;display:grid!important;grid-template-rows:minmax(0,1fr) auto!important;place-items:center!important;gap:5px!important}
    .cupping-stage-step__label{writing-mode:vertical-rl!important;text-orientation:upright!important;font-size:16px!important;font-weight:800!important;line-height:1.05!important;letter-spacing:.08em!important}
    .cupping-stage-step.is-current::after{content:"";position:absolute;left:7px;right:7px;bottom:1px;height:2px;border-radius:99px;background:#d6ad63}
    .cupping-stage-step__status-dot{width:8px!important;height:8px!important;border-radius:50%!important;transform-origin:center!important}
    .sample-rail__stage-token{position:relative}
    .cupping-missing-mark{position:absolute;right:-7px;top:-8px;display:grid;place-items:center;width:17px;height:17px;border-radius:50%;background:#d6a62d;color:#151515;font-size:12px;font-weight:900;line-height:1;cursor:pointer;z-index:9}
    .cupping-missing-mark:focus-visible{outline:2px solid #fff;outline-offset:1px}
    .cupping-load-previous{position:sticky;top:0;z-index:12;display:block;margin:0 0 10px auto;min-height:38px;padding:7px 12px;border:1px solid rgba(214,173,99,.34);border-radius:8px;background:rgba(20,20,20,.94);color:#d6ad63;font:inherit;font-size:11px;font-weight:760;backdrop-filter:blur(4px)}
    .cupping-flow-toast{position:absolute;z-index:100;left:50%;top:16%;transform:translateX(-50%);max-width:min(86%,520px);padding:8px 13px;border:1px solid rgba(214,173,99,.32);border-radius:999px;background:rgba(18,18,18,.94);color:#f4f1eb;font-size:12px;font-weight:750;text-align:center;pointer-events:none}
    .cupping-grid-shift-x-forward{animation:as-grid-x-forward 180ms cubic-bezier(.2,.7,.2,1)}
    .cupping-grid-shift-x-back{animation:as-grid-x-back 180ms cubic-bezier(.2,.7,.2,1)}
    .cupping-grid-shift-y-forward{animation:as-grid-y-forward 180ms cubic-bezier(.2,.7,.2,1)}
    .cupping-grid-shift-y-back{animation:as-grid-y-back 180ms cubic-bezier(.2,.7,.2,1)}
    @keyframes as-grid-x-forward{0%{opacity:.72;transform:translateX(13px)}100%{opacity:1;transform:none}}
    @keyframes as-grid-x-back{0%{opacity:.72;transform:translateX(-13px)}100%{opacity:1;transform:none}}
    @keyframes as-grid-y-forward{0%{opacity:.72;transform:translateY(13px)}100%{opacity:1;transform:none}}
    @keyframes as-grid-y-back{0%{opacity:.72;transform:translateY(-13px)}100%{opacity:1;transform:none}}
    .cupping-stage-step__status-dot.is-completion-flash,
    .sample-rail__state-dot.is-completion-flash,
    .sample-rail__stage-line.is-completion-flash{animation:as-completion-double-flash 300ms linear!important;transform-origin:center!important}
    @keyframes as-completion-double-flash{
      0%{transform:scale(1);filter:none}
      16.67%{transform:scale(1.5);filter:brightness(1.7)}
      33.33%{transform:scale(1.05);filter:brightness(1.18)}
      50%{transform:scale(1.5);background:#dff4e6;filter:brightness(1.35)}
      66.67%{transform:scale(1.05);background:#a9dbb8;filter:none}
      100%{transform:scale(1);background:var(--as-progress-completed,#62a675);filter:none}
    }
    .cupping-rail-timer.is-milestone{animation:as-timer-milestone 1s ease-in-out!important}
    @keyframes as-timer-milestone{0%,100%{filter:none}25%,70%{filter:brightness(1.7)}50%{filter:brightness(1.2)}}
    .cupping-rail-timer.is-milestone .cupping-rail-timer__value,
    .cupping-rail-timer.is-milestone .cupping-rail-timer__compact-number{font-weight:900!important;color:#fff!important}
    .competition-preflight{display:grid;gap:14px;padding:18px 4px 24px}
    .competition-preflight__title{margin:0;text-align:center;font-size:22px}
    .competition-preflight__count{margin:0;text-align:center;color:#d6ad63;font-size:17px;font-weight:800}
    .competition-preflight__samples{display:grid;gap:5px;max-height:34vh;overflow:auto;padding:8px 0;border-top:1px solid rgba(255,255,255,.07);border-bottom:1px solid rgba(255,255,255,.07)}
    .competition-preflight__sample{display:grid;grid-template-columns:42px minmax(0,1fr);gap:10px;align-items:center;padding:6px 4px;color:#d7d2ca;font-size:12px}
    .competition-preflight__number{color:#d6ad63;font-weight:850;font-variant-numeric:tabular-nums}
    .competition-preflight__notice{margin:0;color:#9f988e;font-size:11px;line-height:1.65}
    .competition-preflight__start{min-height:54px;border:1px solid #b9995a;border-radius:10px;background:#b9995a;color:#111;font:inherit;font-size:18px;font-weight:900;letter-spacing:.08em}
    .aromasense-cupping.is-competition-preflight .sample-rail__select{pointer-events:none;opacity:.68}
    .aromasense-cupping.is-competition-preflight .cupping-main__stage-strip{display:none!important}
    .aromasense-cupping.is-competition-preflight .cupping-rail-timer{visibility:hidden}
    .sensory-field__required{margin-left:.28em;color:#d6ad63;font-weight:900}
    .sensory-note-composer{position:relative;display:grid;gap:6px;margin-top:4px}
    .sensory-note-composer__add{justify-self:end;width:42px;height:42px;border:1px solid rgba(214,173,99,.38);border-radius:50%;background:#1b1b1b;color:#d6ad63;font-weight:850}
    .sensory-note-composer__list{display:grid;gap:4px}
    .sensory-note-composer__row{min-height:30px;border:0;border-bottom:1px solid rgba(255,255,255,.06);background:transparent;color:#aaa39a;text-align:left;font:inherit;font-size:11px}
    .sensory-note-composer__editor{width:100%;box-sizing:border-box;min-height:82px;padding:8px;border:1px solid rgba(214,173,99,.28);border-radius:8px;background:#171717;color:#f4f1eb;font:inherit}
    .selected-tag-stack__limit{margin:2px 0 6px;color:#8f8880;font-size:10px}
    @media(prefers-reduced-motion:reduce){.cupping-grid-shift-x-forward,.cupping-grid-shift-x-back,.cupping-grid-shift-y-forward,.cupping-grid-shift-y-back,.cupping-stage-step__status-dot.is-completion-flash,.sample-rail__state-dot.is-completion-flash,.sample-rail__stage-line.is-completion-flash,.cupping-rail-timer.is-milestone{animation:none!important}}
  `;
  document.head.append(style);
}

function currentFinalPhase(state: CuppingScreenState): string | undefined {
  const active = state.active;
  if (active?.context.stageId !== "final") return undefined;
  const raw = active.slice.observations.find((item) => item.fieldKey === "final_phase")?.value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "flavor";
}

function stageTargets(state: CuppingScreenState, sampleId: string): CellTarget[] {
  const sample = state.rail.find((item) => item.sampleId === sampleId);
  if (!sample) return [];
  return sample.stages.flatMap((stage): CellTarget[] => {
    if (stage.stageId === "final" && stage.finalPhases?.length) {
      return stage.finalPhases.map((phase) => ({ sampleId, stageId: "final", finalPhase: phase.phase }));
    }
    return [{ sampleId, stageId: stage.stageId }];
  });
}

function currentTarget(state: CuppingScreenState): CellTarget | undefined {
  const active = state.active;
  if (!active) return undefined;
  const finalPhase = currentFinalPhase(state);
  return {
    sampleId: active.context.sampleId,
    stageId: active.context.stageId,
    ...(finalPhase ? { finalPhase } : {})
  };
}

function sameCell(a: CellTarget, b: CellTarget): boolean {
  return a.sampleId === b.sampleId && a.stageId === b.stageId && (a.finalPhase ?? "") === (b.finalPhase ?? "");
}

function readPageMemory(sessionId: string): PageMemory | undefined {
  try {
    const raw = window.localStorage.getItem(`${PAGE_MEMORY_PREFIX}${sessionId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<PageMemory>;
    return parsed.version === 1 && typeof parsed.lastSampleId === "string" && parsed.samples && typeof parsed.samples === "object"
      ? parsed as PageMemory
      : undefined;
  } catch { return undefined; }
}

function rememberTarget(state: CuppingScreenState, target: CellTarget): void {
  try {
    const previous = readPageMemory(state.sessionId);
    const memory: PageMemory = {
      version: 1,
      lastSampleId: target.sampleId,
      samples: {
        ...(previous?.samples ?? {}),
        [target.sampleId]: {
          stageId: target.stageId,
          ...(target.finalPhase ? { finalPhase: target.finalPhase } : {})
        }
      }
    };
    window.localStorage.setItem(`${PAGE_MEMORY_PREFIX}${state.sessionId}`, JSON.stringify(memory));
  } catch { /* navigation memory must never block cupping */ }
}

async function navigateExact(host: RendererInternals, target: CellTarget, animationClass?: string): Promise<void> {
  const state = host.state;
  if (!state || state.sessionStatus === "completed" || state.sessionStatus === "archived") return;
  await host.run(async () => {
    let next = await host.controller.select(target.sampleId, target.stageId, host.options.now());
    if (target.stageId === "final" && target.finalPhase && currentFinalPhase(next) !== target.finalPhase) {
      next = await host.controller.saveField("final_phase", target.finalPhase, host.options.now());
    }
    host.state = next;
    rememberTarget(next, target);
  });
  if (animationClass) animateMain(host.root, animationClass);
}

function animateMain(root: HTMLElement, className: string): void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const node = root.querySelector<HTMLElement>(".cupping-layout__main");
  if (!node) return;
  node.classList.remove("cupping-grid-shift-x-forward", "cupping-grid-shift-x-back", "cupping-grid-shift-y-forward", "cupping-grid-shift-y-back");
  void node.offsetWidth;
  node.classList.add(className);
  window.setTimeout(() => node.classList.remove(className), 220);
}

function isEditableControl(target: Element): boolean {
  return Boolean(target.closest("input,textarea,select,[contenteditable='true'],[data-drag-handle],.sensory-range__input"));
}

function editorBoundary(root: HTMLElement): { top: boolean; bottom: boolean } {
  const editor = root.querySelector<HTMLElement>(".cupping-main__editor");
  if (!editor) return { top: true, bottom: true };
  return {
    top: editor.scrollTop <= 1,
    bottom: editor.scrollTop + editor.clientHeight >= editor.scrollHeight - 1
  };
}

function attachGridGestures(host: RendererInternals): void {
  const rt = runtime(host);
  if (rt.cleanup.length) return;
  const root = host.root;
  const pointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : undefined;
    if (!target || !target.closest(".cupping-layout__main")) return;
    if (event.clientX <= GESTURE_EDGE_PX || event.clientX >= window.innerWidth - GESTURE_EDGE_PX) return;
    const bounds = editorBoundary(root);
    rt.pointer = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target,
      editorAtTop: bounds.top,
      editorAtBottom: bounds.bottom
    };
  };
  const pointerUp = (event: PointerEvent): void => {
    const start = rt.pointer;
    rt.pointer = undefined;
    if (!start || start.pointerId !== event.pointerId) return;
    const state = host.state;
    const active = state?.active;
    if (!state || !active || state.sessionStatus === "completed" || state.sessionStatus === "archived") return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < HORIZONTAL_THRESHOLD_PX && ay < VERTICAL_THRESHOLD_PX) return;

    if (ax >= HORIZONTAL_THRESHOLD_PX && ax > ay * AXIS_DOMINANCE) {
      if (isEditableControl(start.target)) return;
      const targets = stageTargets(state, active.context.sampleId);
      const current = currentTarget(state);
      if (!current) return;
      const index = targets.findIndex((target) => sameCell(target, current));
      const targetIndex = dx < 0 ? index + 1 : index - 1;
      const target = targets[targetIndex];
      if (!target) return;
      void navigateExact(host, target, dx < 0 ? "cupping-grid-shift-x-forward" : "cupping-grid-shift-x-back");
      return;
    }

    if (ay >= VERTICAL_THRESHOLD_PX && ay > ax * AXIS_DOMINANCE) {
      if (isEditableControl(start.target)) return;
      const insideEditor = Boolean(start.target.closest(".cupping-main__editor"));
      if (insideEditor && ((dy < 0 && !start.editorAtBottom) || (dy > 0 && !start.editorAtTop))) return;
      const sampleIndex = state.samples.findIndex((sample) => sample.sampleId === active.context.sampleId);
      const nextIndex = dy < 0 ? sampleIndex + 1 : sampleIndex - 1;
      const sample = state.samples[nextIndex];
      if (!sample) return;
      const targetRail = state.rail.find((item) => item.sampleId === sample.sampleId);
      if (!targetRail?.stages.some((stage) => stage.stageId === active.context.stageId)) return;
      const phase = currentFinalPhase(state);
      void navigateExact(host, {
        sampleId: sample.sampleId,
        stageId: active.context.stageId,
        ...(phase ? { finalPhase: phase } : {})
      }, dy < 0 ? "cupping-grid-shift-y-forward" : "cupping-grid-shift-y-back");
    }
  };
  const pointerCancel = (): void => { rt.pointer = undefined; };
  root.addEventListener("pointerdown", pointerDown, { passive: true });
  root.addEventListener("pointerup", pointerUp, { passive: true });
  root.addEventListener("pointercancel", pointerCancel, { passive: true });
  rt.cleanup.push(
    () => root.removeEventListener("pointerdown", pointerDown),
    () => root.removeEventListener("pointerup", pointerUp),
    () => root.removeEventListener("pointercancel", pointerCancel)
  );
}

function showToast(host: RendererInternals, text: string, duration: number): void {
  const rt = runtime(host);
  host.root.querySelector(".cupping-flow-toast")?.remove();
  if (rt.toastTimer !== undefined) window.clearTimeout(rt.toastTimer);
  const main = host.root.querySelector<HTMLElement>(".cupping-layout__main") ?? host.root;
  const toast = document.createElement("div");
  toast.className = "cupping-flow-toast";
  toast.textContent = text;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  main.append(toast);
  rt.toastTimer = window.setTimeout(() => toast.remove(), duration);
}

function completionToast(host: RendererInternals): void {
  const flash = host.root.querySelector(".cupping-stage-step__status-dot.is-completion-flash,.sample-rail__state-dot.is-completion-flash");
  const state = host.state;
  const active = state?.active;
  if (!flash || !state || !active) return;
  const stage = state.rail.find((item) => item.sampleId === active.context.sampleId)?.stages.find((item) => item.stageId === active.context.stageId);
  const key = `${active.context.sampleId}:${active.context.stageId}:${stage?.status ?? ""}`;
  const rt = runtime(host);
  if (rt.completionToastKey === key) return;
  rt.completionToastKey = key;
  showToast(host, `${String(active.slice.sample.displayNumber).padStart(2, "0")}号 · ${stage?.label ?? active.context.stageId} 已完成`, 3000);
}

function addProgressWarnings(host: RendererInternals): void {
  const state = host.state;
  if (!state) return;
  let total = 0, complete = 0;
  for (const sample of state.rail) for (const stage of sample.stages) {
    total += 1;
    if (stage.status === "completed") complete += 1;
  }
  if (!total || complete / total < .8) return;
  for (const sample of state.rail) {
    const card = host.root.querySelector<HTMLElement>(`.sample-rail__item[data-sample-id="${CSS.escape(sample.sampleId)}"]`);
    const tokens = [...(card?.querySelectorAll<HTMLElement>(".sample-rail__stage-token") ?? [])];
    sample.stages.forEach((stage, index) => {
      if (stage.status === "completed") return;
      const token = tokens[index];
      if (!token || token.querySelector(".cupping-missing-mark")) return;
      const mark = document.createElement("span");
      mark.className = "cupping-missing-mark";
      mark.textContent = "!";
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", `${String(sample.displayNumber).padStart(2, "0")}号 ${stage.label} 未完成，点击直达`);
      const jump = (event: Event): void => {
        event.preventDefault(); event.stopPropagation();
        void navigateExact(host, { sampleId: sample.sampleId, stageId: stage.stageId });
      };
      mark.addEventListener("click", jump);
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") jump(event);
      });
      token.append(mark);
    });
  }
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function addLoadPreviousButton(host: RendererInternals): void {
  const state = host.state;
  const active = state?.active;
  if (!state || !active || !["mid_temp", "low_temp"].includes(active.context.stageId)) return;
  const editor = host.root.querySelector<HTMLElement>(".cupping-main__editor");
  if (!editor || editor.querySelector(".cupping-load-previous")) return;
  const previousStage: StageId = active.context.stageId === "mid_temp" ? "high_temp" : "mid_temp";
  const previousLabel = previousStage === "high_temp" ? "高温" : "中温";
  const control = document.createElement("button");
  control.type = "button";
  control.className = "cupping-load-previous";
  control.textContent = `载入${previousLabel}标签`;
  control.title = `载入同一只样品${previousLabel}节点的标签、强度及兼容感官属性，作为当前节点的编辑基础`;
  control.addEventListener("click", () => void host.run(async () => {
    const observations = await host.summaryReader.listObservations(active.context.sampleId);
    const transferable = observations.filter((item) => {
      if (item.stageId !== previousStage || item.fieldKey === "notes" || !hasMeaningfulValue(item.value)) return false;
      const definition = sensoryFieldDefinition(item.fieldKey);
      return Boolean(definition?.stages.includes(active.context.stageId));
    });
    let next = host.state;
    for (const item of transferable) next = await host.controller.saveField(item.fieldKey, cloneValue(item.value), host.options.now());
    if (next) host.state = next;
  }));
  editor.prepend(control);
}

function removeScoreConfirmations(host: RendererInternals): void {
  for (const node of host.root.querySelectorAll(".final-assessment__score-confirm,.final-assessment__score-lock-note")) node.remove();
}

function renderCompetitionPreflight(host: RendererInternals): void {
  const state = host.state;
  if (!state) return;
  const mode = cuppingModeFromMetadata(state.sessionMetadata);
  const preflight = isCompetitionCupping(mode) && !competitionStarted(state.sessionMetadata) && state.sessionStatus !== "completed" && state.sessionStatus !== "archived";
  host.root.classList.toggle("is-competition-preflight", preflight);
  if (!preflight) return;
  const editor = host.root.querySelector<HTMLElement>(".cupping-main__editor");
  if (!editor || editor.querySelector(".competition-preflight")) return;
  editor.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "competition-preflight";
  const title = document.createElement("h2"); title.className = "competition-preflight__title"; title.textContent = "比赛准备";
  const count = document.createElement("p"); count.className = "competition-preflight__count"; count.textContent = `本场比赛共 ${state.samples.length} 只咖啡`;
  const samples = document.createElement("div"); samples.className = "competition-preflight__samples";
  for (const item of state.rail) {
    const row = document.createElement("div"); row.className = "competition-preflight__sample";
    const number = document.createElement("strong"); number.className = "competition-preflight__number"; number.textContent = String(item.displayNumber).padStart(2, "0");
    const label = document.createElement("span"); label.textContent = item.label?.trim() || `样品 ${String(item.displayNumber).padStart(2, "0")}`;
    row.append(number, label); samples.append(row);
  }
  const notice = document.createElement("p");
  notice.className = "competition-preflight__notice";
  notice.textContent = "开始前请核对样品数量与顺序。点击开始后，样品列表与顺序将锁定并同时开始计时；比赛过程中计时不会因电话、切后台或重新进入 App 而暂停；最终点击“完成”后才会全盘锁定并提交。";
  const start = document.createElement("button");
  start.type = "button"; start.className = "competition-preflight__start"; start.textContent = "开始比赛";
  start.addEventListener("click", () => {
    start.disabled = true;
    primeAudio(host);
    void host.run(async () => {
      let next = await host.controller.startCompetition(host.options.now());
      host.state = next;
      const first = next.samples[0];
      const firstStage = first ? next.rail.find((item) => item.sampleId === first.sampleId)?.stages[0] : undefined;
      if (first && firstStage) {
        next = await host.controller.select(first.sampleId, firstStage.stageId, host.options.now());
        host.state = next;
        rememberTarget(next, { sampleId: first.sampleId, stageId: firstStage.stageId });
      }
    });
  });
  panel.append(title, count, samples, notice, start);
  editor.append(panel);
}

function elapsedSeconds(host: RendererInternals): number {
  const state = host.state;
  const start = state?.sessionMetadata.competitionStartedAt ?? state?.sessionStartedAt;
  if (!start) return 0;
  const startMs = Date.parse(start);
  const nowMs = Date.parse(host.options.now());
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

function ding(): void {
  try {
    const AudioCtor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.13, context.currentTime + .01);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .16);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .17);
    oscillator.addEventListener("ended", () => void context.close());
  } catch { /* audio cue is best effort and never blocks cupping */ }
}

function primeAudio(host: RendererInternals): void {
  const rt = runtime(host);
  if (rt.audioPrimed) return;
  rt.audioPrimed = true;
  // User activation at competition start is enough to prime browser audio. A
  // near-silent oscillator avoids a surprise sound before the first 30-min cue.
  try {
    const AudioCtor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = .00001;
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .01);
    oscillator.addEventListener("ended", () => void context.close());
  } catch { /* best effort */ }
}

function syncTimerMilestones(host: RendererInternals): void {
  const rt = runtime(host);
  const state = host.state;
  const mode = state ? cuppingModeFromMetadata(state.sessionMetadata) : undefined;
  const running = Boolean(state && mode && isCompetitionCupping(mode) && competitionStarted(state.sessionMetadata) && state.sessionStatus !== "completed" && state.sessionStatus !== "archived");
  if (!running) {
    if (rt.milestoneTimer !== undefined) window.clearInterval(rt.milestoneTimer);
    rt.milestoneTimer = undefined; rt.lastMilestone = undefined;
    void releaseWakeLock(host);
    return;
  }
  if (rt.lastMilestone === undefined) rt.lastMilestone = Math.floor(elapsedSeconds(host) / MILESTONE_SECONDS);
  if (rt.milestoneTimer === undefined) {
    rt.milestoneTimer = window.setInterval(() => {
      const current = Math.floor(elapsedSeconds(host) / MILESTONE_SECONDS);
      if (current <= (rt.lastMilestone ?? 0)) return;
      rt.lastMilestone = current;
      const timer = host.root.querySelector<HTMLElement>("[data-cupping-timer]");
      timer?.classList.add("is-milestone");
      window.setTimeout(() => timer?.classList.remove("is-milestone"), 1050);
      ding();
    }, 1000);
  }
  void requestWakeLock(host);
}

async function requestWakeLock(host: RendererInternals): Promise<void> {
  const rt = runtime(host);
  if (rt.wakeLock && !rt.wakeLock.released) return;
  if (document.visibilityState === "hidden") return;
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } };
  try { if (nav.wakeLock) rt.wakeLock = await nav.wakeLock.request("screen"); }
  catch { /* native/browser support varies; do not interrupt cupping */ }
}

async function releaseWakeLock(host: RendererInternals): Promise<void> {
  const rt = runtime(host);
  const lock = rt.wakeLock;
  rt.wakeLock = undefined;
  try { await lock?.release(); } catch { /* best effort */ }
}

function attachWakeLockLifecycle(host: RendererInternals): void {
  const rt = runtime(host);
  const visibility = (): void => {
    if (document.visibilityState === "visible") syncTimerMilestones(host);
  };
  document.addEventListener("visibilitychange", visibility);
  rt.cleanup.push(() => document.removeEventListener("visibilitychange", visibility));
}

function enhanceRenderedPage(host: RendererInternals): void {
  installStyles();
  const state = host.state;
  if (!state) return;
  host.root.dataset.cuppingMode = String(cuppingModeFromMetadata(state.sessionMetadata));
  removeScoreConfirmations(host);
  renderCompetitionPreflight(host);
  if (!host.root.classList.contains("is-competition-preflight")) {
    addLoadPreviousButton(host);
    addProgressWarnings(host);
    completionToast(host);
  }
  syncTimerMilestones(host);
}

function cleanupRuntime(host: RendererInternals): void {
  const rt = runtimeByRenderer.get(host as object);
  if (!rt) return;
  rt.cleanup.splice(0).forEach((dispose) => dispose());
  if (rt.milestoneTimer !== undefined) window.clearInterval(rt.milestoneTimer);
  if (rt.toastTimer !== undefined) window.clearTimeout(rt.toastTimer);
  host.root.querySelector(".cupping-flow-toast")?.remove();
  void releaseWakeLock(host);
  runtimeByRenderer.delete(host as object);
}

function installPatch(): void {
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;
  const originalInitialize = prototype.initialize;
  const originalRender = prototype.render;
  const originalLeaveSession = prototype.leaveSession;
  const originalFinishFromEnd = prototype.finishFromEnd;
  const originalDispose = prototype.dispose;

  prototype.initialize = async function(sessionId: string): Promise<void> {
    await originalInitialize.call(this, sessionId);
    attachGridGestures(this);
    attachWakeLockLifecycle(this);
    enhanceRenderedPage(this);
  };

  prototype.render = async function(): Promise<void> {
    await originalRender.call(this);
    enhanceRenderedPage(this);
  };

  prototype.leaveSession = async function(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    if (isCompetitionCupping(mode) && competitionStarted(state.sessionMetadata) && state.sessionStatus !== "completed" && state.sessionStatus !== "archived") {
      showToast(this, "比赛进行中，不可退出", 500);
      return;
    }
    if (isCompetitionCupping(mode) && !competitionStarted(state.sessionMetadata)) {
      await originalLeaveSession.call(this);
      return;
    }
    if (!window.confirm("暂停本次杯测？当前记录已自动保存，下次进入将从当前位置继续。")) return;
    this.setBusy(true);
    try {
      await this.controller.leaveSession();
      await this.options.onExit?.(state.sessionId);
    } catch (error) {
      this.setStatus(`暂停前保存失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally { this.setBusy(false); }
  };

  prototype.finishFromEnd = async function(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const mode = cuppingModeFromMetadata(state.sessionMetadata);
    if (isCompetitionCupping(mode)) {
      const summary = this.controller.competitionCompletionSummary();
      const missing = summary.missing.length;
      const message = missing
        ? `未完成项还有 ${missing} 个，将按本场比赛规则处理并可能扣除相应分值。完成后所有评分与样品记录将锁定，无法再次编辑，并自动提交给组织方。是否锁定并完成？`
        : "所有流程已经完成。完成后所有评分与样品记录将锁定，无法再次编辑，并自动提交给组织方。是否锁定并完成？";
      if (!window.confirm(message)) return;
    }
    await originalFinishFromEnd.call(this);
  };

  prototype.dispose = function(): void {
    cleanupRuntime(this);
    originalDispose.call(this);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") installPatch();
