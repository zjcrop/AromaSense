export interface DragReorderOptions {
  itemSelector: string;
  itemIdAttribute: string;
  onReorder(orderedIds: readonly string[]): void | Promise<void>;
  handleSelector?: string;
  longPressMs?: number;
  movementCancelPx?: number;
  animationMs?: number;
  autoScrollEdgePx?: number;
}

interface DragState {
  source: HTMLElement;
  placeholder: HTMLElement;
  ghost: HTMLElement;
  pointerId: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  originalNextSibling: ChildNode | null;
  originalParent: HTMLElement;
  active: boolean;
  lastClientX: number;
  lastClientY: number;
}

function directItems(container: HTMLElement, options: Pick<DragReorderOptions, "itemSelector" | "itemIdAttribute">): HTMLElement[] {
  return [...container.children]
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((item) =>
      !item.classList.contains("drag-reorder__source-detached") &&
      (item.matches(options.itemSelector) || item.hasAttribute(options.itemIdAttribute))
    );
}

function resolveSource(container: HTMLElement, target: HTMLElement | null, options: DragReorderOptions): HTMLElement | undefined {
  let node: HTMLElement | null = target;
  while (node && node !== container) {
    if (node.parentElement === container &&
        (node.matches(options.itemSelector) || node.hasAttribute(options.itemIdAttribute))) {
      return node;
    }
    node = node.parentElement;
  }
  return undefined;
}

function orderedIds(container: HTMLElement, options: DragReorderOptions): string[] {
  return directItems(container, options)
    .map((item) => item.getAttribute(options.itemIdAttribute))
    .filter((id): id is string => Boolean(id));
}

function rectMap(container: HTMLElement, options: DragReorderOptions): Map<HTMLElement, DOMRect> {
  return new Map(directItems(container, options).map((item) => [item, item.getBoundingClientRect()] as const));
}

function animateFlip(before: Map<HTMLElement, DOMRect>, after: Map<HTMLElement, DOMRect>, duration: number): void {
  for (const [item, next] of after) {
    const previous = before.get(item);
    if (!previous) continue;
    const dx = previous.left - next.left;
    const dy = previous.top - next.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    item.animate?.(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration, easing: "cubic-bezier(.2,.7,.2,1)" }
    );
  }
}

function buildPlaceholder(source: HTMLElement): HTMLElement {
  const rect = source.getBoundingClientRect();
  const placeholder = document.createElement("div");
  placeholder.className = "drag-reorder__placeholder";
  placeholder.style.width = `${rect.width}px`;
  placeholder.style.height = `${rect.height}px`;
  placeholder.style.flex = getComputedStyle(source).flex;
  placeholder.setAttribute("aria-hidden", "true");
  return placeholder;
}

function buildGhost(source: HTMLElement): HTMLElement {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-reorder__ghost");
  ghost.removeAttribute("id");
  ghost.querySelectorAll<HTMLElement>("[id]").forEach((node) => node.removeAttribute("id"));
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.append(ghost);
  return ghost;
}

function moveGhost(state: DragState, clientX: number, clientY: number): void {
  state.lastClientX = clientX;
  state.lastClientY = clientY;
  state.ghost.style.left = `${clientX - state.pointerOffsetX}px`;
  state.ghost.style.top = `${clientY - state.pointerOffsetY}px`;
}

function nearestTarget(container: HTMLElement, options: DragReorderOptions, x: number, y: number): { item: HTMLElement; rect: DOMRect } | undefined {
  let best: { item: HTMLElement; rect: DOMRect; distance: number } | undefined;
  for (const item of directItems(container, options)) {
    const rect = item.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const distance = (x - cx) ** 2 + (y - cy) ** 2;
    if (!best || distance < best.distance) best = { item, rect, distance };
  }
  return best;
}

