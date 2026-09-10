import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const PATCH_FLAG = Symbol.for("aromasense.cupping.adjacent-navigation-hotfix.v6");
const STATIC_RAIL_STYLE_ID = "aromasense-static-sample-activation-v6";
const railScrollSyncInstalled = new WeakSet<HTMLElement>();
const instantScrollInstalled = new WeakSet<HTMLElement>();
const revealTokens = new WeakMap<HTMLElement, number>();

interface RendererInternals {
  root: HTMLElement;
}

interface RendererPrototype {
  [PATCH_FLAG]?: boolean;
  render(this: RendererInternals): Promise<void>;
  renderRail?(this: RendererInternals, state: unknown): void;
}

function directStageSteps(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(".cupping-main__stage-strip .cupping-stage-step")];
}

function stageLabel(step: HTMLButtonElement): string {
  return step.querySelector<HTMLElement>(".cupping-stage-step__label")?.textContent?.trim()
    || step.dataset.stageId
    || "相邻节点";
}

function replaceNavigationButton(
  root: HTMLElement,
  selector: ".cupping-nav--previous" | ".cupping-nav--next",
  target: HTMLButtonElement | undefined,
  direction: "previous" | "next"
): void {
  const current = root.querySelector<HTMLButtonElement>(`.cupping-main__footer ${selector}`);
  if (!current) return;

  const replacement = current.cloneNode(true) as HTMLButtonElement;
  replacement.disabled = false;
  replacement.removeAttribute("title");
  replacement.hidden = !target;
  replacement.style.display = target ? "" : "none";
  replacement.style.visibility = target ? "visible" : "hidden";

  if (target) {
    const label = stageLabel(target);
    replacement.setAttribute(
      "aria-label",
      direction === "previous" ? `切换到上一个节点：${label}` : `切换到下一个节点：${label}`
    );
    replacement.title = direction === "previous" ? `上一个节点：${label}` : `下一个节点：${label}`;
    replacement.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      target.click();
    });
  } else {
    replacement.setAttribute("aria-hidden", "true");
    replacement.tabIndex = -1;
  }

  current.replaceWith(replacement);
}

function wireAdjacentNodeNavigation(root: HTMLElement): void {
  const steps = directStageSteps(root);
  if (!steps.length) return;
  const currentIndex = steps.findIndex((step) => step.classList.contains("is-current"));
  if (currentIndex < 0) return;

  replaceNavigationButton(root, ".cupping-nav--previous", currentIndex > 0 ? steps[currentIndex - 1] : undefined, "previous");
  replaceNavigationButton(root, ".cupping-nav--next", currentIndex < steps.length - 1 ? steps[currentIndex + 1] : undefined, "next");
}

