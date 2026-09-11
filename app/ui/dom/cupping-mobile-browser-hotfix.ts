import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const PATCH_FLAG = Symbol.for("aromasense.cupping.mobile-browser-hotfix.v1");
const STYLE_ID = "aromasense-cupping-mobile-browser-hotfix-v1";
const HORIZONTAL_THRESHOLD_PX = 42;
const VERTICAL_THRESHOLD_PX = 50;
const AXIS_DOMINANCE = 1.16;
const EDGE_GUARD_PX = 24;
const DUPLICATE_GUARD_MS = 420;

type SwipeDirection = "left" | "right" | "up" | "down" | undefined;

export function classifyMobileCuppingSwipe(dx: number, dy: number): SwipeDirection {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= HORIZONTAL_THRESHOLD_PX && ax > ay * AXIS_DOMINANCE) return dx < 0 ? "left" : "right";
  if (ay >= VERTICAL_THRESHOLD_PX && ay > ax * AXIS_DOMINANCE) return dy < 0 ? "up" : "down";
  return undefined;
}

interface TouchStartState {
  identifier: number;
  x: number;
  y: number;
  target: Element;
  editorAtTop: boolean;
  editorAtBottom: boolean;
}

interface HotfixRuntime {
  touch?: TouchStartState;
  lastNavigationAt: number;
  cleanup: Array<() => void>;
}

interface RendererInternals {
  root: HTMLElement;
}

interface RendererPrototype {
  [PATCH_FLAG]?: boolean;
  render(this: RendererInternals): Promise<void>;
  dispose?(this: RendererInternals): void;
}

const runtimeByRoot = new WeakMap<HTMLElement, HotfixRuntime>();

