import QRCode from "qrcode";
import type { SessionRecordSummary } from "../../storage/session-records-reader";
import { button, clearElement, element } from "./dom-helpers";

export interface SessionRecordsRendererOptions {
  records: readonly SessionRecordSummary[];
  onBack(): void | Promise<void>;
  onOpen(sessionId: string, readOnly: boolean): void | Promise<void>;
  onDelete(sessionIds: readonly string[]): void | Promise<void>;
  onSync(sessionIds: readonly string[]): void | Promise<void>;
  onShare(sessionId: string): Promise<string>;
  onExport(sessionId: string): void | Promise<void>;
  loadOrder?(): Promise<readonly string[] | undefined>;
  saveOrder?(ids: readonly string[]): void | Promise<void>;
}

type FilterKey = "all" | "date" | "organizer" | "participants" | "target" | "eventName";
type GroupKey = "none" | "date" | "organizer" | "participants" | "target" | "eventName";

const FILTER_LABELS: Record<Exclude<FilterKey, "all">, string> = {
  date: "日期", organizer: "组织方", participants: "参与对象", target: "杯测目标", eventName: "杯测会名称"
};
const MOVE_THRESHOLD_PX = 10;
const LONG_PRESS_DELETE_MS = 650;

function includes(value: unknown, query: string): boolean {
  return String(value ?? "").toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN"));
}

function statusLabel(record: SessionRecordSummary): string {
  if (record.syncState === "synced") return "已同步";
  if (record.syncState === "failed") return "同步失败";
  return navigator.onLine ? "待同步" : "离线测评待同步";
}

function groupValue(record: SessionRecordSummary, key: GroupKey): string {
  if (key === "none") return "全部记录";
  const value = record.metadata[key];
  return String(value ?? "未标注").trim() || "未标注";
}

