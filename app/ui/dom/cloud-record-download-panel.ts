import type { CloudRecordDownloadService, CloudRecordIndexEntry } from "../../core/cloud-record-download-service";
import { button, element } from "./dom-helpers";

type Mode = "recent" | "range" | "select";

export interface CloudRecordDownloadPanelOptions {
  service: CloudRecordDownloadService;
  onDownloaded?(): void | Promise<void>;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cloud-records]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCloudRecords = "true";
  style.textContent = `
    .cloud-records-overlay{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;padding:22px;background:rgba(0,0,0,.28)}
    .cloud-records{width:min(760px,calc(100vw - 32px));max-height:min(88dvh,820px);overflow:auto;border:1px solid rgba(214,173,99,.28);border-radius:16px;background:#151515;box-shadow:0 16px 42px rgba(0,0,0,.44);color:#d8d3ca}
    .cloud-records__header{display:grid;grid-template-columns:72px 1fr 72px;align-items:center;min-height:58px;padding:0 18px;border-bottom:1px solid rgba(185,153,90,.14)}
    .cloud-records__back,.cloud-records__close{border:0;background:transparent;color:#b9a06d;font:inherit;font-size:13px}.cloud-records__back{text-align:left}.cloud-records__close{text-align:right}
    .cloud-records__title{margin:0;text-align:center;font-size:17px;font-weight:700;letter-spacing:.04em;color:#e4ded4}
    .cloud-records__body{padding:16px 18px 20px}
    .cloud-records__tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:16px;padding:4px;border:1px solid rgba(185,153,90,.18);border-radius:10px;background:#171717}
    .cloud-records__tab{min-height:40px;border:0;border-radius:7px;background:transparent;color:#918d86;font:inherit;font-size:13px;font-weight:650;letter-spacing:.03em}.cloud-records__tab.is-active{background:rgba(185,153,90,.13);color:#d6c394;box-shadow:inset 0 0 0 1px rgba(185,153,90,.26)}
    .cloud-records__section{display:grid;gap:12px}.cloud-records__hint{margin:0;color:#77726b;font-size:11px;line-height:1.65}
    .cloud-records__field{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:center;gap:12px;min-height:44px;border-bottom:1px solid rgba(255,255,255,.055)}
    .cloud-records__label{font-size:12px;color:#9e998f}.cloud-records__select,.cloud-records__date,.cloud-records__search{width:100%;min-height:38px;padding:0 10px;border:1px solid rgba(185,153,90,.2);border-radius:8px;background:#101010;color:#d8d3ca;font:inherit;font-size:13px;outline:none}
    .cloud-records__range{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center}.cloud-records__range-sep{color:#716c64;font-size:12px}
    .cloud-records__summary{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:34px;color:#888279;font-size:11px}
    .cloud-records__list{display:grid;border-top:1px solid rgba(185,153,90,.12)}
    .cloud-record{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:10px;align-items:center;min-height:64px;padding:10px 2px;border-bottom:1px solid rgba(255,255,255,.055)}
    .cloud-record__check{width:16px;height:16px;accent-color:#b99a5c}.cloud-record__main{min-width:0}.cloud-record__primary{display:flex;align-items:baseline;gap:9px;min-width:0}.cloud-record__date{flex:0 0 auto;color:#d6c394;font-size:12px;font-weight:700}.cloud-record__event{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ddd7cd;font-size:13px;font-weight:650}.cloud-record__organizer{margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#817c74;font-size:11px}
    .cloud-record__status{font-size:10px;color:#77726b}.cloud-record__status.is-unfinished{color:#d6ad63;font-weight:700}
    .cloud-records__empty{padding:32px 10px;text-align:center;color:#77726b;font-size:12px}.cloud-records__error{padding:12px;border:1px solid rgba(188,96,82,.25);border-radius:8px;background:rgba(188,96,82,.08);color:#cf9d94;font-size:12px;line-height:1.55}
    .cloud-records__footer{position:sticky;bottom:0;display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;margin:16px -18px -20px;padding:12px 18px;border-top:1px solid rgba(185,153,90,.14);background:rgba(21,21,21,.97)}
    .cloud-records__selected{color:#8f897f;font-size:11px}.cloud-records__download{min-width:132px;min-height:42px;padding:0 18px;border:1px solid rgba(214,173,99,.36);border-radius:9px;background:rgba(185,153,90,.14);color:#d6ad63;font:inherit;font-size:13px;font-weight:750}.cloud-records__download:disabled{opacity:.38}
    @media(max-width:620px){.cloud-records-overlay{padding:10px}.cloud-records{width:calc(100vw - 20px);max-height:92dvh;border-radius:12px}.cloud-records__header{grid-template-columns:58px 1fr 58px;padding:0 12px}.cloud-records__body{padding:12px}.cloud-records__field{grid-template-columns:82px minmax(0,1fr)}.cloud-records__footer{margin:14px -12px -12px;padding:11px 12px}.cloud-record__event{font-size:12px}}
  `;
  document.head.append(style);
}

