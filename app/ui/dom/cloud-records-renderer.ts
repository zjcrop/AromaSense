import type { CloudRecordIndexEntry, RecordDownloadResult, RecordSyncService } from "../../core/record-sync-service";
import { OVERLAY_KINDS, type Cleanup } from "../interaction-foundation";

export type CloudRecordMode = "recent" | "range" | "select";

export interface CloudRecordDownloadFeatureOptions {
  service: RecordSyncService;
  onDownloaded?(result: RecordDownloadResult): void | Promise<void>;
}

function installCloudRecordStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cloud-records]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCloudRecords = "true";
  style.textContent = `
    .cloud-records-overlay{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:max(18px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(18px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    .cloud-records-panel{width:min(820px,100%);max-height:min(88dvh,820px);overflow:auto;display:flex;flex-direction:column;border:1px solid rgba(214,173,99,.28);border-radius:16px;background:#151515;color:#f4efe4;box-shadow:0 20px 60px rgba(0,0,0,.42);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .cloud-records-header{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 18px 13px;border-bottom:1px solid rgba(185,153,90,.22);background:rgba(21,21,21,.97)}
    .cloud-records-header__copy{min-width:0}.cloud-records-title{margin:0 0 3px;font-size:21px;line-height:1.2}.cloud-records-subtitle{margin:0;color:#8f8a82;font-size:11px;line-height:1.45}
    .cloud-records-close{flex:0 0 auto;min-height:38px;border:1px solid rgba(185,153,90,.34);border-radius:9px;padding:7px 11px;background:transparent;color:#b7ad99;font:inherit;font-size:12px}
    .cloud-records-body{padding:12px 18px 92px}.cloud-records-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 14px;padding:4px;border:1px solid rgba(185,153,90,.18);border-radius:10px;background:#171717}
    .cloud-records-mode{min-height:42px;border:0;border-radius:7px;background:transparent;color:#918d86;font:inherit;font-size:13px;font-weight:650;letter-spacing:.02em}.cloud-records-mode.is-active{background:rgba(185,153,90,.13);color:#d6c394;box-shadow:inset 0 0 0 1px rgba(185,153,90,.26)}
    .cloud-records-section{margin:0 0 12px;padding:10px;border:1px solid rgba(185,153,90,.18);border-radius:12px;background:#1b1b1b}.cloud-records-section__title{margin:0 0 8px;color:#c4ab72;font-size:12px;font-weight:700;letter-spacing:.04em}
    .cloud-records-recent-options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.cloud-records-chip{min-height:37px;border:1px solid rgba(185,153,90,.34);border-radius:9px;padding:6px 9px;background:#242424;color:#f4efe4;font:inherit;font-size:13px}.cloud-records-chip.is-active{border-color:#b9995a;color:#d6c394;box-shadow:0 0 0 2px rgba(185,153,90,.10)}
    .cloud-records-range{display:grid;grid-template-columns:1fr 1fr;gap:9px}.cloud-records-field{min-width:0;display:grid;gap:5px}.cloud-records-label{color:#a8a198;font-size:10px;font-weight:600}.cloud-records-control{width:100%;min-width:0;min-height:37px;box-sizing:border-box;border:1px solid rgba(185,153,90,.34);border-radius:9px;padding:6px 9px;background:#242424;color:#f4efe4;font:inherit;font-size:13px;outline:none}.cloud-records-control:focus{border-color:#b9995a;box-shadow:0 0 0 2px rgba(185,153,90,.12)}
    .cloud-records-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 1px 10px;color:#928d84;font-size:10px}.cloud-records-search{margin-bottom:9px}
    .cloud-records-list{display:grid;border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden;background:#1b1b1b}.cloud-records-empty{margin:0;padding:22px 14px;color:#837e75;text-align:center;font-size:12px;line-height:1.55}
    .cloud-record-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;min-height:58px;padding:9px 11px;border:0;border-bottom:1px solid rgba(255,255,255,.07);background:#1b1b1b;color:#f4efe4;text-align:left}.cloud-record-row:last-child{border-bottom:0}.cloud-record-row.is-selectable{cursor:pointer}.cloud-record-row.is-selected{background:#22211f;box-shadow:inset 3px 0 0 rgba(185,153,90,.55)}
    .cloud-record-check{width:17px;height:17px;margin:0;accent-color:#b9995a}.cloud-record-date{min-width:70px;color:#c4ab72;font-size:12px;font-weight:650;letter-spacing:.02em}.cloud-record-main{min-width:0;display:grid;gap:3px}.cloud-record-event{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f4efe4;font-size:13px;font-weight:600}.cloud-record-organizer{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#918d86;font-size:10px}.cloud-record-status{justify-self:end;padding:3px 6px;border:1px solid rgba(185,153,90,.18);border-radius:999px;color:#9b958c;font-size:9px;white-space:nowrap}.cloud-record-status.is-active{border-color:rgba(106,151,188,.34);color:#9bc0de;background:rgba(106,151,188,.08)}
    .cloud-records-feedback{min-height:18px;margin:10px 1px 0;color:#a8a39a;font-size:11px;line-height:1.5}.cloud-records-feedback.is-error{color:#f4b4b4}
    .cloud-records-footer{position:sticky;bottom:0;z-index:3;display:grid;grid-template-columns:minmax(110px,.42fr) minmax(180px,1fr);gap:10px;padding:12px 18px max(12px,env(safe-area-inset-bottom));border-top:1px solid rgba(185,153,90,.22);background:rgba(21,21,21,.97)}
    .cloud-records-secondary,.cloud-records-primary{min-height:46px;border-radius:10px;padding:9px 14px;font:inherit;font-size:13px;font-weight:700}.cloud-records-secondary{border:1px solid rgba(185,153,90,.34);background:#1e1e1e;color:#c5bda9}.cloud-records-primary{border:1px solid #b9995a;background:#b9995a;color:#111}.cloud-records-primary:disabled{opacity:.38}
    @media(max-width:620px){.cloud-records-overlay{padding:10px}.cloud-records-panel{max-height:94dvh;border-radius:12px}.cloud-records-header{padding:13px 12px 11px}.cloud-records-body{padding:10px 12px 88px}.cloud-records-title{font-size:21px}.cloud-records-recent-options{grid-template-columns:repeat(2,minmax(0,1fr))}.cloud-records-footer{padding-left:12px;padding-right:12px}.cloud-record-row{grid-template-columns:auto minmax(0,1fr);gap:8px}.cloud-record-status{grid-column:2;justify-self:start}.cloud-record-date{min-width:62px}}
  `;
  document.head.append(style);
}

