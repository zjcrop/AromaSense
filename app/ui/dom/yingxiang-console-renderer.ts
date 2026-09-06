import { YingxiangClient, type YingxiangDashboard, type YingxiangRemoteEvent } from "../../core/yingxiang-client";
import { YingxiangDeliveryService } from "../../core/yingxiang-delivery-service";
import type { YingxiangCoffeeDetail } from "../../core/yingxiang-event";
import type { SQLiteDriver } from "../../storage/local-cupping-repository";
import { YingxiangHostRenderer } from "./yingxiang-host-renderer";
import { renderYingxiangInviteShare } from "./yingxiang-invite-share";
import { interactionConfirm } from "../interaction-foundation";

interface Options {
  onClose(): void;
  onRequireAccount(): void | Promise<void>;
  onOpenSession(id: string): void | Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, work: () => void | Promise<void>): HTMLButtonElement {
  const node = el("button", text);
  node.type = "button";
  node.onclick = () => { void work(); };
  return node;
}

function input(label: string, value = "", type = "text"): { label: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = el("label", label);
  const control = el("input");
  control.type = type;
  control.value = value;
  wrapper.append(control);
  return { label: wrapper, input: control };
}

function time(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "尚未回传";
}

function num(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

const stages: Record<string, string> = {
  aroma: "香气", high_temp: "高温", mid_temp: "中温", low_temp: "低温", flavor: "风味", overall: "综评", scoring: "评分"
};
const stateLabel: Record<string, string> = { draft: "草稿", published: "进行中", active: "进行中", completed: "已结束", cancelled: "已取消" };

function download(name: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = el("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function table(headers: string[], rows: (string | number | HTMLElement)[][]): HTMLElement {
  const wrap = el("div"); wrap.className = "yx-table";
  const table = el("table");
  const headerRow = el("tr");
  for (const value of headers) headerRow.append(el("th", value));
  const head = el("thead"); head.append(headerRow);
  const body = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    for (const value of row) {
      const td = el("td");
      if (value instanceof HTMLElement) td.append(value); else td.textContent = String(value);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body); wrap.append(table); return wrap;
}

function coffeeSummary(coffee?: YingxiangCoffeeDetail): { title: string; detail: string } {
  if (!coffee) return { title: "尚未对应真实咖啡", detail: "" };
  const clean = (value: unknown) => String(value ?? "").normalize("NFKC").trim();
  const title = clean(coffee.productName) || "未命名咖啡";
  const area = clean(coffee.region) || clean(coffee.farm) || clean(coffee.station);
  const detail = [clean(coffee.country), area, clean(coffee.variety), clean(coffee.roast)].filter(Boolean);
  if (clean(coffee.notes)) detail.push("……");
  return { title, detail: detail.join("/") };
}

function sampleList(event: YingxiangRemoteEvent, onEdit?: () => void): HTMLElement {
  const section = el("section");
  section.className = "yx-samples";
  section.append(el("h3", "样品组"));
  const list = el("div"); list.className = "yx-samples__list";
  for (const sample of [...event.manifest.samples].sort((a, b) => a.order - b.order)) {
    const row = el("button"); row.type = "button"; row.className = "yx-sample-row";
    const code = el("span", sample.sampleCode); code.className = "yx-sample-row__code";
    const info = el("span"); info.className = "yx-sample-row__info";
    const summary = coffeeSummary(sample.coffee);
    const title = el("span", summary.title); title.className = "yx-sample-row__title";
    const detail = el("span", summary.detail || "点击编辑真实咖啡信息"); detail.className = "yx-sample-row__detail";
    info.append(title, detail); row.append(code, info);
    if (onEdit) row.onclick = onEdit; else row.disabled = true;
    list.append(row);
  }
  section.append(list);
  return section;
}

function styles(): void {
  if (document.querySelector("style[data-yx-console]")) return;
  const style = el("style"); style.dataset.yxConsole = "true";
  style.textContent = `
    .yx-console{padding:20px;display:grid;gap:16px;background:#151515;color:#eee;font:16px/1.55 system-ui,sans-serif}
    .yx-console [hidden]{display:none!important}.yx-console h2,.yx-console h3,.yx-console p{margin:0}.yx-console h2{color:#d6ad63}.yx-console h3{font-size:17px}
    .yx-console button{min-height:44px;padding:8px 13px;border:1px solid #7c6844;background:#242119;color:#ead8b3;border-radius:7px;font:inherit;cursor:pointer}.yx-console button:disabled{opacity:.5;cursor:default}
    .yx-nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.yx-nav h2{flex:1}.yx-console section{display:grid;gap:12px;padding:14px;border:1px solid #39352d;border-radius:9px;min-width:0}
    .yx-console label{display:grid;gap:5px;font-size:14px}.yx-console input,.yx-console select{min-height:44px;min-width:0;box-sizing:border-box;width:100%;background:#101010;color:#eee;border:1px solid #706045;border-radius:6px;padding:8px;font:inherit}
    .yx-console .yx-check{display:flex;gap:8px;align-items:center}.yx-check input{width:20px;min-height:20px;margin:0}.yx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.yx-muted{font-size:13px;color:#9f988d}.yx-status{font-size:14px;color:#d6ad63;white-space:pre-wrap;overflow-wrap:anywhere}
    .yx-table{overflow:auto}.yx-table table{border-collapse:collapse;white-space:nowrap;font-size:14px;width:100%}.yx-table th,.yx-table td{padding:8px;text-align:left;border-bottom:1px solid #35332e}.yx-table th{color:#cabc9d}.yx-console a{color:#e9cf9b;overflow-wrap:anywhere}
    .yx-samples__list{display:grid;gap:7px}.yx-console .yx-sample-row{display:grid;grid-template-columns:46px minmax(0,1fr);gap:9px;align-items:center;width:100%;min-height:58px;padding:6px;border:1px solid #383329;background:#111;color:inherit;text-align:left}
    .yx-console .yx-sample-row:disabled{opacity:1;cursor:default}.yx-sample-row__code{display:grid;place-items:center;width:46px;height:46px;box-sizing:border-box;border:1px solid #806b46;border-radius:7px;background:#1d1a14;color:#e1ca9a;font:700 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .yx-sample-row__info{display:grid;gap:2px;min-width:0}.yx-sample-row__title,.yx-sample-row__detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yx-sample-row__title{font-size:12.5px;font-weight:700}.yx-sample-row__detail{font-size:10.5px;color:#938c82}
    @media(max-width:620px){.yx-console{padding:14px}.yx-grid{grid-template-columns:1fr}.yx-console section{padding:11px}.yx-nav button{font-size:14px}.yx-console .yx-sample-row{grid-template-columns:42px minmax(0,1fr)}.yx-sample-row__code{width:42px;height:42px}}
  `;
  document.head.append(style);
}

export class YingxiangConsoleRenderer {
  private timer?: ReturnType<typeof setInterval>;
  private screen = 0;
  private busy = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly client: YingxiangClient | undefined,
    private readonly db: SQLiteDriver,
    private readonly delivery: YingxiangDeliveryService | undefined,
    private readonly options: Options
  ) {}

  dispose(): void {
    this.screen += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private shell(title: string): HTMLElement {
    this.dispose(); styles(); this.root.replaceChildren();
    const shell = el("div"); shell.className = "yx-console";
    const nav = el("div"); nav.className = "yx-nav";
    nav.append(el("h2", title), button("返回香迹", () => this.options.onClose()));
    const tabs = el("nav"); tabs.className = "yx-nav";
    tabs.append(button("我的活动", () => this.showEvents()), button("我的参与", () => this.showParticipations()), button("新建杯测", () => this.showEditor()));
    shell.append(nav, tabs); this.root.append(shell); return shell;
  }

  private async run(status: HTMLElement, work: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; status.textContent = "处理中…";
    try { await work(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; }
  }

  async render(): Promise<void> { await this.showEvents(); }

  async showEvents(): Promise<void> {
    const shell = this.shell("迎香 · 我的活动"); const status = el("p", "正在读取…"); status.className = "yx-status"; shell.append(status); const screen = this.screen;
    if (!this.client) { status.textContent = "当前未配置迎香服务。"; return; }
    try {
      const events = await this.client.listEvents(); if (screen !== this.screen) return;
      status.textContent = events.length ? "" : "还没有发布活动。登录后可新建杯测。";
      for (const event of events) {
        const card = el("section");
        card.append(el("h3", event.title), el("p", `${stateLabel[event.status]} · ${event.manifest.organizerName} · ${event.manifest.samples.length} 个样品`), button("管理活动", () => this.showDashboard(event.eventId)));
        shell.append(card);
      }
    } catch (error) {
      if (screen !== this.screen) return;
      status.textContent = error instanceof Error ? error.message : String(error);
      shell.append(button("重新登录迎香账号", () => this.options.onRequireAccount()));
    }
  }

  private showEditor(event?: YingxiangRemoteEvent, locked = false): void {
    this.dispose();
    new YingxiangHostRenderer(this.root, this.client, {
      onClose: () => { void this.showEvents(); }, onRequireAccount: this.options.onRequireAccount,
      initialEvent: event, structureLocked: locked, onPublished: (published) => this.showDashboard(published.eventId)
    }).render();
  }

  async showParticipations(): Promise<void> {
    const shell = this.shell("迎香 · 我的参与"); const status = el("p"); status.className = "yx-status"; shell.append(status);
    if (!this.delivery) { status.textContent = "当前未配置迎香服务。"; return; }
    shell.append(button("重试提交与更新状态", () => this.run(status, async () => { await this.delivery!.sync(); await this.showParticipations(); })));
    const rows = await this.delivery.list(); if (!rows.length) status.textContent = "通过主办方邀请加入的杯测会显示在这里。";
    for (const row of rows) {
      const principal = await this.db.get<{ title: string; display_name: string; status: string }>(`SELECT s.title,p.display_name,p.status FROM sessions s JOIN yingxiang_session_bindings b ON b.session_id=s.session_id JOIN yingxiang_event_principals p ON p.participant_id=b.participant_id AND p.event_id=b.event_id WHERE s.session_id=?`, [row.session_id]);
      const card = el("section");
      card.append(el("h3", principal?.title ?? "迎香杯测"), el("p", `${principal?.display_name ?? "参与者"} · ${principal?.status === "released" ? "活动身份已释放" : "本次活动身份"}`));
      const note = el("p", row.last_error ?? (row.ack_revision ? "结果已送达主办方" : "已保存到本机，完成杯测后自动提交")); note.className = "yx-status";
      card.append(note, button("打开本地杯测", () => this.options.onOpenSession(row.session_id)));
      if (principal?.status === "active") card.append(button("退出本次活动", () => this.run(note, async () => {
        if (!await interactionConfirm({ title: "退出本次活动？", message: "退出后不能再向本次活动提交；本地杯测记录会保留。", confirmLabel: "退出", danger: true })) { note.textContent = ""; return; }
        await this.delivery!.leave(row); await this.showParticipations();
      })));
      shell.append(card);
    }
  }

  async showDashboard(eventId: string): Promise<void> {
    if (!this.client) return;
    const shell = this.shell("迎香 · 活动管理"); const status = el("p", "正在读取活动…"); status.className = "yx-status"; shell.append(status); const screen = this.screen;
    let data: YingxiangDashboard;
    try { data = await this.client.dashboard(eventId); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); return; }
    if (screen !== this.screen) return;

    const summary = el("section"); const title = el("h3", data.event.title); const meta = el("p"); summary.append(title, meta); const actions = el("div"); actions.className = "yx-nav";
    const live = el("section"); const result = el("section"); const samplesRoot = el("div"); let loading = false;

    const renderSamples = (): void => {
      samplesRoot.replaceChildren(sampleList(data.event, !["completed", "cancelled"].includes(data.event.status) ? () => this.showEditor(data.event, data.participants.length > 0) : undefined));
    };
    const renderLive = (): void => {
      meta.textContent = `${stateLabel[data.event.status]} · ${data.event.manifest.samples.length} 个样品 · ${data.participants.length} 人加入 · ${data.results.submissions} 人已交卷`;
      live.replaceChildren(el("h3", "参与进度"), el("p", "在线时每 20 秒刷新；进度以参与者最后回传为准。"));
      live.append(table(["参与名称", "最终评分确认", "结果回收", "最近回传", "操作"], data.participants.map((participant) => [
        participant.displayName,
        `${participant.submissionRevision ? data.event.manifest.samples.length : participant.completedSamples ?? 0}/${data.event.manifest.samples.length}`,
        participant.submissionRevision ? "已收到" : participant.status === "released" ? "已释放" : "未提交",
        time(participant.receivedAt ?? participant.progressAt),
        participant.status === "active" ? button("释放身份", () => this.run(status, async () => {
          if (!await interactionConfirm({ title: "释放活动身份？", message: `将释放 ${participant.displayName} 的本次活动身份；本地记录仍保留。`, confirmLabel: "释放", danger: true })) { status.textContent = ""; return; }
          await this.client!.releaseParticipant(eventId, participant.participantId); await refresh();
        })) : "—"
      ])));
      result.replaceChildren(el("h3", "结果汇总"), el("p", "按样品编号和阶段分别计算；每人只计最新提交，缺测不补零。"));
      if (data.results.metrics.length) result.append(table(["样品", "阶段", "指标", "人数", "均值", "标准差"], data.results.metrics.map((metric) => [metric.sampleCode, stages[metric.stageId] ?? metric.stageId, metric.label, metric.count, num(metric.mean), num(metric.sd)])));
      else result.append(el("p", "尚无可汇总的已提交结果。"));
      result.append(el("h3", "重复校准"), el("p", "标准差衡量同豆重复记录的离散程度；与他人均值之差仅表示本组相对偏移，不代表正确答案或感官能力评分。"));
      if (data.results.calibration.length) result.append(table(["咖啡", "参与者", "阶段", "指标", "有效重复", "均值", "标准差", "与其他人均值之差"], data.results.calibration.map((metric) => [metric.canonicalSampleId, metric.displayName, stages[metric.stageId] ?? metric.stageId, metric.label, `${metric.count}/${metric.expectedRepeats}`, num(metric.mean), num(metric.sd), num(metric.offsetFromPeers)])));
      else result.append(el("p", "设置重复样品映射后，至少收到同阶段、同指标的两次记录才能计算。"));
      renderSamples();
    };
    const refresh = async (): Promise<void> => {
      if (loading) return; loading = true;
      try {
        const next = await this.client!.dashboard(eventId); if (screen !== this.screen) return;
        data = next; title.textContent = data.event.title; renderLive(); status.textContent = `已更新 ${new Date().toLocaleTimeString()}`;
      } finally { loading = false; }
    };

    actions.append(button("刷新", () => this.run(status, refresh)), button("导出完整结果", () => download(`迎香-${eventId}-结果.json`, JSON.stringify({ schemaVersion: "yingxiang-results/0.1", event: data.event, groups: data.groups, results: data.results, submissions: data.submissions }, null, 2), "application/json")));
    if (!["completed", "cancelled"].includes(data.event.status)) actions.append(
      button("编辑活动", () => this.showEditor(data.event, data.participants.length > 0)),
      button("结束活动", () => this.run(status, async () => {
        const missing = data.participants.filter((participant) => participant.status === "active" && !participant.submissionRevision).length;
        if (!await interactionConfirm({ title: "结束迎香活动？", message: `结束后关闭邀请并释放活动身份。${missing ? `还有 ${missing} 人未提交结果。` : ""}`, confirmLabel: "结束活动", danger: true })) { status.textContent = ""; return; }
        await this.client!.completeEvent(eventId); await this.showDashboard(eventId);
      }))
    );
    summary.append(actions); shell.append(summary, samplesRoot);

    if (!["completed", "cancelled"].includes(data.event.status)) {
      const invite = el("section"); invite.append(el("h3", "参与邀请"));
      if (data.event.policy.participantName.mode === "organizer_assigned") {
        const prefix = data.event.policy.participantName.requiredPrefix || "参与者";
        const note = el("p", `参与名称按加入顺序自动分配：${prefix}01、${prefix}02……`); note.className = "yx-muted"; invite.append(note);
      }
      const grid = el("div"); grid.className = "yx-grid";
      const uses = input("参与人数", "10", "number"); uses.input.min = "1"; uses.input.max = "10000";
      const hours = input("有效小时数", "24", "number"); hours.input.min = "1"; hours.input.max = "168";
      grid.append(uses.label, hours.label);
      const linkArea = el("div");
      invite.append(grid, button("生成邀请", () => this.run(status, async () => {
        const count = Number(uses.input.value), duration = Number(hours.input.value);
        if (!Number.isSafeInteger(count) || count < 1 || count > 10000 || !Number.isFinite(duration) || duration < 1 || duration > 168) throw new Error("参与人数为 1–10000，有效期为 1–168 小时。");
        const created = await this.client!.createInvite(eventId, { maxUses: count, expiresAt: new Date(Date.now() + duration * 3600000).toISOString() });
        const url = created.share.webUrl ?? created.share.deepLink;
        await renderYingxiangInviteShare(linkArea, url);
        status.textContent = "邀请已生成，可扫码加入或一键复制链接。";
        await refresh();
      })), linkArea);
      for (const inviteRow of data.invites.filter((candidate) => !candidate.revokedAt && candidate.eventRevision === data.event.eventRevision)) {
        const line = el("div"); line.className = "yx-nav";
        const label = inviteRow.assignedName ?? (data.event.policy.participantName.mode === "organizer_assigned" ? "自动编号邀请" : "通用邀请");
        line.append(el("span", `${label} · ${inviteRow.useCount}/${inviteRow.maxUses ?? "不限"} · ${time(inviteRow.expiresAt)}`), button("撤销", () => this.run(status, async () => { await this.client!.revokeInvite(eventId, inviteRow.inviteId); await this.showDashboard(eventId); })));
        invite.append(line);
      }
      shell.append(invite);

      if (data.event.policy.calibrationRepeatEnabled) {
        const calibration = el("section"); calibration.append(el("h3", "同豆重复映射"));
        const coffee = input("真实咖啡名称（仅主办方可见）"); calibration.append(coffee.label);
        const checks = data.event.manifest.samples.map((sample) => {
          const label = el("label", sample.sampleCode); label.className = "yx-check";
          const control = el("input"); control.type = "checkbox"; label.prepend(control); calibration.append(label);
          return { id: sample.eventSampleId, control };
        });
        calibration.append(button("保存重复样品组", () => this.run(status, async () => {
          const ids = checks.filter((candidate) => candidate.control.checked).map((candidate) => candidate.id);
          if (!coffee.input.value.trim() || ids.length < 2) throw new Error("填写咖啡名称，并选择至少两个活动样品编号。");
          await this.client!.createCalibrationGroup(eventId, { canonicalSampleId: coffee.input.value.trim(), eventSampleIds: ids, revealPolicy: "organizer_only" });
          await this.showDashboard(eventId);
        })));
        for (const group of data.groups) calibration.append(el("p", `${group.canonicalSampleId}：${group.eventSampleIds.map((id) => data.event.manifest.samples.find((sample) => sample.eventSampleId === id)?.sampleCode ?? id).join("、")}`));
        shell.append(calibration);
      }
    }

    shell.append(live, result); renderLive(); status.textContent = "";
    this.timer = setInterval(() => {
      if (!this.root.isConnected) { this.dispose(); return; }
      if (document.visibilityState === "visible" && !this.busy) void refresh().catch((error) => { status.textContent = `更新失败，保留上次结果：${error instanceof Error ? error.message : String(error)}`; });
    }, 20000);
  }
}