function actionButton(className: string, label: string, action: () => unknown): HTMLButtonElement {
  const node = button(className, label, action);
  node.addEventListener("pointerdown", (event) => event.stopPropagation());
  node.addEventListener("pointerup", (event) => event.stopPropagation());
  return node;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export class SessionRecordsRenderer {
  private management = false;
  private filterKey: FilterKey = "all";
  private filterText = "";
  private groupKey: GroupKey = "none";
  private readonly selected = new Set<string>();
  private ordered: SessionRecordSummary[] = [];

  constructor(private readonly root: HTMLElement, private readonly options: SessionRecordsRendererOptions) {}

  async render(): Promise<void> {
    clearElement(this.root);
    this.root.classList.add("session-records");
    this.ordered = await this.applySavedOrder([...this.options.records]);

    const header = element("header", "session-records__header");
    header.append(
      button("session-records__back", "返回", () => this.options.onBack()),
      element("h1", "session-records__title", "杯测记录"),
      element("span", "session-records__version", "0.1C")
    );
    this.root.append(header, this.renderToolbar());

    const controls = this.renderFilterAndGroupControls();
    if (controls.childElementCount) this.root.append(controls);

    const list = element("div", "session-records__list");
    const filtered = this.filteredRecords();
    if (!filtered.length) list.append(element("p", "session-records__empty", "没有符合条件的杯测记录。"));
    else if (this.groupKey === "none") for (const record of filtered) list.append(this.renderRecord(record));
    else {
      const groups = new Map<string, SessionRecordSummary[]>();
      for (const record of filtered) {
        const key = groupValue(record, this.groupKey);
        const group = groups.get(key) ?? [];
        group.push(record);
        groups.set(key, group);
      }
      for (const [label, records] of groups) list.append(this.renderGroup(label, records));
    }
    this.root.append(list);

    if (this.management) {
      const batch = element("footer", "session-records__batch");
      batch.append(
        button("session-records__batch-action", "全选", () => { for (const record of filtered) this.selected.add(record.sessionId); void this.render(); }),
        button("session-records__batch-action", "取消选择", () => { this.selected.clear(); void this.render(); }),
        button("session-records__batch-action", "立即同步", () => this.syncSelected()),
        button("session-records__batch-action is-danger", "删除", () => this.deleteSelected())
      );
      this.root.append(batch);
    }
  }

  private async applySavedOrder(records: SessionRecordSummary[]): Promise<SessionRecordSummary[]> {
    const order = await this.options.loadOrder?.();
    if (!order?.length) return records;
    const rank = new Map(order.map((id, index) => [id, index] as const));
    return records.sort((a, b) =>
      (rank.get(a.sessionId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.sessionId) ?? Number.MAX_SAFE_INTEGER)
      || b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  private renderToolbar(): HTMLElement {
    const toolbar = element("nav", "session-records__toolbar");
    toolbar.append(
      button("session-records__tool", "筛选", () => {
        this.filterKey = this.filterKey === "all" ? "date" : "all";
        if (this.filterKey === "all") this.filterText = "";
        void this.render();
      }),
      button(`session-records__tool${this.management ? " is-active" : ""}`, "管理", () => {
        this.management = !this.management;
        if (!this.management) this.selected.clear();
        void this.render();
      }),
      button("session-records__tool", "分组", () => {
        this.groupKey = this.groupKey === "none" ? "date" : "none";
        void this.render();
      })
    );
    return toolbar;
  }

  private renderFilterAndGroupControls(): HTMLElement {
    const panel = element("section", "session-records__controls");
    if (this.filterKey !== "all") {
      const select = element("select", "session-records__select");
      for (const key of Object.keys(FILTER_LABELS) as Exclude<FilterKey, "all">[]) {
        const option = element("option", "", FILTER_LABELS[key]);
        option.value = key;
        option.selected = key === this.filterKey;
        select.append(option);
      }
      select.addEventListener("change", () => { this.filterKey = select.value as FilterKey; void this.render(); });
      const input = element("input", "session-records__filter");
      input.type = "search";
      input.placeholder = "输入筛选关键词";
      input.value = this.filterText;
      input.addEventListener("input", () => { this.filterText = input.value; void this.render(); });
      panel.append(select, input);
    }
    if (this.groupKey !== "none") {
      const select = element("select", "session-records__select");
      for (const key of Object.keys(FILTER_LABELS) as Exclude<GroupKey, "none">[]) {
        const option = element("option", "", `按${FILTER_LABELS[key]}分组`);
        option.value = key;
        option.selected = key === this.groupKey;
        select.append(option);
      }
      select.addEventListener("change", () => { this.groupKey = select.value as GroupKey; void this.render(); });
      panel.append(select);
    }
    return panel;
  }

  private filteredRecords(): SessionRecordSummary[] {
    if (this.filterKey === "all" || !this.filterText.trim()) return [...this.ordered];
    const query = this.filterText.trim();
    return this.ordered.filter((record) => includes(record.metadata[this.filterKey as keyof typeof record.metadata], query));
  }

  private renderGroup(label: string, records: readonly SessionRecordSummary[]): HTMLElement {
    const group = element("section", "session-record-group");
    const head = element("header", "session-record-group__header");
    if (this.management) {
      const check = element("input", "session-record-group__check");
      check.type = "checkbox";
      check.checked = records.every((record) => this.selected.has(record.sessionId));
      check.addEventListener("change", () => {
        for (const record of records) check.checked ? this.selected.add(record.sessionId) : this.selected.delete(record.sessionId);
        void this.render();
      });
      head.append(check);
    }
    head.append(element("strong", "session-record-group__title", label), element("span", "session-record-group__count", `${records.length} 条`));
    group.append(head);
    for (const record of records) group.append(this.renderRecord(record));
    return group;
  }

  private renderRecord(record: SessionRecordSummary): HTMLElement {
    const row = element("article", "session-record");
    row.dataset.sessionId = record.sessionId;
    if (this.selected.has(record.sessionId)) row.classList.add("is-selected");

    if (this.management) {
      const check = element("input", "session-record__check");
      check.type = "checkbox";
      check.checked = this.selected.has(record.sessionId);
      check.addEventListener("change", () => {
        check.checked ? this.selected.add(record.sessionId) : this.selected.delete(record.sessionId);
        void this.render();
      });
      row.append(check);
    }

    const content = element("div", "session-record__content");
    const first = element("div", "session-record__line session-record__line--primary");
    const left = element("div", "session-record__identity");
    left.append(element("span", "session-record__date", record.metadata.date), element("strong", "session-record__name", record.displayName));
    const right = element("div", "session-record__actions");
    const dot = element("span", `session-record__sync-dot is-${record.syncState}`);
    dot.title = statusLabel(record);
    right.append(
      dot,
      actionButton("session-record__action", "分享", () => this.share(record.sessionId)),
      actionButton("session-record__action", "导出", () => this.options.onExport(record.sessionId)),
      actionButton("session-record__action", "删除", () => this.deleteRecords([record.sessionId]))
    );
    first.append(left, right);

    const second = element("div", "session-record__line session-record__line--secondary");
    second.append(
      element("span", "session-record__meta", `${record.sampleCount} 个样品`),
      element("span", "session-record__meta", `完成度 ${record.completionPct}%`),
      element("span", "session-record__meta", `可置信度 ${record.completenessPct}%`)
    );
    second.title = "可置信度按已填写项目占全部应填写项目的比例计算，内部字段为 dataCompleteness。";
    content.append(first, second);
    row.append(content);

    this.attachRowInteraction(row, record);
    return row;
  }

  private attachRowInteraction(row: HTMLElement, record: SessionRecordSummary): void {
    let startX = 0;
    let startY = 0;
    let moved = false;
    let dragging = false;
    let pointerId = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cancelTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const list = () => row.parentElement;

    row.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button,input,select,textarea")) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      moved = false;
      dragging = false;
      if (!this.management) {
        timer = setTimeout(() => {
          if (!moved) void this.deleteRecords([record.sessionId]);
        }, LONG_PRESS_DELETE_MS);
      }
      try { row.setPointerCapture(event.pointerId); } catch { /* optional */ }
    });

    row.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (distance <= MOVE_THRESHOLD_PX) return;
      moved = true;
      cancelTimer();
      if (!this.management || this.groupKey !== "none") return;
      dragging = true;
      row.classList.add("is-dragging");
      const container = list();
      if (!container) return;
      const siblings = [...container.querySelectorAll<HTMLElement>(":scope > .session-record")].filter((item) => item !== row);
      const target = siblings.find((item) => {
        const rect = item.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
      });
      if (target) container.insertBefore(row, target);
      else container.append(row);
      event.preventDefault();
    }, { passive: false });

    row.addEventListener("pointerup", (event) => {
      if (pointerId !== event.pointerId) return;
      cancelTimer();
      try { row.releasePointerCapture(event.pointerId); } catch { /* optional */ }
      pointerId = -1;
      if (dragging) {
        row.classList.remove("is-dragging");
        const container = list();
        const ids = container
          ? [...container.querySelectorAll<HTMLElement>(":scope > .session-record")].map((item) => item.dataset.sessionId ?? "").filter(Boolean)
          : [];
        if (ids.length) void this.options.saveOrder?.(ids);
        return;
      }
      if (moved || (event.target as HTMLElement).closest("button,input,select,textarea")) return;
      if (this.management) {
        this.selected.has(record.sessionId) ? this.selected.delete(record.sessionId) : this.selected.add(record.sessionId);
        void this.render();
      } else {
        void this.options.onOpen(record.sessionId, record.status === "completed" || record.status === "archived");
      }
    });

    row.addEventListener("pointercancel", (event) => {
      if (pointerId !== event.pointerId) return;
      cancelTimer();
      row.classList.remove("is-dragging");
      pointerId = -1;
    });
  }

  private async share(sessionId: string): Promise<void> {
    try {
      const link = await this.options.onShare(sessionId);
      const overlay = element("div", "session-share");
      const card = element("section", "session-share__card");
      card.append(element("h2", "session-share__title", "分享杯测"));
      const input = element("input", "session-share__link");
      input.readOnly = true;
      input.value = link;
      const qr = element("img", "session-share__qr");
      qr.alt = "杯测分享二维码";
      qr.src = await QRCode.toDataURL(link, { width: 320, margin: 2 });
      const actions = element("div", "session-share__actions");
      actions.append(
        button("session-share__action", "复制链接", async () => { await copyText(link); }),
        button("session-share__action", "关闭", () => overlay.remove())
      );
      card.append(input, qr, actions);
      overlay.append(card);
      this.root.append(overlay);
    } catch (error) {
      window.alert(`分享失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async deleteRecords(ids: readonly string[]): Promise<void> {
    if (!ids.length || !window.confirm(`删除 ${ids.length} 条杯测记录？`)) return;
    await this.options.onDelete(ids);
    for (const id of ids) this.selected.delete(id);
  }

  private async deleteSelected(): Promise<void> { await this.deleteRecords([...this.selected]); }
  private async syncSelected(): Promise<void> {
    const ids = [...this.selected];
    if (!ids.length) return;
    await this.options.onSync(ids);
    this.selected.clear();
  }
}