export class CloudRecordDownloadPanel {
  private mode: Mode = "recent";
  private records: CloudRecordIndexEntry[] = [];
  private selected = new Set<string>();
  private recentCount = 5;
  private rangeStart = "";
  private rangeEnd = "";
  private search = "";
  private error = "";
  private loading = false;
  private overlay?: HTMLElement;
  private body?: HTMLElement;

  constructor(private readonly options: CloudRecordDownloadPanelOptions) { installStyles(); }

  async open(): Promise<void> {
    this.close();
    const overlay = element("div", "cloud-records-overlay");
    const panel = element("section", "cloud-records");
    const header = element("header", "cloud-records__header");
    header.append(
      button("cloud-records__back", "返回", () => this.close()),
      element("h1", "cloud-records__title", "云端记录"),
      button("cloud-records__close", "关闭", () => this.close())
    );
    const body = element("div", "cloud-records__body");
    panel.append(header, body); overlay.append(panel); document.body.append(overlay);
    overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) this.close(); });
    this.overlay = overlay; this.body = body; this.loading = true; this.render();
    try { this.records = [...await this.options.service.list()]; }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    finally { this.loading = false; this.render(); }
  }

  close(): void { this.overlay?.remove(); this.overlay = undefined; this.body = undefined; }

  private render(): void {
    const root = this.body; if (!root) return; root.replaceChildren();
    const tabs = element("nav", "cloud-records__tabs");
    for (const [mode, label] of [["recent", "最近记录"], ["range", "按时间"], ["select", "选择下载"]] as const) {
      tabs.append(button(`cloud-records__tab${this.mode === mode ? " is-active" : ""}`, label, () => { this.mode = mode; this.selected.clear(); this.error = ""; this.render(); }));
    }
    root.append(tabs);
    if (this.loading) { root.append(element("p", "cloud-records__empty", "正在读取云端记录…")); return; }
    if (this.error) root.append(element("div", "cloud-records__error", this.error));
    if (!this.records.length) { root.append(element("p", "cloud-records__empty", "云端暂无可下载杯测记录。")); return; }
    if (this.mode === "recent") this.renderRecent(root);
    if (this.mode === "range") this.renderRange(root);
    if (this.mode === "select") this.renderSelect(root);
  }

  private renderRecent(root: HTMLElement): void {
    const section = element("section", "cloud-records__section");
    const row = element("label", "cloud-records__field"); row.append(element("span", "cloud-records__label", "下载范围"));
    const select = element("select", "cloud-records__select");
    for (const count of [3, 5, 10, 20]) { const option = element("option", "", `最近 ${count} 次`); option.value = String(count); option.selected = count === this.recentCount; select.append(option); }
    select.addEventListener("change", () => { this.recentCount = Number(select.value); this.selected = new Set(this.records.slice(0, this.recentCount).map((item) => item.recordId)); this.render(); }); row.append(select); section.append(row);
    section.append(element("p", "cloud-records__hint", "进行中与已完成记录都会包含。下载后保持原杯测进度，不会重置为已完成。"));
    const visible = this.records.slice(0, this.recentCount); this.selected = new Set(visible.map((item) => item.recordId));
    section.append(this.summary(visible), this.recordList(visible, false), this.footer()); root.append(section);
  }

  private renderRange(root: HTMLElement): void {
    const section = element("section", "cloud-records__section");
    const row = element("div", "cloud-records__field"); row.append(element("span", "cloud-records__label", "时间范围"));
    const range = element("div", "cloud-records__range");
    const start = element("input", "cloud-records__date"); start.type = "date"; start.value = this.rangeStart; start.addEventListener("change", () => { this.rangeStart = start.value; this.selected.clear(); this.render(); });
    const end = element("input", "cloud-records__date"); end.type = "date"; end.value = this.rangeEnd; end.addEventListener("change", () => { this.rangeEnd = end.value; this.selected.clear(); this.render(); });
    range.append(start, element("span", "cloud-records__range-sep", "至"), end); row.append(range); section.append(row);
    const visible = this.rangeRecords(); this.selected = new Set(visible.map((item) => item.recordId));
    section.append(this.summary(visible), this.recordList(visible, false), this.footer()); root.append(section);
  }

  private renderSelect(root: HTMLElement): void {
    const section = element("section", "cloud-records__section");
    const row = element("label", "cloud-records__field"); row.append(element("span", "cloud-records__label", "查找记录"));
    const input = element("input", "cloud-records__search"); input.type = "search"; input.placeholder = "杯测会名称 / 组织方"; input.value = this.search;
    input.addEventListener("input", () => { this.search = input.value; this.render(); }); row.append(input); section.append(row);
    const visible = this.searchRecords();
    const summary = this.summary(visible); const selectAll = button("cloud-records__back", this.selected.size === visible.length && visible.length ? "取消全选" : "全选", () => {
      if (this.selected.size === visible.length && visible.length) this.selected.clear(); else for (const item of visible) this.selected.add(item.recordId); this.render();
    }); summary.append(selectAll); section.append(summary, this.recordList(visible, true), this.footer()); root.append(section);
  }

  private summary(records: readonly CloudRecordIndexEntry[]): HTMLElement {
    const summary = element("div", "cloud-records__summary");
    summary.append(element("span", "", `云端记录 ${records.length} 场`)); return summary;
  }

  private recordList(records: readonly CloudRecordIndexEntry[], selectable: boolean): HTMLElement {
    const list = element("div", "cloud-records__list");
    if (!records.length) { list.append(element("p", "cloud-records__empty", "没有符合条件的记录。")); return list; }
    for (const record of records) {
      const row = element("label", "cloud-record");
      const check = element("input", "cloud-record__check"); check.type = "checkbox"; check.checked = this.selected.has(record.recordId); check.disabled = !selectable;
      if (selectable) check.addEventListener("change", () => { check.checked ? this.selected.add(record.recordId) : this.selected.delete(record.recordId); this.render(); });
      const main = element("div", "cloud-record__main"); const primary = element("div", "cloud-record__primary"); primary.append(element("span", "cloud-record__date", record.date), element("strong", "cloud-record__event", record.eventName)); main.append(primary, element("div", "cloud-record__organizer", record.organizer));
      const status = element("span", `cloud-record__status${record.status === "unfinished" ? " is-unfinished" : ""}`, record.statusLabel);
      row.append(check, main, status); list.append(row);
    }
    return list;
  }

  private footer(): HTMLElement {
    const footer = element("footer", "cloud-records__footer");
    footer.append(element("span", "cloud-records__selected", `已选择 ${this.selected.size} 场`));
    const download = button("cloud-records__download", "下载到本机", () => this.download()); download.disabled = this.selected.size === 0; footer.append(download); return footer;
  }

  private rangeRecords(): CloudRecordIndexEntry[] {
    return this.records.filter((item) => (!this.rangeStart || item.date >= this.rangeStart) && (!this.rangeEnd || item.date <= this.rangeEnd));
  }

  private searchRecords(): CloudRecordIndexEntry[] {
    const query = this.search.trim().toLocaleLowerCase("zh-CN"); if (!query) return this.records;
    return this.records.filter((item) => `${item.eventName} ${item.organizer} ${item.date}`.toLocaleLowerCase("zh-CN").includes(query));
  }

  private async download(): Promise<void> {
    if (!this.selected.size || this.loading) return; this.loading = true; this.error = ""; this.render();
    try {
      const result = await this.options.service.download([...this.selected]);
      this.loading = false;
      this.error = result.skipped ? `已下载 ${result.downloaded} 场；${result.skipped} 场因本机版本更新或云端记录不可用而跳过。` : `已下载 ${result.downloaded} 场记录。`;
      this.selected.clear(); await this.options.onDownloaded?.(); this.render();
    } catch (error) { this.loading = false; this.error = error instanceof Error ? error.message : String(error); this.render(); }
  }
}

export function installCloudRecordDownloadEntry(options: CloudRecordDownloadPanelOptions): () => void {
  const panel = new CloudRecordDownloadPanel(options);
  const decorate = (): void => {
    for (const toolbar of document.querySelectorAll<HTMLElement>(".session-records__toolbar")) {
      if (toolbar.querySelector("[data-cloud-record-entry]")) continue;
      const entry = button("session-records__tool", "云端记录", () => panel.open()); entry.dataset.cloudRecordEntry = "true"; toolbar.append(entry);
    }
  };
  decorate(); const observer = new MutationObserver(decorate); observer.observe(document.body, { childList: true, subtree: true });
  return () => { observer.disconnect(); panel.close(); };
}