function movePlaceholder(
  container: HTMLElement,
  placeholder: HTMLElement,
  options: DragReorderOptions,
  x: number,
  y: number,
  animationMs: number
): void {
  const target = nearestTarget(container, options, x, y);
  if (!target) return;
  const beforeRects = rectMap(container, options);
  const sameRow = Math.abs(y - (target.rect.top + target.rect.height / 2)) < target.rect.height * 0.62;
  const beforeTarget = sameRow
    ? x < target.rect.left + target.rect.width / 2
    : y < target.rect.top + target.rect.height / 2;
  const anchor = beforeTarget ? target.item : target.item.nextSibling;
  if (anchor === placeholder || anchor === placeholder.nextSibling) return;
  container.insertBefore(placeholder, anchor);
  const afterRects = rectMap(container, options);
  animateFlip(beforeRects, afterRects, animationMs);
}

function scrollByPointer(container: HTMLElement, x: number, y: number, edge: number): void {
  const rect = container.getBoundingClientRect();
  const maxStep = 18;
  let dx = 0;
  let dy = 0;
  if (y < rect.top + edge) dy = -maxStep * Math.max(0, Math.min(1, (rect.top + edge - y) / edge));
  else if (y > rect.bottom - edge) dy = maxStep * Math.max(0, Math.min(1, (y - (rect.bottom - edge)) / edge));
  if (x < rect.left + edge) dx = -maxStep * Math.max(0, Math.min(1, (rect.left + edge - x) / edge));
  else if (x > rect.right - edge) dx = maxStep * Math.max(0, Math.min(1, (x - (rect.right - edge)) / edge));

  const canScrollY = container.scrollHeight > container.clientHeight + 2;
  const canScrollX = container.scrollWidth > container.clientWidth + 2;
  if (canScrollY || canScrollX) {
    container.scrollBy({ left: canScrollX ? dx : 0, top: canScrollY ? dy : 0, behavior: "auto" });
  } else if (dy !== 0) {
    window.scrollBy({ top: dy, behavior: "auto" });
  }
}

function handleMatches(source: HTMLElement, eventTarget: HTMLElement | null, options: DragReorderOptions): boolean {
  const selector = options.handleSelector ?? (source.querySelector("[data-drag-handle]") ? "[data-drag-handle]" : undefined);
  if (!selector) return true;
  const handle = eventTarget?.closest<HTMLElement>(selector);
  return Boolean(handle && source.contains(handle));
}

