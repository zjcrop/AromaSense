const CENTER_POLL_INTERVAL_MS = 40;
const CENTER_POLL_TIMEOUT_MS = 3000;
const CENTER_SETTLE_DELAY_MS = 680;

let focusGeneration = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

export function centeredRailScrollTop(
  currentScrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
  cardTopWithinViewport: number,
  cardHeight: number
): number {
  const safeViewportHeight = Math.max(0, viewportHeight);
  const maximum = Math.max(0, scrollHeight - safeViewportHeight);
  const desired = currentScrollTop
    + cardTopWithinViewport
    + cardHeight / 2
    - safeViewportHeight / 2;
  return Math.min(maximum, Math.max(0, desired));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function railRoot(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(".cupping-layout__rail-list.sample-rail")
    ?? document.querySelector<HTMLElement>(".cupping-layout__rail-list")
    ?? undefined;
}

function activeCard(list: HTMLElement, sampleId: string): HTMLElement | undefined {
  return Array.from(list.querySelectorAll<HTMLElement>(".sample-rail__item"))
    .find((card) => card.dataset.sampleId === sampleId && card.classList.contains("is-active"));
}

function centerActiveCard(sampleId: string, behavior: ScrollBehavior): boolean {
  const list = railRoot();
  if (!list || list.dataset.activeSampleId !== sampleId) return false;
  const card = activeCard(list, sampleId);
  if (!card) return false;

  const viewportRect = list.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const target = centeredRailScrollTop(
    list.scrollTop,
    list.clientHeight,
    list.scrollHeight,
    cardRect.top - viewportRect.top,
    cardRect.height
  );
  list.scrollTo({ top: target, behavior });
  return true;
}

function scheduleActiveCardCenter(sampleId: string): void {
  const generation = ++focusGeneration;
  const startedAt = performance.now();
  if (pollTimer) clearTimeout(pollTimer);
  if (settleTimer) clearTimeout(settleTimer);

  const attempt = (): void => {
    if (generation !== focusGeneration) return;
    if (!centerActiveCard(sampleId, prefersReducedMotion() ? "auto" : "smooth")) {
      if (performance.now() - startedAt < CENTER_POLL_TIMEOUT_MS) {
        pollTimer = setTimeout(attempt, CENTER_POLL_INTERVAL_MS);
      }
      return;
    }

    // The selected card and rail can change geometry while activation or
    // compact/expanded transitions are running. Recalculate after the layout
    // settles so the final viewport follows the new geometry, not the old one.
    settleTimer = setTimeout(() => {
      if (generation === focusGeneration) centerActiveCard(sampleId, "auto");
    }, CENTER_SETTLE_DELAY_MS);
  };

  pollTimer = setTimeout(attempt, 0);
}

function sampleIdFromSelectionTarget(target: Element): string | undefined {
  const select = target.closest<HTMLElement>(".sample-rail__select");
  const card = select?.closest<HTMLElement>(".sample-rail__item");
  return card?.dataset.sampleId || undefined;
}

function currentActiveSampleId(): string | undefined {
  return railRoot()?.dataset.activeSampleId || undefined;
}

function scheduleCurrentActiveSample(): void {
  const activeSampleId = currentActiveSampleId();
  if (activeSampleId) scheduleActiveCardCenter(activeSampleId);
}

function handleCuppingRailClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;

  const sampleId = sampleIdFromSelectionTarget(event.target);
  if (sampleId) {
    scheduleActiveCardCenter(sampleId);
    return;
  }

  if (event.target.closest("[data-rail-toggle]")) scheduleCurrentActiveSample();
}

function handleMainPointerDown(event: PointerEvent): void {
  if (!(event.target instanceof Element)) return;
  const layout = event.target.closest<HTMLElement>(".cupping-layout");
  if (!layout || layout.classList.contains("is-rail-compact")) return;
  if (!event.target.closest(".cupping-layout__main")) return;

  // The product collapses an expanded rail when the user taps the main area.
  // Schedule against the current active id now; the delayed geometry pass runs
  // after that collapse render and keeps the same card centred in compact mode.
  scheduleCurrentActiveSample();
}

if (typeof document !== "undefined") {
  document.addEventListener("click", handleCuppingRailClick, true);
  document.addEventListener("pointerdown", handleMainPointerDown, true);
}
