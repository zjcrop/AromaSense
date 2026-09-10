import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const PATCH_FLAG = Symbol.for("aromasense.cupping.adjacent-navigation-hotfix.v1");

interface RendererInternals {
  root: HTMLElement;
}

interface RendererPrototype {
  [PATCH_FLAG]?: boolean;
  render(this: RendererInternals): Promise<void>;
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

  // Clone strips the old goPrevious/goNext listener. Those controller actions are
  // workflow-gated and therefore are the wrong semantic for the bottom node arrows.
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

function restoreRailWithoutTopFlash(
  rail: HTMLElement,
  previousScrollTop: number,
  previousActiveSampleId: string | undefined
): void {
  cancelRailTransitionArtifacts(rail);

  const nextActiveSampleId = rail.dataset.activeSampleId || undefined;
  if (!nextActiveSampleId || nextActiveSampleId === previousActiveSampleId) {
    rail.scrollTop = Math.max(0, Math.min(previousScrollTop, rail.scrollHeight - rail.clientHeight));
    return;
  }

  const card = activeCard(rail);
  if (!card || rail.clientHeight <= 0) {
    rail.scrollTop = Math.max(0, Math.min(previousScrollTop, rail.scrollHeight - rail.clientHeight));
    return;
  }

  // Position in the same render turn, before the browser paints. This avoids the
  // previous two-frame sequence where the list could visibly flash at sample 01.
  const maxScrollTop = Math.max(0, rail.scrollHeight - rail.clientHeight);
  const target = Math.max(0, Math.min(
    maxScrollTop,
    card.offsetTop + card.offsetHeight / 2 - rail.clientHeight / 2
  ));
  rail.scrollTop = target;
}

function installPatch(): void {
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;

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
