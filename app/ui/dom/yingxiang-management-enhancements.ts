import { YingxiangConsoleRenderer } from "./yingxiang-console-renderer";
import type { YingxiangRemoteEvent } from "../../core/yingxiang-client";

interface ManagementState {
  enabled: boolean;
  statusFilter: string;
  query: string;
  selected: Set<string>;
}

interface ConsoleRuntime {
  root: HTMLElement;
  client?: {
    listEvents(): Promise<YingxiangRemoteEvent[]>;
    cancelEvent(eventId: string): Promise<unknown>;
    deleteEvent(eventId: string): Promise<unknown>;
    createEvent(input: { title: string; policy: YingxiangRemoteEvent["policy"]; manifest: YingxiangRemoteEvent["manifest"]; publish?: boolean }): Promise<YingxiangRemoteEvent>;
  };
  showEvents(): Promise<void>;
}

const states = new WeakMap<object, ManagementState>();
const INSTALL_KEY = "__aromasenseYingxiangManagementInstalled";

function stateFor(instance: object): ManagementState {
  let state = states.get(instance);
  if (!state) {
    state = { enabled: false, statusFilter: "all", query: "", selected: new Set() };
    states.set(instance, state);
  }
  return state;
}

function makeButton(label: string, className = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  return button;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-management-enhancements]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangManagementEnhancements = "true";
  style.textContent = `
    .yx-management-toolbar{display:grid;gap:9px;padding:12px;border:1px solid rgba(214,173,99,.24);border-radius:10px;background:#111}
    .yx-management-toolbar[hidden]{display:none!important}
    .yx-management-filter{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(130px,.7fr);gap:8px}
    .yx-management-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .yx-management-toolbar input,.yx-management-toolbar select{min-height:40px!important}
    .yx-management-status{min-height:16px;color:#9f988d;font-size:11px;line-height:1.45}
    .yx-event-management-head{display:flex;gap:9px;align-items:flex-start}
    .yx-event-management-check{width:20px!important;min-width:20px!important;min-height:20px!important;margin:2px 0 0!important;accent-color:#d6ad63}
    .yx-event-management-title{flex:1;min-width:0}
    .yx-event-management-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:5px}
    .yx-event-management-actions button{min-height:36px!important;padding:6px 10px!important;font-size:12px!important}
    .yx-console.is-management-mode>section{border-color:rgba(214,173,99,.24)}
    .yx-console.is-management-mode>section.is-selected{box-shadow:inset 3px 0 0 #d6ad63;background:#191713}
    .yx-console .yx-manage-entry{color:#111!important;background:#d6ad63!important;border-color:#d6ad63!important;font-weight:800!important}
    .yx-console .yx-manage-entry.is-active{background:#e0bd78!important}
    .yx-console .yx-management-delete{background:#d6ad63!important;border:0!important;color:#111!important;font-weight:800!important}
    .yx-console .yx-management-clone{border-color:rgba(214,173,99,.5)!important;color:#e6cf9f!important}
    .yx-coffee-editor__list{gap:10px!important}
    .yx-coffee-card{grid-template-columns:48px minmax(0,1fr) 28px!important;min-height:68px!important;padding:10px!important;gap:11px!important;border-radius:10px!important}
    .yx-coffee-card__slot{width:48px!important;height:48px!important;min-width:48px!important;max-width:48px!important;font-size:11px!important;border-radius:8px!important}
    .yx-coffee-card__title{font-size:14px!important;line-height:1.35!important;white-space:normal!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .yx-coffee-card__detail{margin-top:4px!important;font-size:11px!important;line-height:1.45!important;white-space:normal!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .yx-coffee-card__drag{width:28px!important;font-size:18px!important}
    @media(max-width:620px){
      .yx-management-filter,.yx-management-actions{grid-template-columns:1fr!important}
      .yx-coffee-card{grid-template-columns:44px minmax(0,1fr) 24px!important;padding:9px!important}
      .yx-coffee-card__slot{width:44px!important;height:44px!important;min-width:44px!important;max-width:44px!important}
      .yx-coffee-card__title{font-size:13px!important}.yx-coffee-card__detail{font-size:10.5px!important}
    }
  `;
  document.head.append(style);
}