function dateValue(entry: CloudRecordIndexEntry): string {
  return entry.date || entry.updatedAt.slice(0, 10);
}

function isUnfinished(entry: CloudRecordIndexEntry): boolean {
  return entry.status !== "completed" && entry.status !== "archived";
}

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function includesSearch(entry: CloudRecordIndexEntry, query: string): boolean {
  if (!query) return true;
  return [entry.date, entry.organizer, entry.eventName].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query));
}

class CloudRecordsDialog {
  private readonly overlay = document.createElement("div");
  private readonly panel = document.createElement("section");
  private cleanupNavigation?: Cleanup;
  private mode: CloudRecordMode = "recent";
  private recentCount = 5;
  private rangeStart = "";
  private rangeEnd = "";
  private search = "";
  private selected = new Set<string>();
  private entries: CloudRecordIndexEntry[] = [];
  private loading = true;
  private busy = false;
  private feedback = "正在读取云端记录…";
  private feedbackError = false;

  constructor(private readonly options: CloudRecordDownloadFeatureOptions) {
    installCloudRecordStyles();
    this.overlay.className = "cloud-records-overlay";
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-label", "云端记录");
    this.panel.className = "cloud-records-panel";
    this.overlay.append(this.panel);
    this.overlay.addEventListener("pointerdown", (event) => { if (event.target === this.overlay && !this.busy) this.close(); });
    this.overlay.addEventListener("keydown", (event) => { if (event.key === "Escape" && !this.busy) { event.preventDefault(); this.close(); } });
  }

