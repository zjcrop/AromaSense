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

  if (Math.abs(target - root.scrollTop) < 1) return;
  root.scrollTo({
    top: target,
    behavior: prefersReducedMotion() ? "auto" : "smooth"
  });
}

function scheduleActiveSampleAlignment(root: HTMLElement): void {
  const existing = pendingFrames.get(root);
  if (existing !== undefined) cancelAnimationFrame(existing);
  // Wait one layout frame: compact/expanded transitions alter rail/card widths
  // and can also change active-card height before the final geometry settles.
  const frame = requestAnimationFrame(() => {
    const settleFrame = requestAnimationFrame(() => alignActiveSample(root));
    pendingFrames.set(root, settleFrame);
  });
  pendingFrames.set(root, frame);
}

function railFromLayout(layout: HTMLElement): HTMLElement | undefined {
  return layout.querySelector<HTMLElement>(".cupping-layout__rail-list.sample-rail") ?? undefined;
}

function installActiveSampleScrollObserver(): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;

  const observer = new MutationObserver((records) => {
    const roots = new Set<HTMLElement>();
    for (const record of records) {
      if (record.type !== "attributes" || !(record.target instanceof HTMLElement)) continue;

      if (record.attributeName === "data-active-sample-id") {
        const root = record.target;
        if (!root.classList.contains("cupping-layout__rail-list")) continue;
        const current = root.dataset.activeSampleId ?? null;
        if (record.oldValue === current) continue;
        roots.add(root);
        continue;
      }

      if (record.attributeName === "class") {
        const target = record.target;
        if (target.classList.contains("cupping-layout")) {
          const root = railFromLayout(target);
          if (root) roots.add(root);
        } else if (target.classList.contains("cupping-layout__rail-list")) {
          roots.add(target);
        }
      }
    }
    for (const root of roots) scheduleActiveSampleAlignment(root);
  });

  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["data-active-sample-id", "class"]
  });
}

installActiveSampleScrollObserver();
