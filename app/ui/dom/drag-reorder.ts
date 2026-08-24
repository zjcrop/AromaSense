export interface DragReorderOptions {
  itemSelector: string;
  itemIdAttribute: string;
  onReorder(orderedIds: readonly string[]): void | Promise<void>;
}

export function attachDragReorder(container: HTMLElement, options: DragReorderOptions): () => void {
  let dragging: HTMLElement | undefined;

  const onDragStart = (event: DragEvent): void => {
    const eventTarget = event.target as HTMLElement | null;
    const target = eventTarget?.closest<HTMLElement>(options.itemSelector);
    if (!target || target.parentElement !== container) return;

    // If a nested draggable (for example a flavor tag inside a draggable group)
    // originated the event, the outer reorder scope must ignore it.
    const nearestDraggable = eventTarget?.closest<HTMLElement>("[draggable='true']");
    if (nearestDraggable && nearestDraggable !== target) return;

    dragging = target;
    target.classList.add("is-dragging");
    event.dataTransfer?.setData("text/plain", target.getAttribute(options.itemIdAttribute) ?? "");
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (event: DragEvent): void => {
    if (!dragging) return;
    event.preventDefault();
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(options.itemSelector);
    if (!target || target === dragging || target.parentElement !== container) return;
    const rect = target.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    container.insertBefore(dragging, before ? target : target.nextSibling);
  };

  const finish = (): void => {
    if (!dragging) return;
    dragging.classList.remove("is-dragging");
    dragging = undefined;
    const orderedIds = [...container.querySelectorAll<HTMLElement>(options.itemSelector)]
      .filter((item) => item.parentElement === container)
      .map((item) => item.getAttribute(options.itemIdAttribute))
      .filter((id): id is string => Boolean(id));
    void options.onReorder(orderedIds);
  };

  container.addEventListener("dragstart", onDragStart);
  container.addEventListener("dragover", onDragOver);
  container.addEventListener("drop", finish);
  container.addEventListener("dragend", finish);

  return () => {
    container.removeEventListener("dragstart", onDragStart);
    container.removeEventListener("dragover", onDragOver);
    container.removeEventListener("drop", finish);
    container.removeEventListener("dragend", finish);
  };
}