  async open(): Promise<void> {
    document.body.append(this.overlay);
    this.cleanupNavigation = window.AromaSenseNavigation?.registerOverlay({
      id: "cloud-records",
      element: this.overlay,
      kind: OVERLAY_KINDS.MODAL,
      scrim: true,
      priority: 220,
      dismiss: () => this.close()
    });
    this.render();
    try {
      this.entries = await this.options.service.listCloudRecords();
      this.feedback = this.entries.length ? `云端共有 ${this.entries.length} 场杯测记录` : "云端暂无可下载记录";
      this.feedbackError = false;
    } catch (error) {
      this.feedback = this.errorMessage(error);
      this.feedbackError = true;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  close(): void {
    this.cleanupNavigation?.();
    this.cleanupNavigation = undefined;
    this.overlay.remove();
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("SYNC_AUTH_REQUIRED") || message.includes("401")) return "请先登录云端账户后查看云端记录。";
    if (message.includes("Failed to fetch") || !navigator.onLine) return "当前网络不可用，云端记录暂时无法读取。";
    return `云端记录读取失败：${message}`;
  }

  private currentEntries(): CloudRecordIndexEntry[] {
    const sorted = [...this.entries].sort((a, b) => {
      const dateCompare = dateValue(b).localeCompare(dateValue(a));
      return dateCompare || b.updatedAt.localeCompare(a.updatedAt);
    });
    if (this.mode === "recent") return sorted.slice(0, this.recentCount);
    if (this.mode === "range") return sorted.filter((entry) => {
      const value = dateValue(entry);
      return (!this.rangeStart || value >= this.rangeStart) && (!this.rangeEnd || value <= this.rangeEnd);
    });
    const query = normalizedSearch(this.search);
    return sorted.filter((entry) => includesSearch(entry, query));
  }

  private render(): void {
    this.panel.replaceChildren();
    const header = document.createElement("header"); header.className = "cloud-records-header";
    const copy = document.createElement("div"); copy.className = "cloud-records-header__copy";
    const title = document.createElement("h1"); title.className = "cloud-records-title"; title.textContent = "云端记录";
    const subtitle = document.createElement("p"); subtitle.className = "cloud-records-subtitle"; subtitle.textContent = "下载后保留原杯测进度，并继续使用同一记录。";
    copy.append(title, subtitle);
    const close = document.createElement("button"); close.type = "button"; close.className = "cloud-records-close"; close.textContent = "关闭"; close.disabled = this.busy; close.addEventListener("click", () => this.close());
    header.append(copy, close);

    const body = document.createElement("div"); body.className = "cloud-records-body";
    body.append(this.renderModes());
    if (this.mode === "recent") body.append(this.renderRecentControls());
    if (this.mode === "range") body.append(this.renderRangeControls());
    if (this.mode === "select") body.append(this.renderSearch());

    const current = this.currentEntries();
    const summary = document.createElement("div"); summary.className = "cloud-records-summary";
    summary.append(document.createTextNode(this.loading ? "正在读取…" : `${current.length} 场记录`));
    if (this.mode === "select") {
      const selected = document.createElement("span"); selected.textContent = `已选择 ${this.selected.size} 场`; summary.append(selected);
    }
    body.append(summary, this.renderList(current));
    const feedback = document.createElement("div"); feedback.className = `cloud-records-feedback${this.feedbackError ? " is-error" : ""}`; feedback.textContent = this.feedback; body.append(feedback);

    const footer = document.createElement("footer"); footer.className = "cloud-records-footer";
    const secondary = document.createElement("button"); secondary.type = "button"; secondary.className = "cloud-records-secondary"; secondary.textContent = "取消"; secondary.disabled = this.busy; secondary.addEventListener("click", () => this.close());
    const primary = document.createElement("button"); primary.type = "button"; primary.className = "cloud-records-primary";
    const ids = this.downloadIds(current);
    primary.textContent = this.busy ? "正在下载…" : this.primaryLabel(ids.length);
    primary.disabled = this.loading || this.busy || ids.length === 0;
    primary.addEventListener("click", () => void this.download(ids));
    footer.append(secondary, primary);
    this.panel.append(header, body, footer);
  }

  private renderModes(): HTMLElement {
    const nav = document.createElement("nav"); nav.className = "cloud-records-modes"; nav.setAttribute("aria-label", "云端记录下载范围");
    const modes: readonly [CloudRecordMode, string][] = [["recent", "最近记录"], ["range", "按时间"], ["select", "选择下载"]];
    for (const [mode, label] of modes) {
      const button = document.createElement("button"); button.type = "button"; button.className = `cloud-records-mode${this.mode === mode ? " is-active" : ""}`; button.textContent = label; button.setAttribute("aria-pressed", String(this.mode === mode));
      button.addEventListener("click", () => { this.mode = mode; this.render(); }); nav.append(button);
    }
    return nav;
  }

  private renderRecentControls(): HTMLElement {
    const section = document.createElement("section"); section.className = "cloud-records-section";
    const title = document.createElement("h2"); title.className = "cloud-records-section__title"; title.textContent = "下载最近几次杯测";
    const options = document.createElement("div"); options.className = "cloud-records-recent-options";
    for (const count of [3, 5, 10, 20]) {
      const button = document.createElement("button"); button.type = "button"; button.className = `cloud-records-chip${this.recentCount === count ? " is-active" : ""}`; button.textContent = `最近 ${count} 次`; button.addEventListener("click", () => { this.recentCount = count; this.render(); }); options.append(button);
    }
    section.append(title, options); return section;
  }

  private renderRangeControls(): HTMLElement {
    const section = document.createElement("section"); section.className = "cloud-records-section";
    const title = document.createElement("h2"); title.className = "cloud-records-section__title"; title.textContent = "选择杯测日期范围";
    const range = document.createElement("div"); range.className = "cloud-records-range";
    const build = (labelText: string, value: string, update: (value: string) => void): HTMLElement => {
      const field = document.createElement("label"); field.className = "cloud-records-field"; const label = document.createElement("span"); label.className = "cloud-records-label"; label.textContent = labelText;
      const input = document.createElement("input"); input.type = "date"; input.className = "cloud-records-control"; input.value = value; input.addEventListener("change", () => { update(input.value); this.render(); }); field.append(label, input); return field;
    };
    range.append(build("开始日期", this.rangeStart, (value) => { this.rangeStart = value; }), build("结束日期", this.rangeEnd, (value) => { this.rangeEnd = value; }));
    section.append(title, range); return section;
  }

  private renderSearch(): HTMLElement {
    const wrap = document.createElement("div"); wrap.className = "cloud-records-search";
    const input = document.createElement("input"); input.type = "search"; input.className = "cloud-records-control"; input.placeholder = "搜索杯测会名称或组织方"; input.value = this.search; input.addEventListener("input", () => { this.search = input.value; this.render(); }); wrap.append(input); return wrap;
  }

  private renderList(entries: readonly CloudRecordIndexEntry[]): HTMLElement {
    const list = document.createElement("div"); list.className = "cloud-records-list";
    if (!entries.length) { const empty = document.createElement("p"); empty.className = "cloud-records-empty"; empty.textContent = this.loading ? "正在读取云端记录…" : "当前范围没有云端记录。"; list.append(empty); return list; }
    for (const entry of entries) list.append(this.renderRow(entry));
    return list;
  }

  private renderRow(entry: CloudRecordIndexEntry): HTMLElement {
    const row = document.createElement(this.mode === "select" ? "label" : "div"); row.className = `cloud-record-row${this.mode === "select" ? " is-selectable" : ""}${this.selected.has(entry.recordId) ? " is-selected" : ""}`;
    if (this.mode === "select") {
      const check = document.createElement("input"); check.type = "checkbox"; check.className = "cloud-record-check"; check.checked = this.selected.has(entry.recordId); check.addEventListener("change", () => { check.checked ? this.selected.add(entry.recordId) : this.selected.delete(entry.recordId); this.render(); }); row.append(check);
    } else {
      const date = document.createElement("span"); date.className = "cloud-record-date"; date.textContent = dateValue(entry); row.append(date);
    }
    const main = document.createElement("span"); main.className = "cloud-record-main";
    const event = document.createElement("span"); event.className = "cloud-record-event"; event.textContent = entry.eventName || "未命名杯测会";
    const organizer = document.createElement("span"); organizer.className = "cloud-record-organizer"; organizer.textContent = `${dateValue(entry)} · ${entry.organizer || "未标注组织方"}`;
    main.append(event, organizer); row.append(main);
    if (isUnfinished(entry)) { const status = document.createElement("span"); status.className = "cloud-record-status is-active"; status.textContent = "进行中"; row.append(status); }
    else { const status = document.createElement("span"); status.className = "cloud-record-status"; status.textContent = "已完成"; row.append(status); }
    return row;
  }

  private downloadIds(current: readonly CloudRecordIndexEntry[]): string[] {
    if (this.mode === "select") return [...this.selected];
    return current.map((entry) => entry.recordId);
  }

  private primaryLabel(count: number): string {
    if (this.mode === "recent") return `下载最近 ${count} 场`;
    if (this.mode === "range") return `下载这 ${count} 场`;
    return `下载已选 ${count} 场`;
  }

  private async download(ids: readonly string[]): Promise<void> {
    if (!ids.length || this.busy) return;
    this.busy = true; this.feedbackError = false; this.feedback = `正在下载 ${ids.length} 场记录…`; this.render();
    try {
      const result = await this.options.service.downloadRecords(ids);
      this.feedback = `下载完成：新增或更新 ${result.pulled} 场，保留本机较新记录 ${result.skipped} 场。`;
      this.feedbackError = false;
      this.busy = false;
      this.render();
      await this.options.onDownloaded?.(result);
    } catch (error) {
      this.busy = false; this.feedback = this.errorMessage(error); this.feedbackError = true; this.render();
    }
  }
}

export function installCloudRecordDownloadFeature(options: CloudRecordDownloadFeatureOptions): Cleanup {
  let dialog: CloudRecordsDialog | undefined;
  const attach = (): void => {
    for (const toolbar of document.querySelectorAll<HTMLElement>(".session-records__toolbar")) {
      if (toolbar.querySelector("[data-cloud-records-launcher]")) continue;
      const button = document.createElement("button"); button.type = "button"; button.className = "session-records__tool"; button.dataset.cloudRecordsLauncher = "true"; button.textContent = "云端记录";
      button.addEventListener("click", () => { dialog?.close(); dialog = new CloudRecordsDialog(options); void dialog.open(); });
      toolbar.prepend(button);
    }
  };
  const observer = new MutationObserver(attach); observer.observe(document.documentElement, { childList: true, subtree: true }); attach();
  return () => { observer.disconnect(); dialog?.close(); document.querySelectorAll("[data-cloud-records-launcher]").forEach((node) => node.remove()); };
}
