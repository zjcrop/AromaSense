import type { StageId } from "../../../shared/protocol/aromasense-v1";
import type { SampleRailItemViewState, StageIndicatorState } from "../cupping-view-model";
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
  resizeObserver?: ResizeObserver;
}

const activeTabStates = new WeakMap<HTMLElement, ActiveTabState>();
const ACTIVATION_EASING = "cubic-bezier(.45,0,.55,1)";

const IDENTITY_FIELDS: readonly [string, string][] = [
  ["country", "国家"],
  ["region", "产区"],
  ["farm", "庄园/处理站"],
  ["variety", "品种"],
  ["process", "处理"],
  ["roast", "烘焙"],
  ["roastDate", "烘焙日"],
  ["altitude", "海拔"],
  ["flavorNotes", "风味"]
];

const IDENTITY_FIELD_KEYS = new Set(IDENTITY_FIELDS.map(([key]) => key));

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

function readableMetadataValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) {
    const values = value.flatMap((entry) => {
      if (typeof entry === "string") return entry.trim() ? [entry.trim()] : [];
      if (typeof entry === "number" && Number.isFinite(entry)) return [String(entry)];
      return [];
    });
    return values.length ? values.join("/") : undefined;
  }
  return undefined;
}

function metadataLine(item: SampleRailItemViewState): string {
  const pieces: string[] = [];
  for (const [key, caption] of IDENTITY_FIELDS) {
    const value = readableMetadataValue(item.metadata[key]);
    if (value) pieces.push(`${caption} ${value}`);
  }
  for (const [key, raw] of Object.entries(item.metadata)) {
    if (IDENTITY_FIELD_KEYS.has(key) || key.startsWith("_")) continue;
    const value = readableMetadataValue(raw);
    if (value) pieces.push(`${key} ${value}`);
  }
  return pieces.join("　");
}

