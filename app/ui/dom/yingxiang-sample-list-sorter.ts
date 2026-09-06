import { attachDragReorder } from "./drag-reorder";

interface SampleEntry { id: string; code: string; }

function normalizedLines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.normalize("NFKC").trim()).filter(Boolean);
}

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-sample-sorter]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangSampleSorter = "true";
  style.textContent = `
    .yx-sample-sorter{display:grid;gap:7px;margin-top:9px}.yx-sample-sorter__hint{margin:0;color:#827c73;font-size:10.5px;line-height:1.45}
    .yx-sample-sorter__list{display:grid;gap:6px;touch-action:pan-y}.yx-sample-sorter__row{display:grid;grid-template-columns:38px minmax(0,1fr) 34px;gap:8px;align-items:center;min-height:46px;padding:5px 7px;border:1px solid rgba(185,153,90,.18);border-radius:8px;background:#121212;user-select:none}
    .yx-sample-sorter__index{display:grid;place-items:center;width:34px;height:34px;border-radius:6px;background:#1e1b15;color:#927d57;font:700 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace}.yx-sample-sorter__code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee7da;font:700 13px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace}.yx-sample-sorter__drag{display:grid;place-items:center;width:34px;height:34px;color:#9b8b70;cursor:grab;font-size:18px}
    .yx-sample-sorter.is-disabled{opacity:.58;pointer-events:none}
    .drag-reorder__placeholder{box-sizing:border-box;border:1px dashed rgba(214,173,99,.42)!important;border-radius:8px!important;background:rgba(214,173,99,.06)!important;transition:transform .16s ease,opacity .16s ease}.drag-reorder__ghost{position:fixed!important;z-index:5000!important;pointer-events:none!important;opacity:.88!important;box-shadow:0 12px 28px rgba(0,0,0,.42)!important}.drag-reorder--active{cursor:grabbing!important}
  `;
  document.head.append(style);
}

export class YingxiangSampleListSorter {
  private entries: SampleEntry[] = [];
  private readonly list = document.createElement("div");
  private detachDrag?: () => void;
  private disabled = false;
  private internalWrite = false;

  constructor(private readonly root: HTMLElement, private readonly target: HTMLTextAreaElement) {
    installStyles();
  }

  render(): void {
    this.root.replaceChildren();
    this.root.className = "yx-sample-sorter";
    this.list.className = "yx-sample-sorter__list";
    this.root.append(
      Object.assign(document.createElement("p"), {
        className: "yx-sample-sorter__hint",
        textContent: "样品只有这一份顺序。拖动右侧手柄调整杯测顺序；排序会直接回写上方编号列表。"
      }),
      this.list
    );
    this.target.addEventListener("input", this.handleTargetInput);
    this.syncFromTarget();
  }

  dispose(): void {
    this.detachDrag?.();
    this.detachDrag = undefined;
    this.target.removeEventListener("input", this.handleTargetInput);
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.root.classList.toggle("is-disabled", disabled);
    this.renderList();
  }

  private readonly handleTargetInput = () => {
    if (!this.internalWrite) this.syncFromTarget();
  };

  private syncFromTarget(): void {
    const codes = normalizedLines(this.target.value);
    const available = new Map<string, SampleEntry[]>();
    for (const entry of this.entries) {
      const queue = available.get(entry.code) ?? [];
      queue.push(entry);
      available.set(entry.code, queue);
    }
    this.entries = codes.map((code) => available.get(code)?.shift() ?? { id: crypto.randomUUID(), code });
    this.renderList();
  }

  private renderList(): void {
    this.detachDrag?.();
    this.detachDrag = undefined;
    this.list.replaceChildren();
    this.entries.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "yx-sample-sorter__row";
      row.dataset.sampleEntryId = entry.id;
      const ordinal = document.createElement("div");
      ordinal.className = "yx-sample-sorter__index";
      ordinal.textContent = String(index + 1).padStart(2, "0");
      const code = document.createElement("div");
      code.className = "yx-sample-sorter__code";
      code.textContent = entry.code;
      code.title = entry.code;
      const drag = document.createElement("div");
      drag.className = "yx-sample-sorter__drag";
      drag.dataset.dragHandle = "true";
      drag.textContent = "↕";
      drag.setAttribute("aria-label", `调整 ${entry.code} 顺序`);
      row.append(ordinal, code, drag);
      this.list.append(row);
    });
    if (!this.disabled && this.entries.length > 1) {
      this.detachDrag = attachDragReorder(this.list, {
        itemSelector: ".yx-sample-sorter__row",
        itemIdAttribute: "data-sample-entry-id",
        handleSelector: "[data-drag-handle]",
        onReorder: (orderedIds) => {
          const byId = new Map(this.entries.map((entry) => [entry.id, entry] as const));
          const next = orderedIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
          if (next.length !== this.entries.length) return;
          this.entries = next;
          this.internalWrite = true;
          this.target.value = this.entries.map((entry) => entry.code).join("\n");
          this.target.dispatchEvent(new Event("input", { bubbles: true }));
          this.internalWrite = false;
          this.renderList();
        }
      });
    }
  }
}
