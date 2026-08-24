export interface DragReorderOptions {
  itemSelector: string;
  itemIdAttribute: string;
  onReorder(orderedIds: readonly string[]): void | Promise<void>;
  longPressMs?: number;
}

function orderedIds(container: HTMLElement, options: DragReorderOptions): string[] {
  return [...container.querySelectorAll<HTMLElement>(options.itemSelector)]
    .filter((item) => item.parentElement === container)
    .map((item) => item.getAttribute(options.itemIdAttribute))
    .filter((id): id is string => Boolean(id));
}

function moveAgainstPointer(container: HTMLElement, dragging: HTMLElement, x: number, y: number, selector: string): void {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = hit?.closest<HTMLElement>(selector);
  if (!target || target === dragging || target.parentElement !== container) return;
  const rect = target.getBoundingClientRect();
  const vertical = container.scrollHeight >= container.scrollWidth;
  const before = vertical
    ? y < rect.top + rect.height / 2
    : x < rect.left + rect.width / 2;
  container.insertBefore(dragging, before ? target : target.nextSibling);
}

export function attachDragReorder(container: HTMLElement, options: DragReorderOptions): () => void {
  let dragging: HTMLElement | undefined;
  let pointerId: number | undefined;
  let longPressTimer: number | undefined;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerCandidate: HTMLElement | undefined;
  const longPressMs = options.longPressMs ?? 350;

  const begin = (target: HTMLElement): void => {
    dragging = target;
    target.classList.add("is-dragging");
    container.classList.add("is-reordering");
  };

  const finish = (): void => {
    if (longPressTimer !== undefined) {
      window.clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
    pointerCandidate = undefined;
    pointerId = undefined;
    if (!dragging) return;
    dragging.classList.remove("is-dragging");
    dragging = undefined;
    container.classList.remove("is-reordering");
    void options.onReorder(orderedIds(container, options));
  };

  const cancelCandidate = (): void => {
    if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
    pointerCandidate = undefined;
    pointerId = undefined;
  };

  const onDragStart = (event: DragEvent): void => {
    const eventTarget = event.target as HTMLElement | null;
    const target = eventTarget?.closest<HTMLElement>(options.itemSelector);
    if (!target || target.parentElement !== container) return;
    const nearestDraggable = eventTarget?.closest<HTMLElement>("[draggable='true']");
    if (nearestDraggable && nearestDraggable !== target) return;
    begin(target);
    event.dataTransfer?.setData("text/plain", target.getAttribute(options.itemIdAttribute) ?? "");
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (event: DragEvent): void => {
    if (!dragging) return;
    event.preventDefault();
    moveAgainstPointer(container, dragging, event.clientX, event.clientY, options.itemSelector);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" || event.button !== 0) return;
    const eventTarget = event.target as HTMLElement | null;
    const target = eventTarget?.closest<HTMLElement>(options.itemSelector);
    if (!target || target.parentElement !== container) return;

    // Nested reorder scopes own their nearest item and must not activate an outer scope.
    const nestedItem = eventTarget?.closest<HTMLElement>("[data-descriptor-id], [data-group-id], [data-sample-id]");
    if (nestedItem && nestedItem !== target && nestedItem.parentElement !== container) return;

    pointerId = event.pointerId;
    pointerCandidate = target;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    longPressTimer = window.setTimeout(() => {
      if (pointerCandidate && pointerId === event.pointerId) {
        begin(pointerCandidate);
        try { container.setPointerCapture(event.pointerId); } catch { /* WebView may already own capture. */ }
      }
    }, longPressMs);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    if (!dragging) {
      const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);
      if (distance > 10) cancelCandidate();
      return;
    }
    event.preventDefault();
    moveAgainstPointer(container, dragging, event.clientX, event.clientY, options.itemSelector);
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    if (dragging) {
      event.preventDefault();
      try { container.releasePointerCapture(event.pointerId); } catch { /* no active capture */ }
      finish();
    } else {
      cancelCandidate();
    }
  };

  container.addEventListener("dragstart", onDragStart);
  container.addEventListener("dragover", onDragOver);
  container.addEventListener("drop", finish);
  container.addEventListener("dragend", finish);
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove, { passive: false });
  container.addEventListener("pointerup", onPointerEnd);
  container.addEventListener("pointercancel", onPointerEnd);

  return () => {
    cancelCandidate();
    container.removeEventListener("dragstart", onDragStart);
    container.removeEventListener("dragover", onDragOver);
    container.removeEventListener("drop", finish);
    container.removeEventListener("dragend", finish);
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerEnd);
    container.removeEventListener("pointercancel", onPointerEnd);
  };
}
