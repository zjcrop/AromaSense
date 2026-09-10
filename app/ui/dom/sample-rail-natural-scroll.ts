const pendingFrames = new WeakMap<HTMLElement, number>();

export interface ActiveSampleScrollGeometry {
  scrollTop: number;
  scrollHeight: number;
  viewportTop: number;
  viewportHeight: number;
  cardTop: number;
  cardHeight: number;
}

export function activeSampleScrollTarget(geometry: ActiveSampleScrollGeometry): number {
  const maxScrollTop = Math.max(0, geometry.scrollHeight - geometry.viewportHeight);
  const desired = geometry.scrollTop
    + (geometry.cardTop + geometry.cardHeight / 2)
    - (geometry.viewportTop + geometry.viewportHeight / 2);
  return Math.min(maxScrollTop, Math.max(0, desired));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function directActiveCard(root: HTMLElement): HTMLElement | undefined {
  return [...root.children].find((node): node is HTMLElement =>
    node instanceof HTMLElement
      && node.classList.contains("sample-rail__item")
      && node.classList.contains("is-active")
  );
}

function installNaturalRailStyles(): void {
  if (document.head.querySelector("style[data-aromasense-natural-rail-scroll]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseNaturalRailScroll = "true";
  style.textContent = `
    .cupping-layout__rail-list.sample-rail{
      scroll-behavior:auto!important;
      overflow-anchor:none!important;
    }
  `;
  document.head.append(style);
}

function alignActiveSample(root: HTMLElement): void {
  pendingFrames.delete(root);
  const card = directActiveCard(root);
  if (!card || root.clientHeight <= 0) return;

  const viewport = root.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const target = activeSampleScrollTarget({
    scrollTop: root.scrollTop,
    scrollHeight: root.scrollHeight,
    viewportTop: viewport.top,
    viewportHeight: root.clientHeight,
    cardTop: cardRect.top,
    cardHeight: cardRect.height
  });

  const delta = Math.abs(target - root.scrollTop);
  if (delta < 1) return;

  // Only the active sample changing is allowed to move the rail. Nearby changes
  // glide from the current viewport; long jumps locate immediately instead of
  // visually scanning through every sample number on the way to the target.
  const longJump = delta > root.clientHeight * 0.9;
  root.scrollTo({
    top: target,
    behavior: prefersReducedMotion() || longJump ? "auto" : "smooth"
  });
}

function scheduleActiveSampleAlignment(root: HTMLElement): void {
  const existing = pendingFrames.get(root);
  if (existing !== undefined) cancelAnimationFrame(existing);
  const frame = requestAnimationFrame(() => {
    const settleFrame = requestAnimationFrame(() => alignActiveSample(root));
    pendingFrames.set(root, settleFrame);
  });
  pendingFrames.set(root, frame);
}

function installNaturalActiveSampleScrollObserver(): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  installNaturalRailStyles();

  const observer = new MutationObserver((records) => {
    const roots = new Set<HTMLElement>();
    for (const record of records) {
      if (record.type !== "attributes" || record.attributeName !== "data-active-sample-id") continue;
      if (!(record.target instanceof HTMLElement)) continue;
      const root = record.target;
      if (!root.classList.contains("cupping-layout__rail-list")) continue;
      const current = root.dataset.activeSampleId ?? null;
      if (record.oldValue === current) continue;
      roots.add(root);
    }
    for (const root of roots) scheduleActiveSampleAlignment(root);
  });

  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["data-active-sample-id"]
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installNaturalActiveSampleScrollObserver();
}
