import type { StageId } from "../../../shared/protocol/aromasense-v1";
import type { SampleRailItemViewState } from "../cupping-view-model";
import { button, element } from "./dom-helpers";

export interface SampleRailCallbacks {
  select(sampleId: string, stageId: StageId): void | Promise<void>;
  toggleExpanded(sampleId: string): void | Promise<void>;
}

export interface SampleRailRenderOptions {
  compact?: boolean;
  expandedSampleIds?: ReadonlySet<string>;
}

interface RailGeometry {
  card: DOMRect;
  number: DOMRect;
  numberColor: string;
}

interface IndicatorState {
  indicator: HTMLElement;
  scrollContainer?: HTMLElement;
  scrollHandler?: () => void;
}

const indicatorStates = new WeakMap<HTMLElement, IndicatorState>();
const ACTIVATION_EASING = "cubic-bezier(.45,0,.55,1)";

function preferredStage(item: SampleRailItemViewState): StageId {
  return item.stages.find((stage) => stage.status === "active")?.stageId
    ?? item.stages.find((stage) => stage.status === "not_started")?.stageId
    ?? item.stages[item.stages.length - 1]?.stageId
    ?? "preparation";
}

function currentStage(item: SampleRailItemViewState) {
  return item.stages.find((stage) => stage.status === "active")
    ?? item.stages.find((stage) => stage.status === "not_started")
    ?? [...item.stages].reverse().find((stage) => stage.status === "completed")
    ?? item.stages[0];
}

function progressTone(item: SampleRailItemViewState): string {
  return currentStage(item)?.tone ?? "neutral";
}

