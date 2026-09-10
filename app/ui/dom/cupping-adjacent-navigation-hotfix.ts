import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const PATCH_FLAG = Symbol.for("aromasense.cupping.adjacent-navigation-hotfix.v2");
const STATIC_RAIL_STYLE_ID = "aromasense-static-sample-activation";
const railScrollSyncInstalled = new WeakSet<HTMLElement>();

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

  // Clone strips the old goPrevious/goNext listener. Those actions are workflow-gated;
  // the bottom triangle groups are pure adjacent-node navigation controls.
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
  `;
  document.head.append(style);
}

function cancelRailTransitionArtifacts(rail: HTMLElement): void {
  for (const node of rail.querySelectorAll<HTMLElement>(
    ".sample-rail__item,.sample-rail__number,.sample-rail__active-copy,.sample-rail__active-tab"
  )) {
    node.getAnimations().forEach((animation) => animation.cancel());
  }
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
    if (tab) tab.style.opacity = "0";
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
  tab.style.left = `${left}px`;
  tab.style.top = `${Math.round(cardRect.top + cardRect.height / 2 - height / 2)}px`;
  tab.style.width = `${Math.max(compact ? 40 : 54, Math.round(railRect.right + protrusion - left))}px`;
  tab.style.height = `${height}px`;
  tab.style.opacity = visible ? "1" : "0";
}

function ensureRailScrollSync(rail: HTMLElement): void {
  if (railScrollSyncInstalled.has(rail)) return;
  railScrollSyncInstalled.add(rail);
  rail.addEventListener("scroll", () => syncActiveMarkerGeometry(rail), { passive: true });
}

function settleRailVisualState(rail: HTMLElement): void {
  ensureRailScrollSync(rail);
  cancelRailTransitionArtifacts(rail);
  syncActiveMarkerGeometry(rail);
}

function restoreRailWithoutTopFlash(
  rail: HTMLElement,
  previousScrollTop: number,
  previousActiveSampleId: string | undefined
): void {
  cancelRailTransitionArtifacts(rail);

  const nextActiveSampleId = rail.dataset.activeSampleId || undefined;
  if (!nextActiveSampleId || nextActiveSampleId === previousActiveSampleId) {
    rail.scrollTop = Math.max(0, Math.min(previousScrollTop, Math.max(0, rail.scrollHeight - rail.clientHeight)));
    settleRailVisualState(rail);
    return;
  }

  const card = activeCard(rail);
  if (!card || rail.clientHeight <= 0) {
    rail.scrollTop = Math.max(0, Math.min(previousScrollTop, Math.max(0, rail.scrollHeight - rail.clientHeight)));
    settleRailVisualState(rail);
    return;
  }

  // Position the newly active sample synchronously. The active marker and enlarged
  // number are never animated from the old/top geometry; they appear only at their
  // final position in the same render turn.
  const maxScrollTop = Math.max(0, rail.scrollHeight - rail.clientHeight);
  const target = Math.max(0, Math.min(
    maxScrollTop,
    card.offsetTop + card.offsetHeight / 2 - rail.clientHeight / 2
  ));
  rail.scrollTop = target;
  settleRailVisualState(rail);
}

function installPrePaintAnimationGuard(): void {
  if (typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type !== "attributes" || record.attributeName !== "data-active-sample-id") continue;
      const rail = record.target;
      if (!(rail instanceof HTMLElement) || !rail.classList.contains("cupping-layout__rail-list")) continue;
      // MutationObserver runs before the next paint. Cancel Web Animations here so
      // no intermediate frame can show the marker/large number falling from the top.
      settleRailVisualState(rail);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-active-sample-id"]
  });
}

function installPatch(): void {
  installStaticRailStyles();
  installPrePaintAnimationGuard();

  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;

  // renderRail mutates the rail before the rest of render may await async data.
  // Preserve/position scroll and settle the active visuals here synchronously so an
  // intermediate browser paint cannot expose stale top-of-list activation geometry.
  const originalRenderRail = prototype.renderRail;
  if (typeof originalRenderRail === "function") {
    prototype.renderRail = function(state: unknown): void {
      const beforeRail = this.root.querySelector<HTMLElement>(".cupping-layout__rail-list");
      const previousScrollTop = beforeRail?.scrollTop ?? 0;
      const previousActiveSampleId = beforeRail?.dataset.activeSampleId || undefined;
      originalRenderRail.call(this, state);
      const rail = this.root.querySelector<HTMLElement>(".cupping-layout__rail-list");
      if (rail) restoreRailWithoutTopFlash(rail, previousScrollTop, previousActiveSampleId);
    };
  }

  const originalRender = prototype.render;
  prototype.render = async function(): Promise<void> {
    const beforeRail = this.root.querySelector<HTMLElement>(".cupping-layout__rail-list");
    const previousScrollTop = beforeRail?.scrollTop ?? 0;
    const previousActiveSampleId = beforeRail?.dataset.activeSampleId || undefined;

    await originalRender.call(this);

    const rail = this.root.querySelector<HTMLElement>(".cupping-layout__rail-list");
    if (rail) restoreRailWithoutTopFlash(rail, previousScrollTop, previousActiveSampleId);
    wireAdjacentNodeNavigation(this.root);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") installPatch();