function indicatorTitle(state: StageIndicatorState): string {
  if (state === "completed") return "已完成";
  if (state === "near_complete") return "接近完成";
  if (state === "active") return "进行中";
  return "未开始";
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
    .cupping-layout{
      position:relative;
      grid-template-columns:46px minmax(0,1fr)!important;
      column-gap:14px!important;
      overflow:visible;
    }
    .cupping-layout.is-rail-compact{grid-template-columns:46px minmax(0,1fr)!important;column-gap:14px!important}
    .cupping-layout__rail{
      position:relative;
      z-index:40!important;
      width:min(900px,92vw);
      height:100dvh;
      min-height:0;
      display:flex;
      flex-direction:column;
      overflow:hidden!important;
      padding:7px 6px max(7px,env(safe-area-inset-bottom))!important;
      background:#121212;
      border-right:1px solid rgba(185,153,90,.28)!important;
      box-shadow:14px 0 32px rgba(0,0,0,.31);
      transition:width 560ms cubic-bezier(.45,0,.55,1),box-shadow 560ms cubic-bezier(.45,0,.55,1);
      will-change:width;
    }
    .cupping-layout.is-rail-compact .cupping-layout__rail{width:46px;box-shadow:none}
    .cupping-layout__main{
      position:relative;
      z-index:1;
      grid-column:2;
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
    .cupping-main__footer.is-two-action{grid-template-columns:repeat(2,minmax(0,1fr))!important}
    .cupping-layout__rail-list{
      flex:1 1 auto;
      min-height:0;
      overflow-y:auto!important;
      overflow-x:hidden!important;
      scrollbar-width:thin;
    }
    .sample-rail{position:relative;overflow:visible!important}
    .sample-rail__item{
      position:relative;
      z-index:2;
      min-height:40px!important;
      margin-bottom:4px!important;
      padding:5px 4px!important;
      transform:none!important;
      background:transparent!important;
      will-change:transform;
    }
    .sample-rail__item.is-expanded{min-height:68px!important;padding-top:7px!important;padding-bottom:7px!important}
    .sample-rail__item.is-active{
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
      gap:9px;
      align-items:center;
      border:0;
      background:transparent;
      color:inherit;
      padding:2px 20px 2px 0;
      text-align:left!important;
    }
    .sample-rail__number{
      min-width:2.05em!important;
      color:#b9995a!important;
      font-size:clamp(16px,1.65vw,19px)!important;
      font-weight:650!important;
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
      grid-template-rows:auto auto;
      justify-items:start;
      gap:7px;
      overflow:hidden;
      text-align:left!important;
    }
    .sample-rail__identity-line{
      width:100%;
      min-width:0;
      overflow:hidden;
      white-space:nowrap;
      text-overflow:clip;
      line-height:1.22;
      text-align:left!important;
      justify-self:stretch;
    }
    .sample-rail__sample-name{
      display:inline-block;
      font-size:18px;
      font-weight:600;
      margin-right:1em;
      text-align:left!important;
    }
    .sample-rail__metadata{
      display:inline;
      font-size:13px;
      font-weight:400;
      letter-spacing:.005em;
    }
    .sample-rail__stage-progress{
      display:flex;
      align-items:flex-end;
      justify-content:flex-start;
      gap:1em;
      min-width:0;
      overflow:hidden;
      white-space:nowrap;
      font-size:13px;
      line-height:1.05;
    }
    .sample-rail__stage-token{
      display:inline-grid;
      grid-template-rows:auto 3px;
      gap:4px;
      flex:0 0 auto;
      min-width:2.2em;
      text-align:center;
    }
    .sample-rail__stage-name{display:block;padding:0 .05em}
    .sample-rail__stage-line{
      display:block;
      width:100%;
      height:3px;
      border-radius:999px;
      background:#505050;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.025);
    }
    .sample-rail__stage-token[data-state="active"] .sample-rail__stage-line{background:#4b8fd8}
    .sample-rail__stage-token[data-state="near_complete"] .sample-rail__stage-line{background:#55a56b}
    .sample-rail__stage-token[data-state="completed"] .sample-rail__stage-line{background:#d38a3c}
    .sample-rail__item:not(.is-active) .sample-rail__identity-line,
    .sample-rail__item:not(.is-active) .sample-rail__stage-progress{color:#85817b!important;opacity:.9}
    .sample-rail__item.is-active .sample-rail__identity-line,
    .sample-rail__item.is-active .sample-rail__stage-progress{color:#fff!important;opacity:1}
    .sample-rail__state-dot{position:relative;z-index:3}
    .sample-rail__item.is-active .sample-rail__state-dot{background:#fff!important;box-shadow:none!important}
    .sample-rail__actions{position:absolute!important;z-index:4;right:3px;top:50%;transform:translateY(-50%)}
    .sample-rail__drag{
      width:14px!important;
      min-height:22px!important;
      border:0!important;
      background:transparent!important;
      color:#6f6a62!important;
      font-size:7px!important;
      opacity:.7;
    }
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
    .sample-rail.is-compact .sample-rail__active-copy,
    .sample-rail.is-compact .sample-rail__actions{display:none!important}
    .sample-rail.is-compact .sample-rail__number{font-size:15px!important;min-width:0!important;color:#b9995a!important}
    .sample-rail.is-compact .sample-rail__item.is-active .sample-rail__number{font-size:27px!important;color:#fff!important}
    .sample-rail.is-compact .sample-rail__select{grid-template-columns:1fr!important;justify-items:center!important;padding:2px 0!important}
    .sample-rail.is-compact .sample-rail__state-dot{width:5px!important;height:5px!important}
    .cupping-rail-tools{
      flex:0 0 auto;
      z-index:50!important;
      position:relative!important;
      top:auto!important;
      padding:0 0 7px!important;
      background:#121212!important;
    }
    .cupping-rail-footer{
      position:relative;
      z-index:55;
      flex:0 0 auto;
      display:grid;
      gap:6px;
      padding:7px 0 0;
      border-top:1px solid rgba(255,255,255,.065);
      background:#121212;
    }
    .cupping-rail-footer__toggle{
      width:100%;
      min-height:25px;
      border:1px solid rgba(185,153,90,.24);
      border-radius:7px;
      background:#1b1b1b;
      color:#bda66f;
      font-size:17px;
      line-height:1;
    }
    .cupping-rail-footer__actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
    .cupping-rail-footer__exit,
    .cupping-rail-footer__finish{
      min-width:0;
      min-height:37px;
      border:1px solid rgba(185,153,90,.34);
      border-radius:8px;
      padding:5px 7px;
      background:#1d1d1d;
      color:#c8c0b2;
      font-size:11px;
      font-weight:650;
    }
    .cupping-rail-footer__finish:not(:disabled){border-color:#b9995a;background:#b9995a;color:#111}
    .cupping-rail-footer__finish:disabled{
      border-color:rgba(255,255,255,.08);
      background:#252525;
      color:#65615b;
      opacity:1;
      cursor:not-allowed;
    }
    .cupping-layout.is-rail-compact .cupping-rail-footer{gap:4px}
    .cupping-layout.is-rail-compact .cupping-rail-footer__actions{grid-template-columns:1fr;gap:4px}
    .cupping-layout.is-rail-compact .cupping-rail-footer__exit,
    .cupping-layout.is-rail-compact .cupping-rail-footer__finish{
      min-height:31px;
      padding:3px 1px;
      font-size:9px;
      border-radius:6px;
    }
    @media (max-width:720px){
      .cupping-layout{grid-template-columns:40px minmax(0,1fr)!important;column-gap:12px!important}
      .cupping-layout.is-rail-compact{grid-template-columns:40px minmax(0,1fr)!important;column-gap:12px!important}
      .cupping-layout__rail{
        width:clamp(286px,72vw,320px);
        max-width:calc(100vw - 72px);
        padding-left:3px!important;
        padding-right:3px!important;
      }
      .cupping-layout.is-rail-compact .cupping-layout__rail{width:40px;max-width:40px}
      .cupping-layout__main{max-width:100%;padding-right:max(10px,env(safe-area-inset-right))}
      .sample-rail__item.is-expanded{min-height:66px!important;padding-top:6px!important;padding-bottom:6px!important}
      .sample-rail__select{grid-template-columns:auto minmax(0,1fr) auto;gap:6px;padding-right:17px}
      .sample-rail__number{font-size:15px!important}
      .sample-rail__item.is-active .sample-rail__number{font-size:29px!important}
      .sample-rail__sample-name{font-size:16px}
      .sample-rail__metadata{font-size:11px}
      .sample-rail__stage-progress{font-size:12px;gap:1em}
      .sample-rail__stage-token{grid-template-rows:auto 3px;gap:3px;min-width:2.1em}
    }
    @media (prefers-reduced-motion:reduce){.cupping-layout__rail{transition:none!important}}
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
    if (typeof ResizeObserver !== "undefined") {
      state.resizeObserver = new ResizeObserver(() => positionActiveTab(root, false));
      state.resizeObserver.observe(scrollContainer);
    }
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
  const copy = card?.querySelector<HTMLElement>(".sample-rail__active-copy");
  const rail = state.scrollContainer;
  if (!card || !number || !rail) return undefined;
  const cardRect = card.getBoundingClientRect();
  const numberRect = number.getBoundingClientRect();
  const copyRect = copy?.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const compact = root.classList.contains("is-compact");
  const requiredHeight = Math.max(numberRect.height + (compact ? 6 : 8), (copyRect?.height ?? 0) + 12);
  const height = Math.ceil(Math.max(compact ? 33 : 48, requiredHeight));
  const protrusion = compact ? 7 : 18;
  const left = Math.round(cardRect.left - 1);
  const visible = cardRect.bottom > railRect.top && cardRect.top < railRect.bottom;
  return {
    top: Math.round(cardRect.top + cardRect.height / 2 - height / 2),
    left,
    width: Math.max(compact ? 40 : 54, Math.round(railRect.right + protrusion - left)),
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
      { left: `${Math.round(fromRect.left)}px`, top: `${Math.round(fromRect.top)}px`, width: `${Math.round(fromRect.width)}px`, height: `${Math.round(fromRect.height)}px`, opacity: 1 },
      { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, opacity: 1 }
    ],
    { duration, easing: ACTIVATION_EASING }
  );
}

function animateCardLayout(root: HTMLElement, before: Map<string, RailGeometry>, after: Map<string, RailGeometry>, duration: number): void {
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
      [{ transform: `translate3d(${dx}px,${dy}px,0)` }, { transform: "translate3d(0,0,0)" }],
      { duration, easing: ACTIVATION_EASING }
    );
  }
}

function animateNumberTransition(root: HTMLElement, sampleId: string | undefined, before: Map<string, RailGeometry>, after: Map<string, RailGeometry>, duration: number, delay: number): void {
  if (!sampleId || duration <= 0) return;
  const previous = before.get(sampleId);
  const next = after.get(sampleId);
  const number = cardMap(root).get(sampleId)?.querySelector<HTMLElement>(".sample-rail__number");
  if (!previous || !next || !number) return;
  const scale = next.number.height > 0 ? previous.number.height / next.number.height : 1;
  number.animate(
    [{ transform: `scale(${scale})`, color: previous.numberColor }, { transform: "scale(1)", color: next.numberColor }],
    { duration, delay, easing: ACTIVATION_EASING }
  );
}

function animateActiveCopy(root: HTMLElement, sampleId: string | undefined, duration: number, delay: number): void {
  if (!sampleId || duration <= 0) return;
  const copy = cardMap(root).get(sampleId)?.querySelector<HTMLElement>(".sample-rail__active-copy");
  if (!copy) return;
  copy.animate(
    [{ opacity: .25, transform: "translate3d(-2px,0,0)" }, { opacity: 1, transform: "translate3d(0,0,0)" }],
    { duration, delay, easing: ACTIVATION_EASING }
  );
}

function buildStageProgress(item: SampleRailItemViewState): HTMLElement {
  const progress = element("span", "sample-rail__stage-progress");
  for (const stage of item.stages) {
    const token = element("span", "sample-rail__stage-token");
    token.dataset.state = stage.indicatorState;
    token.title = `${stage.label}：${indicatorTitle(stage.indicatorState)}`;
    token.setAttribute("aria-label", `${stage.label}：${indicatorTitle(stage.indicatorState)}`);
    token.append(
      element("span", "sample-rail__stage-name", stage.label),
      element("span", "sample-rail__stage-line")
    );
    progress.append(token);
  }
  return progress;
}

function updateCard(card: HTMLElement, item: SampleRailItemViewState, callbacks: SampleRailCallbacks, compact: boolean): void {
  const isExpanded = !compact;
  const stage = currentStage(item);
  card.className = `sample-rail__item sample-rail__item--${progressTone(item)}${item.active ? " is-active" : ""}${isExpanded ? " is-expanded" : " is-collapsed"}`;
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

  if (isExpanded) {
    const text = element("span", "sample-rail__active-copy");
    const identityRow = element("span", "sample-rail__identity-line");
    const sampleName = item.label?.trim() || `样品 ${String(item.displayNumber).padStart(2, "0")}`;
    const metadata = metadataLine(item);
    identityRow.append(element("strong", "sample-rail__sample-name", sampleName));
    if (metadata) identityRow.append(element("span", "sample-rail__metadata", metadata));
    identityRow.title = metadata ? `${sampleName}　${metadata}` : sampleName;
    text.append(identityRow, buildStageProgress(item));
    select.append(text);
  }

  if (compact) {
    const stateDot = element("span", `sample-rail__state-dot sample-rail__state-dot--${stage?.tone ?? "neutral"}`);
    stateDot.title = stage ? `${stage.label}：${stage.status}` : "尚未开始";
    select.append(stateDot);
  }

  const actions = element("div", "sample-rail__actions");
  if (!compact) {
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
  const compact = Boolean(options.compact);
  root.classList.add("sample-rail");
  root.classList.toggle("is-compact", compact);

  const liveSampleIds = new Set(items.map((item) => item.sampleId));
  for (const item of items) {
    const card = existingCards.get(item.sampleId) ?? element("article", "sample-rail__item");
    updateCard(card, item, callbacks, compact);
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