function filtered(events: readonly YingxiangRemoteEvent[], state: ManagementState): YingxiangRemoteEvent[] {
  const query = state.query.normalize("NFKC").trim().toLocaleLowerCase();
  return events.filter((event) => {
    const statusMatch = state.statusFilter === "all"
      || (state.statusFilter === "active" && ["published", "active"].includes(event.status))
      || event.status === state.statusFilter;
    const queryMatch = !query || `${event.title} ${event.manifest.organizerName}`.normalize("NFKC").toLocaleLowerCase().includes(query);
    return statusMatch && queryMatch;
  });
}

async function deleteOne(runtime: ConsoleRuntime, event: YingxiangRemoteEvent): Promise<void> {
  const client = runtime.client;
  if (!client) return;
  if (["published", "active"].includes(event.status)) await client.cancelEvent(event.eventId);
  await client.deleteEvent(event.eventId);
}

async function cloneOne(runtime: ConsoleRuntime, event: YingxiangRemoteEvent): Promise<void> {
  const client = runtime.client;
  if (!client) return;
  const policy = structuredClone(event.policy);
  const manifest = structuredClone(event.manifest);
  await client.createEvent({
    title: `${event.title} · 复刻`,
    policy,
    manifest,
    publish: false
  });
}

function directEventCards(shell: HTMLElement): HTMLElement[] {
  return [...shell.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "SECTION");
}