function runtime(root: HTMLElement): HotfixRuntime {
  let value = runtimeByRoot.get(root);
  if (!value) {
    value = { lastNavigationAt: 0, cleanup: [] };
    runtimeByRoot.set(root, value);
  }
  return value;
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .aromasense-cupping .cupping-layout__main{
      touch-action:pan-y pinch-zoom!important;
      overscroll-behavior-x:contain!important;
    }
    @media (max-width:640px){
      .aromasense-cupping .cupping-main__stage-strip{
        display:grid!important;
        grid-auto-flow:column!important;
        grid-auto-columns:minmax(0,1fr)!important;
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        gap:clamp(1px,.7vw,4px)!important;
        padding-inline:clamp(1px,.8vw,5px)!important;
        overflow-x:hidden!important;
        overscroll-behavior-x:contain!important;
      }
      .aromasense-cupping .cupping-stage-step{
        width:100%!important;
        min-width:0!important;
        max-width:none!important;
        min-height:clamp(54px,16vw,66px)!important;
        padding:clamp(3px,1vw,6px) clamp(1px,.65vw,4px)!important;
        gap:clamp(2px,.8vw,5px)!important;
        overflow:visible!important;
      }
      .aromasense-cupping .cupping-stage-step__label{
        max-width:100%!important;
        font-size:clamp(10px,3.25vw,15px)!important;
        line-height:1!important;
        letter-spacing:clamp(0px,.28vw,.06em)!important;
        white-space:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
      }
      .aromasense-cupping .cupping-stage-step__status-dot{
        width:clamp(6px,2vw,8px)!important;
        height:clamp(6px,2vw,8px)!important;
      }
    }
    @media (max-width:390px){
      .aromasense-cupping .cupping-main__stage-strip{gap:1px!important;padding-inline:0!important}
      .aromasense-cupping .cupping-stage-step{padding-inline:0!important}
      .aromasense-cupping .cupping-stage-step__label{font-size:clamp(9px,3vw,12px)!important;letter-spacing:0!important}
    }
  `;
  document.head.append(style);
}

function isEditableControl(target: Element): boolean {
  return Boolean(target.closest(
    "input,textarea,select,[contenteditable='true'],[data-drag-handle],.sensory-range__input,.selected-tag-stack__drag,.sample-rail__item"
  ));
}

function editorBoundary(root: HTMLElement): { top: boolean; bottom: boolean } {
  const editor = root.querySelector<HTMLElement>(".cupping-main__editor");
  if (!editor) return { top: true, bottom: true };
  return {
    top: editor.scrollTop <= 1,
    bottom: editor.scrollTop + editor.clientHeight >= editor.scrollHeight - 1
  };
}

function activeStageSteps(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(".cupping-main__stage-strip .cupping-stage-step")];
}

function clickAdjacentStage(root: HTMLElement, forward: boolean): boolean {
  const steps = activeStageSteps(root);
  const index = steps.findIndex((step) => step.classList.contains("is-current"));
  if (index < 0) return false;
  const target = steps[index + (forward ? 1 : -1)];
  if (!target || target.disabled) return false;
  target.click();
  return true;
}

function sampleItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(".cupping-layout__rail-list .sample-rail__item")];
}

function clickAdjacentSample(root: HTMLElement, forward: boolean): boolean {
  const items = sampleItems(root);
  const index = items.findIndex((item) => item.classList.contains("is-active"));
  if (index < 0) return false;
  const target = items[index + (forward ? 1 : -1)];
  if (!target) return false;
  const control = target.querySelector<HTMLButtonElement>(".sample-rail__select")
    ?? target.querySelector<HTMLButtonElement>("button");
  if (!control || control.disabled) return false;
  control.click();
  return true;
}

function navigate(root: HTMLElement, start: TouchStartState, endX: number, endY: number): void {
  const rt = runtime(root);
  const now = Date.now();
  if (now - rt.lastNavigationAt < DUPLICATE_GUARD_MS) return;
  const dx = endX - start.x;
  const dy = endY - start.y;
  const direction = classifyMobileCuppingSwipe(dx, dy);
  if (!direction || isEditableControl(start.target)) return;

  let changed = false;
  if (direction === "left" || direction === "right") {
    changed = clickAdjacentStage(root, direction === "left");
  } else {
    const insideEditor = Boolean(start.target.closest(".cupping-main__editor"));
    if (insideEditor) {
      if (direction === "up" && !start.editorAtBottom) return;
      if (direction === "down" && !start.editorAtTop) return;
    }
    changed = clickAdjacentSample(root, direction === "up");
  }
  if (changed) rt.lastNavigationAt = now;
}

function attachTouchFallback(root: HTMLElement): void {
  const rt = runtime(root);
  if (rt.cleanup.length) return;

  const touchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 1) {
      rt.touch = undefined;
      return;
    }
    const touch = event.touches[0];
    const target = event.target instanceof Element ? event.target : undefined;
    if (!target || !target.closest(".cupping-layout__main")) return;
    if (touch.clientX <= EDGE_GUARD_PX || touch.clientX >= window.innerWidth - EDGE_GUARD_PX) return;
    const bounds = editorBoundary(root);
    rt.touch = {
      identifier: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      target,
      editorAtTop: bounds.top,
      editorAtBottom: bounds.bottom
    };
  };

  const touchEnd = (event: TouchEvent): void => {
    const start = rt.touch;
    rt.touch = undefined;
    if (!start) return;
    const touch = [...event.changedTouches].find((item) => item.identifier === start.identifier);
    if (!touch) return;
    navigate(root, start, touch.clientX, touch.clientY);
  };

  const touchCancel = (): void => { rt.touch = undefined; };

  // Mobile browsers can emit PointerEvent first and then cancel it when native scrolling wins.
  // Block the older pointer-only cupping handler for touch/pen so the TouchEvent fallback is the single authority.
  const suppressLegacyPointer = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const target = event.target instanceof Element ? event.target : undefined;
    if (!target?.closest(".cupping-layout__main")) return;
    event.stopImmediatePropagation();
  };

  root.addEventListener("touchstart", touchStart, { capture: true, passive: true });
  root.addEventListener("touchend", touchEnd, { capture: true, passive: true });
  root.addEventListener("touchcancel", touchCancel, { capture: true, passive: true });
  root.addEventListener("pointerdown", suppressLegacyPointer, { capture: true, passive: true });
  root.addEventListener("pointerup", suppressLegacyPointer, { capture: true, passive: true });
  root.addEventListener("pointercancel", suppressLegacyPointer, { capture: true, passive: true });

  rt.cleanup.push(
    () => root.removeEventListener("touchstart", touchStart, true),
    () => root.removeEventListener("touchend", touchEnd, true),
    () => root.removeEventListener("touchcancel", touchCancel, true),
    () => root.removeEventListener("pointerdown", suppressLegacyPointer, true),
    () => root.removeEventListener("pointerup", suppressLegacyPointer, true),
    () => root.removeEventListener("pointercancel", suppressLegacyPointer, true)
  );
}

function installPatch(): void {
  installStyles();
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;

  const originalRender = prototype.render;
  prototype.render = async function(): Promise<void> {
    await originalRender.call(this);
    attachTouchFallback(this.root);
  };

  const originalDispose = prototype.dispose;
  if (typeof originalDispose === "function") {
    prototype.dispose = function(): void {
      const rt = runtimeByRoot.get(this.root);
      rt?.cleanup.splice(0).forEach((cleanup) => cleanup());
      runtimeByRoot.delete(this.root);
      originalDispose.call(this);
    };
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") installPatch();