function shortLabel(item: SampleRailItemViewState): string {
  const raw = (item.label ?? `样品 ${item.displayNumber}`).trim();
  return raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function activationDuration(distance: number): number {
  if (prefersReducedMotion()) return 0;
  return Math.min(500, 250 + Math.max(0, distance - 1) * 50);
}

function installActivationStyles(): void {
  if (document.head.querySelector("style[data-aromasense-sample-rail-activation]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseSampleRailActivation = "true";
  style.textContent = `
    .cupping-layout__rail-list{overflow:visible!important}
    .sample-rail{position:relative;overflow:visible}
    .sample-rail__item{
      min-height:38px!important;
      padding:5px 4px!important;
      transform:none!important;
      transform-origin:center;
      will-change:transform;
    }
    .sample-rail__item.is-expanded{min-height:58px!important}
    .sample-rail__item.is-active{
      min-height:56px!important;
      padding:9px 4px!important;
      transform:none!important;
      border-top-color:rgba(255,255,255,.22)!important;
      border-right-color:rgba(255,255,255,.22)!important;
      border-bottom-color:rgba(255,255,255,.22)!important;
      background:#252421!important;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.035),0 5px 16px rgba(0,0,0,.18)!important;
    }
    .sample-rail__item.is-active.is-expanded{min-height:66px!important}
    .sample-rail__number{
      min-width:2.05em!important;
      color:#b59a65!important;
      font-size:clamp(17px,1.8vw,21px)!important;
      font-weight:720!important;
      line-height:1!important;
      letter-spacing:-.035em;
      font-variant-numeric:tabular-nums;
      transform-origin:left center;
      transition:none!important;
      will-change:transform,color;
    }
    .sample-rail__item.is-active .sample-rail__number{
      color:#fff!important;
      font-size:clamp(29px,3vw,35px)!important;
      font-weight:900!important;
      text-shadow:0 0 12px rgba(255,255,255,.10);
    }
    .sample-rail__item:not(.is-active) .sample-rail__label,
    .sample-rail__item:not(.is-active) .sample-rail__stage{opacity:.78}
    .sample-rail__active-indicator{
      position:fixed;
      z-index:40;
      width:14px;
      height:32px;
      margin:0;
      border:2px solid var(--as-gold,#b9995a);
      border-left:0;
      border-radius:0 18px 18px 0;
      background:rgba(185,153,90,.075);
      box-shadow:0 0 12px rgba(185,153,90,.16),inset -2px 0 4px rgba(185,153,90,.10);
      opacity:0;
      pointer-events:none;
      transform:translate3d(0,0,0);
      transform-origin:left center;
      will-change:transform,top,left,opacity;
    }
    .sample-rail.is-compact .sample-rail__number{font-size:16px!important}
    .sample-rail.is-compact .sample-rail__item.is-active .sample-rail__number{font-size:27px!important}
    @media (max-width:720px){
      .sample-rail__number{font-size:16px!important}
      .sample-rail__item.is-active .sample-rail__number{font-size:29px!important}
      .sample-rail__item.is-active{min-height:54px!important}
      .sample-rail__item.is-active.is-expanded{min-height:62px!important}
      .sample-rail__active-indicator{width:13px;height:30px;border-radius:0 16px 16px 0}
    }
  `;
  document.head.append(style);
}

function directCards(root: HTMLElement): HTMLElement[] {
  return [...root.children].filter((node): node is HTMLElement =>
    node instanceof HTMLElement && node.classList.contains("sample-rail__item")
  );
}

function cardMap(root: HTMLElement): Map<string, HTMLElement> {
  return new Map(directCards(root).flatMap((card) => {
    const sampleId = card.dataset.sampleId;
    return sampleId ? [[sampleId, card] as const] : [];
  }));
}

function captureGeometry(root: HTMLElement): Map<string, RailGeometry> {
  const output = new Map<string, RailGeometry>();
  for (const card of directCards(root)) {
    const sampleId = card.dataset.sampleId;
    const number = card.querySelector<HTMLElement>(".sample-rail__number");
    if (!sampleId || !number) continue;
    output.set(sampleId, {
      card: card.getBoundingClientRect(),
      number: number.getBoundingClientRect(),
      numberColor: getComputedStyle(number).color
    });
  }
  return output;
}

function cancelRailAnimations(root: HTMLElement): void {
  for (const card of directCards(root)) {
    card.getAnimations().forEach((animation) => animation.cancel());
    card.querySelector<HTMLElement>(".sample-rail__number")?.getAnimations().forEach((animation) => animation.cancel());
  }
  indicatorStates.get(root)?.indicator.getAnimations().forEach((animation) => animation.cancel());
}

function ensureIndicatorState(root: HTMLElement): IndicatorState {
  const current = indicatorStates.get(root);
  if (current) return current;

  const indicator = element("span", "sample-rail__active-indicator");
  indicator.setAttribute("aria-hidden", "true");
  root.append(indicator);

  const scrollContainer = root.closest<HTMLElement>(".cupping-layout__rail") ?? undefined;
  const state: IndicatorState = { indicator, scrollContainer };
  if (scrollContainer) {
    state.scrollHandler = () => positionIndicator(root, false);
    scrollContainer.addEventListener("scroll", state.scrollHandler, { passive: true });
  }
  indicatorStates.set(root, state);
  return state;
}

function activeCard(root: HTMLElement): HTMLElement | undefined {
  const activeSampleId = root.dataset.activeSampleId;
  return directCards(root).find((card) => card.dataset.sampleId === activeSampleId);
}

function targetIndicatorPosition(root: HTMLElement): { top: number; left: number; visible: boolean } | undefined {
  const state = ensureIndicatorState(root);
  const card = activeCard(root);
  const rail = state.scrollContainer;
  if (!card || !rail) return undefined;

  const cardRect = card.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const height = state.indicator.offsetHeight || 32;
  const visible = cardRect.bottom > railRect.top && cardRect.top < railRect.bottom;
  return {
    top: cardRect.top + cardRect.height / 2 - height / 2,
    left: railRect.right - 1,
    visible
  };
}

function positionIndicator(root: HTMLElement, animate: boolean, duration = 0, fromTop?: number): void {
  const state = ensureIndicatorState(root);
  const target = targetIndicatorPosition(root);
  state.indicator.getAnimations().forEach((animation) => animation.cancel());
  if (!target) {
    state.indicator.style.opacity = "0";
    return;
  }

  state.indicator.style.left = `${Math.round(target.left)}px`;
  state.indicator.style.top = `${Math.round(target.top)}px`;
  state.indicator.style.opacity = target.visible ? "1" : "0";
  if (!target.visible || !animate || duration <= 0 || fromTop === undefined) return;

  const deltaY = fromTop - target.top;
  state.indicator.animate(
    [
      { transform: `translate3d(0,${deltaY}px,0)`, opacity: 1 },
      { transform: "translate3d(0,0,0)", opacity: 1 }
    ],
    { duration, easing: ACTIVATION_EASING }
  );
}

function animateCardLayout(
  root: HTMLElement,
  before: Map<string, RailGeometry>,
  after: Map<string, RailGeometry>,
  duration: number
): void {
  if (duration <= 0) return;
  const cards = cardMap(root);
  for (const [sampleId, next] of after) {
    const previous = before.get(sampleId);
    const card = cards.get(sampleId);
    if (!previous || !card) continue;
    const dx = previous.card.left - next.card.left;
    const dy = previous.card.top - next.card.top;
    const sx = next.card.width > 0 ? previous.card.width / next.card.width : 1;
    const sy = next.card.height > 0 ? previous.card.height / next.card.height : 1;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) continue;
    card.animate(
      [
        { transform: `translate3d(${dx}px,${dy}px,0) scale(${sx},${sy})` },
        { transform: "translate3d(0,0,0) scale(1,1)" }
      ],
      { duration, easing: ACTIVATION_EASING }
    );
  }
}

function animateNumberTransition(
  root: HTMLElement,
  sampleId: string | undefined,
  before: Map<string, RailGeometry>,
  after: Map<string, RailGeometry>,
  duration: number,
  delay: number
): void {
  if (!sampleId || duration <= 0) return;
  const previous = before.get(sampleId);
  const next = after.get(sampleId);
  const number = cardMap(root).get(sampleId)?.querySelector<HTMLElement>(".sample-rail__number");
  if (!previous || !next || !number) return;
  const scale = next.number.height > 0 ? previous.number.height / next.number.height : 1;
  number.animate(
    [
      { transform: `scale(${scale})`, color: previous.numberColor },
      { transform: "scale(1)", color: next.numberColor }
    ],
    { duration, delay, easing: ACTIVATION_EASING }
  );
}

function updateCard(
  card: HTMLElement,
  item: SampleRailItemViewState,
  callbacks: SampleRailCallbacks,
  compact: boolean,
  initialExpanded: boolean
): void {
  if (card.dataset.userExpanded === undefined) {
    card.dataset.userExpanded = String(initialExpanded && !item.active);
  }
  const expanded = !compact && card.dataset.userExpanded === "true";
  const stage = currentStage(item);
  card.className = `sample-rail__item sample-rail__item--${progressTone(item)}${item.active ? " is-active" : ""}${expanded ? " is-expanded" : " is-collapsed"}`;
  card.dataset.sampleId = item.sampleId;
  card.dataset.displayNumber = String(item.displayNumber);

  const existingNumber = card.querySelector<HTMLElement>(".sample-rail__number");
  const number = existingNumber ?? element("strong", "sample-rail__number");
  number.textContent = String(item.displayNumber).padStart(2, "0");

  const select = document.createElement("button");
  select.type = "button";
  select.className = "sample-rail__select";
  select.setAttribute("aria-label", `${item.active ? "当前" : "切换到"}样品 ${item.displayNumber}`);
  select.setAttribute("aria-current", item.active ? "true" : "false");
  select.onclick = () => void callbacks.select(item.sampleId, preferredStage(item));
  select.append(number);

  if (expanded) {
    const text = element("span", "sample-rail__active-copy");
    text.append(
      element("span", "sample-rail__label", shortLabel(item)),
      element("small", `sample-rail__stage sample-rail__stage--${stage?.tone ?? "neutral"}`, stage?.label ?? "准备")
    );
    select.append(text);
  }

  const stateDot = element("span", `sample-rail__state-dot sample-rail__state-dot--${stage?.tone ?? "neutral"}`);
  stateDot.title = stage ? `${stage.label}：${stage.status}` : "尚未开始";
  select.append(stateDot);

  const actions = element("div", "sample-rail__actions");
  if (!compact) {
    const expand = button("sample-rail__expand", expanded ? "‹" : "›", () => {
      card.dataset.userExpanded = String(!expanded);
      return callbacks.toggleExpanded(item.sampleId);
    });
    expand.setAttribute("aria-expanded", String(expanded));
    expand.title = expanded ? "收起样品便签" : "展开样品便签";
    actions.append(expand);

    const drag = button("sample-rail__drag", "●", () => undefined);
    drag.type = "button";
    drag.dataset.dragHandle = "sample";
    drag.setAttribute("aria-label", `拖动样品 ${item.displayNumber}`);
    drag.title = `长按拖动样品 ${item.displayNumber}`;
    actions.append(drag);
  }

  card.replaceChildren(select);
  if (actions.childElementCount) card.append(actions);
}

export function renderSampleRail(
  root: HTMLElement,
  items: readonly SampleRailItemViewState[],
  callbacks: SampleRailCallbacks,
  options: SampleRailRenderOptions = {}
): void {
  installActivationStyles();
  const indicatorState = ensureIndicatorState(root);
  const previousActiveSampleId = root.dataset.activeSampleId || undefined;
  const existingCards = cardMap(root);
  const previousDisplayNumber = previousActiveSampleId
    ? Number(existingCards.get(previousActiveSampleId)?.dataset.displayNumber)
    : undefined;
  const before = captureGeometry(root);
  const indicatorBeforeTop = indicatorState.indicator.style.opacity === "1"
    ? indicatorState.indicator.getBoundingClientRect().top
    : undefined;

  cancelRailAnimations(root);
  root.classList.add("sample-rail");
  root.classList.toggle("is-compact", Boolean(options.compact));

  const liveSampleIds = new Set(items.map((item) => item.sampleId));
  for (const item of items) {
    const card = existingCards.get(item.sampleId) ?? element("article", "sample-rail__item");
    updateCard(
      card,
      item,
      callbacks,
      Boolean(options.compact),
      options.expandedSampleIds?.has(item.sampleId) ?? false
    );
    root.append(card);
  }
  for (const card of directCards(root)) {
    const sampleId = card.dataset.sampleId;
    if (!sampleId || !liveSampleIds.has(sampleId)) card.remove();
  }
  root.append(indicatorState.indicator);

  const activeItem = items.find((item) => item.active);
  const nextActiveSampleId = activeItem?.sampleId;
  if (nextActiveSampleId) root.dataset.activeSampleId = nextActiveSampleId;
  else delete root.dataset.activeSampleId;

  const after = captureGeometry(root);
  const activeChanged = Boolean(previousActiveSampleId && nextActiveSampleId && previousActiveSampleId !== nextActiveSampleId);
  const distance = activeItem && Number.isFinite(previousDisplayNumber)
    ? Math.abs(activeItem.displayNumber - Number(previousDisplayNumber))
    : 1;
  const duration = activeChanged ? activationDuration(Math.max(1, distance)) : 0;

  if (activeChanged) {
    animateCardLayout(root, before, after, duration);
    animateNumberTransition(root, previousActiveSampleId, before, after, Math.round(duration * .62), 0);
    animateNumberTransition(root, nextActiveSampleId, before, after, Math.round(duration * .62), Math.round(duration * .38));
  }
  positionIndicator(root, activeChanged, duration, indicatorBeforeTop);
}