async function enhance(instance: object, events: YingxiangRemoteEvent[]): Promise<void> {
  installStyles();
  const runtime = instance as ConsoleRuntime;
  const shell = runtime.root.querySelector<HTMLElement>(".yx-console");
  if (!shell) return;
  const state = stateFor(instance);
  const ids = new Set(events.map((event) => event.eventId));
  for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);

  const navs = [...shell.querySelectorAll<HTMLElement>(":scope > .yx-nav")];
  const tabs = navs[1];
  if (tabs && !tabs.querySelector("[data-yx-manage-entry]")) {
    const manage = makeButton(state.enabled ? "完成管理" : "管理", "yx-manage-entry");
    manage.dataset.yxManageEntry = "true";
    manage.classList.toggle("is-active", state.enabled);
    manage.onclick = async () => {
      state.enabled = !state.enabled;
      if (!state.enabled) state.selected.clear();
      await runtime.showEvents();
    };
    tabs.append(manage);
  }

  shell.classList.toggle("is-management-mode", state.enabled);
  const cards = directEventCards(shell);
  cards.forEach((card, index) => {
    const event = events[index];
    if (!event) return;
    card.dataset.eventId = event.eventId;
    card.dataset.eventStatus = event.status;
    card.classList.toggle("is-selected", state.selected.has(event.eventId));
  });
  if (!state.enabled) return;

  const toolbar = document.createElement("section");
  toolbar.className = "yx-management-toolbar";
  toolbar.dataset.yxManagementToolbar = "true";

  const filterRow = document.createElement("div");
  filterRow.className = "yx-management-filter";
  const search = document.createElement("input");
  search.type = "search";
  search.value = state.query;
  search.placeholder = "筛选活动名称 / 组织方";
  search.setAttribute("aria-label", "筛选活动名称或组织方");
  const select = document.createElement("select");
  select.setAttribute("aria-label", "按活动状态筛选");
  const options: ReadonlyArray<[string, string]> = [
    ["all", "全部状态"], ["draft", "草稿"], ["active", "进行中"], ["completed", "已完成"], ["cancelled", "已取消"]
  ];
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value; option.textContent = label; option.selected = state.statusFilter === value; select.append(option);
  }
  filterRow.append(search, select);

  const actionRow = document.createElement("div");
  actionRow.className = "yx-management-actions";
  const selectAll = makeButton("全选筛选结果");
  const clone = makeButton("一键复刻", "yx-management-clone");
  const remove = makeButton("删除所选", "yx-management-delete");
  actionRow.append(selectAll, clone, remove);
  const status = document.createElement("div");
  status.className = "yx-management-status";

  toolbar.append(filterRow, actionRow, status);
  const firstCard = cards[0];
  if (firstCard) shell.insertBefore(toolbar, firstCard); else shell.append(toolbar);

  const applyFilter = (): YingxiangRemoteEvent[] => {
    const visible = filtered(events, state);
    const visibleIds = new Set(visible.map((event) => event.eventId));
    for (const card of cards) card.hidden = !visibleIds.has(card.dataset.eventId ?? "");
    status.textContent = `显示 ${visible.length}/${events.length} 条 · 已选 ${state.selected.size} 条`;
    return visible;
  };

  search.oninput = () => { state.query = search.value; applyFilter(); };
  select.onchange = () => { state.statusFilter = select.value; applyFilter(); };

  cards.forEach((card, index) => {
    const event = events[index];
    if (!event) return;
    const heading = card.querySelector<HTMLElement>("h3");
    if (heading && !card.querySelector(".yx-event-management-head")) {
      const head = document.createElement("div");
      head.className = "yx-event-management-head";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "yx-event-management-check";
      checkbox.checked = state.selected.has(event.eventId);
      checkbox.setAttribute("aria-label", `选择 ${event.title}`);
      checkbox.onchange = () => {
        if (checkbox.checked) state.selected.add(event.eventId); else state.selected.delete(event.eventId);
        card.classList.toggle("is-selected", checkbox.checked);
        applyFilter();
      };
      heading.classList.add("yx-event-management-title");
      heading.replaceWith(head);
      head.append(checkbox, heading);
    }
    if (!card.querySelector(".yx-event-management-actions")) {
      const row = document.createElement("div"); row.className = "yx-event-management-actions";
      const singleClone = makeButton("复刻", "yx-management-clone");
      const singleDelete = makeButton("删除", "yx-management-delete");
      singleClone.onclick = async () => {
        status.textContent = `正在复刻“${event.title}”…`;
        try { await cloneOne(runtime, event); await runtime.showEvents(); }
        catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
      };
      singleDelete.onclick = async () => {
        if (!window.confirm(`删除活动“${event.title}”？进行中的活动会先取消；活动、邀请、参与身份和已回传结果将永久删除。`)) return;
        status.textContent = `正在删除“${event.title}”…`;
        try { await deleteOne(runtime, event); state.selected.delete(event.eventId); await runtime.showEvents(); }
        catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
      };
      row.append(singleClone, singleDelete); card.append(row);
    }
  });

  selectAll.onclick = () => {
    const visible = applyFilter();
    const allSelected = visible.length > 0 && visible.every((event) => state.selected.has(event.eventId));
    for (const event of visible) {
      if (allSelected) state.selected.delete(event.eventId); else state.selected.add(event.eventId);
    }
    for (const card of cards) {
      const selected = state.selected.has(card.dataset.eventId ?? "");
      card.classList.toggle("is-selected", selected);
      const checkbox = card.querySelector<HTMLInputElement>(".yx-event-management-check"); if (checkbox) checkbox.checked = selected;
    }
    selectAll.textContent = allSelected ? "全选筛选结果" : "取消筛选全选";
    applyFilter();
  };

  clone.onclick = async () => {
    const chosen = events.filter((event) => state.selected.has(event.eventId));
    if (!chosen.length) { status.textContent = "请先选择至少一条活动记录。"; return; }
    status.textContent = `正在复刻 ${chosen.length} 条活动…`;
    try {
      for (const event of chosen) await cloneOne(runtime, event);
      state.selected.clear();
      await runtime.showEvents();
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  };

  remove.onclick = async () => {
    const chosen = events.filter((event) => state.selected.has(event.eventId));
    if (!chosen.length) { status.textContent = "请先选择至少一条活动记录。"; return; }
    if (!window.confirm(`永久删除选中的 ${chosen.length} 条活动？进行中的活动会先取消，所有邀请、参与身份、进度、提交与汇总结果都会一并删除。`)) return;
    status.textContent = `正在删除 ${chosen.length} 条活动…`;
    try {
      for (const event of chosen) await deleteOne(runtime, event);
      state.selected.clear();
      await runtime.showEvents();
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  };

  applyFilter();
}

function install(): void {
  const prototype = YingxiangConsoleRenderer.prototype as unknown as Record<string, unknown>;
  if (prototype[INSTALL_KEY]) return;
  prototype[INSTALL_KEY] = true;
  const runtime = prototype as unknown as { showEvents: () => Promise<void> };
  const original = runtime.showEvents;
  runtime.showEvents = async function (this: ConsoleRuntime): Promise<void> {
    await original.call(this);
    if (!this.client) return;
    try {
      const events = await this.client.listEvents();
      await enhance(this, events);
    } catch {
      // The base renderer already displays the authoritative network error.
    }
  };
}

install();