export function attachDragReorder(container: HTMLElement, options: DragReorderOptions): () => void {
  let state: DragState | undefined;
  let pointerCandidate: HTMLElement | undefined;
  let candidatePointerId: number | undefined;
  let candidateStartX = 0;
  let candidateStartY = 0;
  let longPressTimer: number | undefined;
  let autoScrollFrame: number | undefined;
  const longPressMs = options.longPressMs ?? 320;
  const movementCancelPx = options.movementCancelPx ?? 12;
  const animationMs = options.animationMs ?? 160;
  const autoScrollEdgePx = options.autoScrollEdgePx ?? 48;

  const stopAutoScroll = () => {
    if (autoScrollFrame !== undefined) cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = undefined;
  };

  const runAutoScroll = () => {
    if (!state?.active) return;
    scrollByPointer(container, state.lastClientX, state.lastClientY, autoScrollEdgePx);
    movePlaceholder(container, state.placeholder, options, state.lastClientX, state.lastClientY, animationMs);
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  };

  const clearPending = () => {
    if (longPressTimer !== undefined) clearTimeout(longPressTimer);
    longPressTimer = undefined;
    pointerCandidate = undefined;
    candidatePointerId = undefined;
  };

  const restoreSource = (drag: DragState, cancelled: boolean) => {
    drag.ghost.remove();
    drag.placeholder.remove();
    drag.source.classList.remove("drag-reorder__source-detached", "is-dragging");
    drag.source.removeAttribute("aria-grabbed");
    if (cancelled) {
      if (drag.originalNextSibling && drag.originalNextSibling.parentNode === drag.originalParent) {
        drag.originalParent.insertBefore(drag.source, drag.originalNextSibling);
      } else {
        drag.originalParent.append(drag.source);
      }
    }
  };

  const activate = (source: HTMLElement, event: PointerEvent) => {
    const rect = source.getBoundingClientRect();
    const placeholder = buildPlaceholder(source);
    const ghost = buildGhost(source);
    const originalNextSibling = source.nextSibling;
    const originalParent = source.parentElement;
    if (!originalParent) return;
    originalParent.insertBefore(placeholder, source);
    source.remove();
    source.classList.add("drag-reorder__source-detached", "is-dragging");
    source.setAttribute("aria-grabbed", "true");
    container.classList.add("is-reordering");
    document.body.classList.add("drag-reorder--active");
    state = {
      source,
      placeholder,
      ghost,
      pointerId: event.pointerId,
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top,
      originalNextSibling,
      originalParent,
      active: true,
      lastClientX: event.clientX,
      lastClientY: event.clientY
    };
    moveGhost(state, event.clientX, event.clientY);
    navigator.vibrate?.(10);
    try { container.setPointerCapture(event.pointerId); } catch { /* browser may already own capture */ }
    stopAutoScroll();
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  };

  const finish = (event: PointerEvent, cancelled: boolean) => {
    clearPending();
    stopAutoScroll();
    const drag = state;
    state = undefined;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    try { container.releasePointerCapture(event.pointerId); } catch { /* no active capture */ }
    if (!cancelled) {
      drag.placeholder.replaceWith(drag.source);
      drag.ghost.remove();
      drag.source.classList.remove("drag-reorder__source-detached", "is-dragging");
      drag.source.removeAttribute("aria-grabbed");
      drag.source.dataset.dragSuppressClick = "1";
      window.setTimeout(() => { delete drag.source.dataset.dragSuppressClick; }, 420);
      void options.onReorder(orderedIds(container, options));
    } else {
      restoreSource(drag, true);
    }
    container.classList.remove("is-reordering");
    document.body.classList.remove("drag-reorder--active");
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const eventTarget = event.target as HTMLElement | null;
    const source = resolveSource(container, eventTarget, options);
    if (!source || !handleMatches(source, eventTarget, options)) return;

    clearPending();
    candidatePointerId = event.pointerId;
    pointerCandidate = source;
    candidateStartX = event.clientX;
    candidateStartY = event.clientY;

    const activateNow = event.pointerType === "mouse";
    if (activateNow) {
      event.preventDefault();
      activate(source, event);
      return;
    }
    longPressTimer = window.setTimeout(() => {
      if (pointerCandidate === source && candidatePointerId === event.pointerId) activate(source, event);
    }, longPressMs);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (state?.pointerId === event.pointerId) {
      event.preventDefault();
      moveGhost(state, event.clientX, event.clientY);
      movePlaceholder(container, state.placeholder, options, event.clientX, event.clientY, animationMs);
      return;
    }
    if (candidatePointerId !== event.pointerId || !pointerCandidate) return;
    if (Math.hypot(event.clientX - candidateStartX, event.clientY - candidateStartY) > movementCancelPx) clearPending();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (state?.pointerId === event.pointerId) finish(event, false);
    else if (candidatePointerId === event.pointerId) clearPending();
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (state?.pointerId === event.pointerId) finish(event, true);
    else if (candidatePointerId === event.pointerId) clearPending();
  };

  const onClickCapture = (event: MouseEvent) => {
    const source = resolveSource(container, event.target as HTMLElement | null, options);
    if (source?.dataset.dragSuppressClick === "1") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove, { passive: false });
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);
  container.addEventListener("click", onClickCapture, true);

  return () => {
    clearPending();
    stopAutoScroll();
    if (state) {
      const drag = state;
      state = undefined;
      restoreSource(drag, true);
      container.classList.remove("is-reordering");
      document.body.classList.remove("drag-reorder--active");
    }
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerCancel);
    container.removeEventListener("click", onClickCapture, true);
  };
}