function installStaticRailStyles(): void {
  if (document.getElementById(STATIC_RAIL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STATIC_RAIL_STYLE_ID;
  style.textContent = `
    .cupping-layout__rail-list .sample-rail__item,
    .cupping-layout__rail-list .sample-rail__number,
    .cupping-layout__rail-list .sample-rail__active-copy,
    .cupping-layout__rail-list .sample-rail__active-tab{
      transition:none!important;
      animation:none!important;
    }
    .cupping-layout__rail-list .sample-rail__active-tab{
      transition-property:none!important;
      animation-name:none!important;
      will-change:transform,opacity!important;
      transform-origin:left center!important;
    }
    .cupping-layout__rail-list .sample-rail__active-tab[data-reveal-pending="true"],
    .cupping-layout__rail-list .sample-rail__number[data-reveal-pending="true"]{
      opacity:0!important;
      visibility:hidden!important;
    }

    .aroma-dual-entry__targets .aroma-target{
      display:flex!important;
      flex-direction:column!important;
    }
    .aroma-dual-entry__targets .aroma-target > .sensory-field[data-field-key="dry_fragrance_intensity"],
    .aroma-dual-entry__targets .aroma-target > .sensory-field[data-field-key="wet_aroma_intensity"]{
      margin-top:auto!important;
      flex:0 0 auto!important;
    }

    .selected-tag-stack__item::after,
    .selected-tag-stack__drag::before,
    .selected-tag-stack__drag::after{
      content:none!important;
      display:none!important;
    }
  `;
  document.head.append(style);
}

function cancelSourceRailAnimations(rail: HTMLElement): void {
  for (const node of rail.querySelectorAll<HTMLElement>(
    ".sample-rail__item,.sample-rail__number,.sample-rail__active-copy,.sample-rail__active-tab"
  )) {
    node.getAnimations().forEach((animation) => animation.cancel());
  }
}

function ensureInstantRailScroll(rail: HTMLElement): void {
  if (instantScrollInstalled.has(rail)) return;
  instantScrollInstalled.add(rail);
  const nativeScrollTo = rail.scrollTo.bind(rail);
  Object.defineProperty(rail, "scrollTo", {
    configurable: true,
    value: (first: ScrollToOptions | number, second?: number): void => {
      if (typeof first === "number") {
        nativeScrollTo(first, second ?? 0);
        return;
      }
      nativeScrollTo({ left: first.left, top: first.top, behavior: "auto" });
    }
  });
}

function activeCard(rail: HTMLElement): HTMLElement | undefined {
  return [...rail.children].find((node): node is HTMLElement =>
    node instanceof HTMLElement
      && node.classList.contains("sample-rail__item")
      && node.classList.contains("is-active")
  );
}

function syncActiveMarkerGeometry(rail: HTMLElement): void {
  const tab = rail.querySelector<HTMLElement>(".sample-rail__active-tab");
  const card = activeCard(rail);
  const outerRail = rail.closest<HTMLElement>(".cupping-layout__rail");
  const number = card?.querySelector<HTMLElement>(".sample-rail__number");
  const copy = card?.querySelector<HTMLElement>(".sample-rail__active-copy");
  if (!tab || !card || !outerRail || !number) {
    if (tab) {
      tab.style.visibility = "hidden";
      tab.style.opacity = "0";
    }
    return;
  }

  const cardRect = card.getBoundingClientRect();
  const numberRect = number.getBoundingClientRect();
  const copyRect = copy?.getBoundingClientRect();
  const railRect = outerRail.getBoundingClientRect();
  const compact = rail.classList.contains("is-compact");
  const requiredHeight = Math.max(numberRect.height + (compact ? 6 : 8), (copyRect?.height ?? 0) + 12);
  const height = Math.ceil(Math.max(compact ? 33 : 48, requiredHeight));
  const protrusion = compact ? 7 : 18;
  const left = Math.round(cardRect.left - 1);
  const visible = cardRect.bottom > railRect.top && cardRect.top < railRect.bottom;

  tab.getAnimations().forEach((animation) => animation.cancel());
  tab.style.transition = "none";
  tab.style.transform = "translate3d(0,0,0) scaleX(1)";
  tab.style.left = `${left}px`;
  tab.style.top = `${Math.round(cardRect.top + cardRect.height / 2 - height / 2)}px`;
  tab.style.width = `${Math.max(compact ? 40 : 54, Math.round(railRect.right + protrusion - left))}px`;
  tab.style.height = `${height}px`;
  tab.style.opacity = visible ? "1" : "0";
  tab.style.visibility = visible ? "visible" : "hidden";
}

function ensureRailScrollSync(rail: HTMLElement): void {
  if (railScrollSyncInstalled.has(rail)) return;
  railScrollSyncInstalled.add(rail);
  rail.addEventListener("scroll", () => {
    const tab = rail.querySelector<HTMLElement>(".sample-rail__active-tab");
    if (tab?.dataset.revealPending === "true") return;
    syncActiveMarkerGeometry(rail);
  }, { passive: true });
}

function restoreRailPosition(
  rail: HTMLElement,
  previousScrollTop: number,
  previousActiveSampleId: string | undefined
): void {
  ensureInstantRailScroll(rail);
  cancelSourceRailAnimations(rail);

  const nextActiveSampleId = rail.dataset.activeSampleId || undefined;
  if (!nextActiveSampleId || nextActiveSampleId === previousActiveSampleId) {
    rail.scrollTop = Math.max(0, Math.min(previousScrollTop, Math.max(0, rail.scrollHeight - rail.clientHeight)));
    ensureRailScrollSync(rail);
    syncActiveMarkerGeometry(rail);
    return;
  }

  const card = activeCard(rail);
  if (!card || rail.clientHeight <= 0) {
    rail.scrollTop = Math.max(0, Math.min(previousScrollTop, Math.max(0, rail.scrollHeight - rail.clientHeight)));
  } else {
    const maxScrollTop = Math.max(0, rail.scrollHeight - rail.clientHeight);
    rail.scrollTop = Math.max(0, Math.min(
      maxScrollTop,
      card.offsetTop + card.offsetHeight / 2 - rail.clientHeight / 2
    ));
  }
  ensureRailScrollSync(rail);
  syncActiveMarkerGeometry(rail);
}

function playHorizontalReveal(rail: HTMLElement): void {
  cancelSourceRailAnimations(rail);
  syncActiveMarkerGeometry(rail);

  const tab = rail.querySelector<HTMLElement>(".sample-rail__active-tab");
  const number = activeCard(rail)?.querySelector<HTMLElement>(".sample-rail__number");
  if (!tab || !number || tab.style.visibility === "hidden") return;

  delete tab.dataset.revealPending;
  delete number.dataset.revealPending;

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) return;

  // Final top/left/width/height are already locked. These keyframes change only X-axis
  // transform and opacity, so the gold marker cannot travel vertically.
  tab.animate(
    [
      { transform: "translate3d(-100%,0,0) scaleX(.06)", opacity: 0 },
      { transform: "translate3d(-10%,0,0) scaleX(.92)", opacity: .82, offset: .72 },
      { transform: "translate3d(0,0,0) scaleX(1)", opacity: 1 }
    ],
    { duration: 360, easing: "cubic-bezier(.18,.78,.2,1)", fill: "none" }
  );

  number.animate(
    [
      { transform: "translate3d(-24px,0,0) scale(.9)", opacity: 0 },
      { transform: "translate3d(2px,0,0) scale(1.04)", opacity: .9, offset: .78 },
      { transform: "translate3d(0,0,0) scale(1)", opacity: 1 }
    ],
    { duration: 300, delay: 70, easing: "cubic-bezier(.18,.78,.2,1)", fill: "none" }
  );
}

function queueHorizontalReveal(rail: HTMLElement, previousActiveSampleId: string | undefined): void {
  const nextActiveSampleId = rail.dataset.activeSampleId || undefined;
  if (!nextActiveSampleId || nextActiveSampleId === previousActiveSampleId) return;

  const tab = rail.querySelector<HTMLElement>(".sample-rail__active-tab");
  const number = activeCard(rail)?.querySelector<HTMLElement>(".sample-rail__number");
  if (!tab || !number) return;

  for (const node of rail.querySelectorAll<HTMLElement>(".sample-rail__number[data-reveal-pending]")) {
    delete node.dataset.revealPending;
  }
  const token = (revealTokens.get(rail) ?? 0) + 1;
  revealTokens.set(rail, token);
  tab.dataset.revealPending = "true";
  number.dataset.revealPending = "true";

  // Wait until the target sample has been scrolled into its final position and all
  // ResizeObserver callbacks from that layout have settled. No intermediate frame is visible.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (revealTokens.get(rail) !== token) return;
    playHorizontalReveal(rail);
  }));
}

function installPatch(): void {
  installStaticRailStyles();

  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;

  const originalRenderRail = prototype.renderRail;
  if (typeof originalRenderRail === "function") {
    prototype.renderRail = function(state: unknown): void {
      const beforeRail = this.root.querySelector<HTMLElement>(".cupping-layout__rail-list");
      const previousScrollTop = beforeRail?.scrollTop ?? 0;
      const previousActiveSampleId = beforeRail?.dataset.activeSampleId || undefined;

      originalRenderRail.call(this, state);

      const rail = this.root.querySelector<HTMLElement>(".cupping-layout__rail-list");
      if (!rail) return;
      restoreRailPosition(rail, previousScrollTop, previousActiveSampleId);
      queueHorizontalReveal(rail, previousActiveSampleId);
    };
  }

  const originalRender = prototype.render;
  prototype.render = async function(): Promise<void> {
    await originalRender.call(this);
    wireAdjacentNodeNavigation(this.root);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") installPatch();
