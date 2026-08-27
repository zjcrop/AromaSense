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

interface ActiveTabGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
  visible: boolean;
}

interface ActiveTabState {
  tab: HTMLElement;
  scrollContainer?: HTMLElement;
  scrollHandler?: () => void;
  resizeHandler?: () => void;
}

const activeTabStates = new WeakMap<HTMLElement, ActiveTabState>();
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

function progressLabel(item: SampleRailItemViewState): string {
  const stage = currentStage(item);
  return `${stage?.label ?? "准备"} · ${item.startedStageCount}/${item.totalStageCount}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function activationDuration(distance: number): number {
  if (prefersReducedMotion()) return 0;
  return Math.min(520, 270 + Math.max(0, distance - 1) * 48);
}

function installActivationStyles(): void {
  if (document.head.querySelector("style[data-aromasense-sample-rail-activation]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseSampleRailActivation = "true";
  style.textContent = `
    .cupping-layout{column-gap:18px!important}
    .cupping-layout.is-rail-compact{column-gap:14px!important}
    .cupping-layout__rail{overflow-x:visible!important;z-index:3}
    .cupping-layout__main{
      width:100%;
      max-width:980px;
      justify-self:center;
      box-sizing:border-box;
      padding-right:clamp(12px,2vw,28px);
    }
    .cupping-main__header,
    .cupping-main__editor,
    .cupping-main__stage-strip,
    .cupping-main__footer{
      width:100%;
      max-width:920px;
      margin-left:auto;
      margin-right:auto;
      box-sizing:border-box;
    }
    .cupping-layout__rail-list{overflow:visible!important}
    .sample-rail{position:relative;overflow:visible!important}
    .sample-rail__item{
      position:relative;
      z-index:2;
      min-height:40px!important;
      padding:5px 4px!important;
      transform:none!important;
      transform-origin:center;
      background:transparent!important;
      will-change:transform;
    }
    .sample-rail__item.is-expanded{min-height:62px!important;padding-top:8px!important;padding-bottom:8px!important}
    .sample-rail__item.is-active{
      transform:none!important;
      border-top-color:transparent!important;
      border-right-color:transparent!important;
      border-bottom-color:rgba(255,255,255,.05)!important;
      background:transparent!important;
      box-shadow:none!important;
    }
    .sample-rail__select{
      position:relative;
      z-index:3;
      min-width:0;
      width:100%;
      display:grid;
      grid-template-columns:auto minmax(0,1fr) auto;
      gap:5px;
      align-items:center;
      border:0;
      background:transparent;
      color:inherit;
      padding:2px 0;
      text-align:left;
    }
    .sample-rail__number{
      min-width:2.05em!important;
      color:#87837d!important;
      font-size:clamp(16px,1.65vw,19px)!important;
      font-weight:430!important;
      line-height:1!important;
      letter-spacing:-.025em;
      font-variant-numeric:tabular-nums;
      transform-origin:left center;
      transition:none!important;
      will-change:transform,color;
    }
    .sample-rail__item.is-active .sample-rail__number{
      color:#fff!important;
      font-size:clamp(29px,3vw,34px)!important;
      font-weight:820!important;
      text-shadow:0 1px 8px rgba(0,0,0,.16);
    }
    .sample-rail__active-copy{
      position:relative;
      z-index:3;
      min-width:0;
      display:grid;
      gap:2px;
    }
    .sample-rail__item:not(.is-active) .sample-rail__label,
    .sample-rail__item:not(.is-active) .sample-rail__stage,
    .sample-rail__item:not(.is-active) .sample-rail__progress{
      color:#85817b!important;
      font-weight:400!important;
      opacity:.82;
    }
    .sample-rail__item.is-active .sample-rail__label,
    .sample-rail__item.is-active .sample-rail__stage,
    .sample-rail__item.is-active .sample-rail__progress{
      color:#fff!important;
    }
    .sample-rail__label{font-size:9px!important;line-height:1.15!important}
    .sample-rail__stage,.sample-rail__progress{font-size:8px!important;line-height:1.1!important}
    .sample-rail__state-dot{position:relative;z-index:3}
    .sample-rail__item.is-active .sample-rail__state-dot{background:#fff!important;box-shadow:none!important}
    .sample-rail__actions{position:relative;z-index:4}
    .sample-rail__active-tab{
      position:fixed;
      z-index:1;
      margin:0;
      border:1px solid rgba(214,173,99,.34);
      border-left:0;
      border-radius:0 999px 999px 0;
      background:linear-gradient(90deg,rgba(104,78,39,.96),rgba(128,95,45,.96));
      box-shadow:0 4px 14px rgba(0,0,0,.24),inset -1px 0 0 rgba(255,255,255,.08);
      opacity:0;
      pointer-events:none;
      transform:translate3d(0,0,0);
      transform-origin:left center;
      will-change:left,top,width,height,opacity,transform;
    }
    .sample-rail.is-compact .sample-rail__number{font-size:15px!important}
    .sample-rail.is-compact .sample-rail__item.is-active .sample-rail__number{font-size:27px!important}
    .cupping-rail-tools{z-index:50!important}
    @media (max-width:720px){
      .cupping-layout{column-gap:16px!important}
      .cupping-layout.is-rail-compact{column-gap:12px!important}
      .cupping-layout__main{max-width:100%;padding-right:max(10px,env(safe-area-inset-right))}
      .cupping-main__header,
      .cupping-main__editor,
      .cupping-main__stage-strip,
      .cupping-main__footer{max-width:100%}
      .sample-rail__item{min-height:40px!important;padding:5px 3px!important}
      .sample-rail__item.is-expanded{min-height:64px!important;padding-top:7px!important;padding-bottom:7px!important}
      .sample-rail__select{grid-template-columns:auto minmax(0,1fr);gap:3px;padding-right:15px}
      .sample-rail__number{font-size:15px!important}
      .sample-rail__item.is-active .sample-rail__number{font-size:29px!important}
      .sample-rail__select .sample-rail__state-dot{grid-column:1 / -1;justify-self:center}
      .sample-rail__active-copy{text-align:left}
      .sample-rail__actions{position:absolute!important;right:1px!important;top:2px!important;display:grid!important;gap:1px!important}
      .sample-rail__expand{display:grid!important;place-items:center;width:15px!important;min-height:15px!important;font-size:8px!important;opacity:.62}
      .sample-rail__drag{width:15px!important;min-height:15px!important;font-size:7px!important}
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
    card.querySelector<HTMLElement>(".sample-rail__active-copy")?.getAnimations().forEach((animation) => animation.cancel());
  }
  activeTabStates.get(root)?.tab.getAnimations().forEach((animation) => animation.cancel());
}

function ensureActiveTabState(root: HTMLElement): ActiveTabState {
  const current = activeTabStates.get(root);
  if (current) return current;

  const tab = element("span", "sample-rail__active-tab");
  tab.setAttribute("aria-hidden", "true");
  root.append(tab);

  const scrollContainer = root.closest<HTMLElement>(".cupping-layout__rail") ?? undefined;
  const state: ActiveTabState = { tab, scrollContainer };
  if (scrollContainer) {
    state.scrollHandler = () => positionActiveTab(root, false);
    scrollContainer.addEventListener("scroll", state.scrollHandler, { passive: true });
  }
  state.resizeHandler = () => positionActiveTab(root, false);
  window.addEventListener("resize", state.resizeHandler, { passive: true });
  activeTabStates.set(root, state);
  return state;
}

function activeCard(root: HTMLElement): HTMLElement | undefined {
  const activeSampleId = root.dataset.activeSampleId;
  return directCards(root).find((card) => card.dataset.sampleId === activeSampleId);
}

function targetActiveTabGeometry(root: HTMLElement): ActiveTabGeometry | undefined {
  const state = ensureActiveTabState(root);
  const card = activeCard(root);
  const number = card?.querySelector<HTMLElement>(".sample-rail__number");
  const rail = state.scrollContainer;
  if (!card || !number || !rail) return undefined;

  const cardRect = card.getBoundingClientRect();
  const numberRect = number.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const compact = root.classList.contains("is-compact");
  const height = Math.ceil(Math.max(compact ? 33 : 36, numberRect.height + (compact ? 6 : 8)));
  const protrusion = compact ? 12 : 16;
  const left = Math.round(cardRect.left - 1);
  const visible = cardRect.bottom > railRect.top && cardRect.top < railRect.bottom;

  return {
    top: Math.round(numberRect.top + numberRect.height / 2 - height / 2),
    left,
    width: Math.max(42, Math.round(railRect.right + protrusion - left)),
    height,
    visible
  };
}

function positionActiveTab(root: HTMLElement, animate: boolean, duration = 0, fromRect?: DOMRect): void {
  const state = ensureActiveTabState(root);
  const target = targetActiveTabGeometry(root);
  state.tab.getAnimations().forEach((animation) => animation.cancel());
  if (!target) {
    state.tab.style.opacity = "0";
    return;
  }

  state.tab.style.left = `${target.left}px`;
  state.tab.style.top = `${target.top}px`;
  state.tab.style.width = `${target.width}px`;
  state.tab.style.height = `${target.height}px`;
  state.tab.style.opacity = target.visible ? "1" : "0";
  if (!target.visible || !animate || duration <= 0 || !fromRect) return;

  state.tab.animate(
    [
      {
        left: `${Math.round(fromRect.left)}px`,
        top: `${Math.round(fromRect.top)}px`,
        width: `${Math.round(fromRect.width)}px`,
        height: `${Math.round(fromRect.height)}px`,
        opacity: 1
      },
      {
        left: `${target.left}px`,
        top: `${target.top}px`,
        width: `${target.width}px`,
        height: `${target.height}px`,
        opacity: 1
      }
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
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5) continue;
    card.animate(
      [
        { transform: `translate3d(${dx}px,${dy}px,0)` },
        { transform: "translate3d(0,0,0)" }
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

function animateActiveCopy(root: HTMLElement, sampleId: string | undefined, duration: number, delay: number): void {
  if (!sampleId || duration <= 0) return;
  const copy = cardMap(root).get(sampleId)?.querySelector<HTMLElement>(".sample-rail__active-copy");
  if (!copy) return;
  copy.animate(
    [
      { opacity: .25, transform: "translate3d(-2px,0,0)" },
      { opacity: 1, transform: "translate3d(0,0,0)" }
    ],
    { duration, delay, easing: ACTIVATION_EASING }
  );
}

function updateCard(
  card: HTMLElement,
  item: SampleRailItemViewState,
  callbacks: SampleRailCallbacks,
  compact: boolean,
  expanded: boolean
): void {
  const isExpanded = !compact && expanded;
  const stage = currentStage(item);
  card.className = `sample-rail__item sample-rail__item--${progressTone(item)}${item.active ? " is-active" : ""}${isExpanded ? " is-expanded" : " is-collapsed"}`;
  card.dataset.sampleId = item.sampleId;
  card.dataset.displayNumber = String(item.displayNumber);
  card.dataset.userExpanded = String(isExpanded);

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

  if (isExpanded) {
    const text = element("span", "sample-rail__active-copy");
    text.append(
      element("span", "sample-rail__label", shortLabel(item)),
      element("small", `sample-rail__progress sample-rail__stage--${stage?.tone ?? "neutral"}`, progressLabel(item))
    );
    select.append(text);
  }

  const stateDot = element("span", `sample-rail__state-dot sample-rail__state-dot--${stage?.tone ?? "neutral"}`);
  stateDot.title = stage ? `${stage.label}：${stage.status}` : "尚未开始";
  select.append(stateDot);

  const actions = element("div", "sample-rail__actions");
  if (!compact) {
    const expand = button("sample-rail__expand", isExpanded ? "‹" : "›", () => callbacks.toggleExpanded(item.sampleId));
    expand.setAttribute("aria-expanded", String(isExpanded));
    expand.title = isExpanded ? "收起样品便签" : "展开样品便签";
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
  const activeTabState = ensureActiveTabState(root);
  const previousActiveSampleId = root.dataset.activeSampleId || undefined;
  const existingCards = cardMap(root);
  const previousDisplayNumber = previousActiveSampleId
    ? Number(existingCards.get(previousActiveSampleId)?.dataset.displayNumber)
    : undefined;
  const before = captureGeometry(root);
  const tabBeforeRect = activeTabState.tab.style.opacity === "1"
    ? activeTabState.tab.getBoundingClientRect()
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
  root.append(activeTabState.tab);

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
    animateNumberTransition(root, previousActiveSampleId, before, after, Math.round(duration * .58), 0);
    animateNumberTransition(root, nextActiveSampleId, before, after, Math.round(duration * .58), Math.round(duration * .34));
    animateActiveCopy(root, nextActiveSampleId, Math.round(duration * .42), Math.round(duration * .58));
  }
  positionActiveTab(root, activeChanged, duration, tabBeforeRect);
}
