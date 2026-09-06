import { YingxiangClient, type YingxiangDashboard, type YingxiangRemoteEvent } from "../../core/yingxiang-client";
import { YingxiangDeliveryService } from "../../core/yingxiang-delivery-service";
import type { SQLiteDriver } from "../../storage/local-cupping-repository";
import { YingxiangHostRenderer } from "./yingxiang-host-renderer";

interface Options { onClose(): void; onRequireAccount(): void | Promise<void>; onOpenSession(id: string): void | Promise<void>; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; }
function button(text: string, work: () => void | Promise<void>): HTMLButtonElement { const b=el("button",text); b.type="button"; b.onclick=()=>{void work();}; return b; }
function input(label: string, value = "", type = "text"): { label: HTMLLabelElement; input: HTMLInputElement } { const l=el("label",label); const i=el("input"); i.type=type; i.value=value; l.append(i); return {label:l,input:i}; }
function time(v: string | null): string { return v ? new Date(v).toLocaleString() : "尚未回传"; }
function num(v: number | null): string { return v === null ? "—" : v.toFixed(2); }
const stages: Record<string,string> = {aroma:"香气",high_temp:"高温",mid_temp:"中温",low_temp:"低温",flavor:"风味",overall:"综评",scoring:"评分"};
const stateLabel: Record<string,string> = {draft:"草稿",published:"进行中",active:"进行中",completed:"已结束",cancelled:"已取消"};
function download(name: string, content: string, mime: string): void { const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=el("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function table(headers: string[], rows: (string | number | HTMLElement)[][]): HTMLElement {
  const wrap=el("div");wrap.className="yx-table";const t=el("table");const h=el("tr");for(const v of headers)h.append(el("th",v));const head=el("thead");head.append(h);const body=el("tbody");
  for(const row of rows){const tr=el("tr");for(const value of row){const td=el("td");if(value instanceof HTMLElement)td.append(value);else td.textContent=String(value);tr.append(td);}body.append(tr);}t.append(head,body);wrap.append(t);return wrap;
}
function styles(): void {
  if(document.querySelector("style[data-yx-console]"))return;
  const s=el("style");s.dataset.yxConsole="true";s.textContent=`
    .yx-console{padding:20px;display:grid;gap:16px;background:#151515;color:#eee;font:16px/1.55 system-ui,sans-serif}
    .yx-console [hidden]{display:none!important}
    .yx-console h2,.yx-console h3,.yx-console p{margin:0}.yx-console h2{color:#d6ad63}.yx-console h3{font-size:17px}
    .yx-console button{min-height:44px;padding:8px 13px;border:1px solid #7c6844;background:#242119;color:#ead8b3;border-radius:7px;font:inherit;cursor:pointer}.yx-console button:disabled{opacity:.5;cursor:default}
    .yx-nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.yx-nav h2{flex:1}.yx-console section{display:grid;gap:12px;padding:14px;border:1px solid #39352d;border-radius:9px;min-width:0}
    .yx-console label{display:grid;gap:5px;font-size:14px}.yx-console input,.yx-console select{min-height:44px;min-width:0;box-sizing:border-box;width:100%;background:#101010;color:#eee;border:1px solid #706045;border-radius:6px;padding:8px;font:inherit}
    .yx-console .yx-check{display:flex;gap:8px;align-items:center}.yx-check input{width:20px;min-height:20px;margin:0}
    .yx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.yx-muted{font-size:14px;color:#b8b1a5}.yx-status{font-size:14px;color:#d6ad63;white-space:pre-wrap;overflow-wrap:anywhere}
    .yx-table{overflow:auto}.yx-table table{border-collapse:collapse;white-space:nowrap;font-size:14px;width:100%}.yx-table th,.yx-table td{padding:8px;text-align:left;border-bottom:1px solid #35332e}.yx-table th{color:#cabc9d}.yx-console a{color:#e9cf9b;overflow-wrap:anywhere}
    @media(max-width:620px){.yx-console{padding:14px}.yx-grid{grid-template-columns:1fr}.yx-console section{padding:11px}.yx-nav button{font-size:14px}}
  `;document.head.append(s);
}

export class YingxiangConsoleRenderer {
  private timer?: ReturnType<typeof setInterval>;
  private screen=0;
  private busy=false;
  constructor(private readonly root:HTMLElement,private readonly client:YingxiangClient|undefined,private readonly db:SQLiteDriver,private readonly delivery:YingxiangDeliveryService|undefined,private readonly options:Options){}
  dispose():void{this.screen++;if(this.timer)clearInterval(this.timer);this.timer=undefined;}
  private shell(title:string):HTMLElement {
    this.dispose();styles();this.root.replaceChildren();const shell=el("div");shell.className="yx-console";const nav=el("div");nav.className="yx-nav";
    nav.append(el("h2",title),button("返回香迹",()=>this.options.onClose()));const tabs=el("nav");tabs.className="yx-nav";
    tabs.append(button("我的活动",()=>this.showEvents()),button("我的参与",()=>this.showParticipations()),button("新建杯测",()=>this.showEditor()));shell.append(nav,tabs);this.root.append(shell);return shell;
  }
  private async run(status:HTMLElement,work:()=>Promise<void>):Promise<void>{if(this.busy)return;this.busy=true;status.textContent="处理中…";try{await work();}catch(e){status.textContent=e instanceof Error?e.message:String(e);}finally{this.busy=false;}}
  async render():Promise<void>{await this.showEvents();}
  async showEvents():Promise<void>{
    const shell=this.shell("迎香 · 我的活动");const status=el("p","正在读取…");status.className="yx-status";shell.append(status);const screen=this.screen;
    if(!this.client){status.textContent="当前未配置迎香服务。";return;}
    try{const events=await this.client.listEvents();if(screen!==this.screen)return;status.textContent=events.length?"":"还没有发布活动。登录后可新建杯测。";
      for(const event of events){const card=el("section");card.append(el("h3",event.title),el("p",`${stateLabel[event.status]} · ${event.manifest.organizerName} · ${event.manifest.samples.length} 个样品`),button("管理活动",()=>this.showDashboard(event.eventId)));shell.append(card);}
    }catch(e){if(screen!==this.screen)return;status.textContent=e instanceof Error?e.message:String(e);shell.append(button("登录主办方账户",()=>this.options.onRequireAccount()));}
  }
  private showEditor(event?:YingxiangRemoteEvent,locked=false):void {
    this.dispose();new YingxiangHostRenderer(this.root,this.client,{onClose:()=>{void this.showEvents();},onRequireAccount:this.options.onRequireAccount,initialEvent:event,structureLocked:locked,onPublished:e=>this.showDashboard(e.eventId)}).render();
  }
  async showParticipations():Promise<void>{
    const shell=this.shell("迎香 · 我的参与");const status=el("p");status.className="yx-status";shell.append(status);
    if(!this.delivery){status.textContent="当前未配置迎香服务。";return;}
    shell.append(button("重试提交与更新状态",()=>this.run(status,async()=>{await this.delivery!.sync();await this.showParticipations();})));
    const rows=await this.delivery.list();if(!rows.length)status.textContent="通过主办方邀请加入的杯测会显示在这里。";
    for(const row of rows){const p=await this.db.get<{title:string;display_name:string;status:string}>(`SELECT s.title,p.display_name,p.status FROM sessions s JOIN yingxiang_session_bindings b ON b.session_id=s.session_id JOIN yingxiang_event_principals p ON p.participant_id=b.participant_id AND p.event_id=b.event_id WHERE s.session_id=?`,[row.session_id]);
      const card=el("section");card.append(el("h3",p?.title??"迎香杯测"),el("p",`${p?.display_name??"参与者"} · ${p?.status==="released"?"活动身份已释放":"本次活动身份"}`));
      const note=el("p",row.last_error??(row.ack_revision?"结果已送达主办方":"已保存到本机，完成杯测后自动提交"));note.className="yx-status";card.append(note,button("打开本地杯测",()=>this.options.onOpenSession(row.session_id)));
      if(p?.status==="active")card.append(button("退出本次活动",()=>this.run(note,async()=>{if(!window.confirm("退出后不能再向本次活动提交；本地杯测记录会保留。确认退出？")){note.textContent="";return;}await this.delivery!.leave(row);await this.showParticipations();})));shell.append(card);
    }
  }
  async showDashboard(eventId:string):Promise<void>{
    if(!this.client)return;const shell=this.shell("迎香 · 活动管理");const status=el("p","正在读取活动…");status.className="yx-status";shell.append(status);const screen=this.screen;
    let data:YingxiangDashboard;try{data=await this.client.dashboard(eventId);}catch(e){status.textContent=e instanceof Error?e.message:String(e);return;}if(screen!==this.screen)return;
    const summary=el("section");const title=el("h3",data.event.title);const meta=el("p");summary.append(title,meta);const actions=el("div");actions.className="yx-nav";
    const live=el("section");const result=el("section");let loading=false;
    const renderLive=():void=>{meta.textContent=`${stateLabel[data.event.status]} · ${data.event.manifest.samples.length} 个样品 · ${data.participants.length} 人加入 · ${data.results.submissions} 人已交卷`;
      live.replaceChildren(el("h3","参与进度"),el("p","在线时每 20 秒刷新；进度以参与者最后回传为准。"));
      live.append(table(["参与名称","最终评分确认","结果回收","最近回传","操作"],data.participants.map(p=>[p.displayName,`${p.submissionRevision?data.event.manifest.samples.length:p.completedSamples??0}/${data.event.manifest.samples.length}`,p.submissionRevision?"已收到":p.status==="released"?"已释放":"未提交",time(p.receivedAt??p.progressAt),p.status==="active"?button("释放身份",()=>this.run(status,async()=>{if(!window.confirm(`释放 ${p.displayName} 的本次活动身份？本地记录仍保留。`)){status.textContent="";return;}await this.client!.releaseParticipant(eventId,p.participantId);await refresh();})):"—"])));
      result.replaceChildren(el("h3","结果汇总"),el("p","按样品编号和阶段分别计算；每人只计最新提交，缺测不补零。"));
      if(data.results.metrics.length)result.append(table(["样品","阶段","指标","人数","均值","标准差"],data.results.metrics.map(m=>[m.sampleCode,stages[m.stageId]??m.stageId,m.label,m.count,num(m.mean),num(m.sd)])));else result.append(el("p","尚无可汇总的已提交结果。"));
      result.append(el("h3","重复校准"),el("p","标准差衡量同豆重复记录的离散程度；与他人均值之差仅表示本组相对偏移，不代表正确答案或感官能力评分。"));
      if(data.results.calibration.length)result.append(table(["咖啡","参与者","阶段","指标","有效重复","均值","标准差","与其他人均值之差"],data.results.calibration.map(m=>[m.canonicalSampleId,m.displayName,stages[m.stageId]??m.stageId,m.label,`${m.count}/${m.expectedRepeats}`,num(m.mean),num(m.sd),num(m.offsetFromPeers)])));else result.append(el("p","设置重复样品映射后，至少收到同阶段、同指标的两次记录才能计算。"));
    };
    const refresh=async():Promise<void>=>{if(loading)return;loading=true;try{const next=await this.client!.dashboard(eventId);if(screen!==this.screen)return;data=next;title.textContent=data.event.title;renderLive();status.textContent=`已更新 ${new Date().toLocaleTimeString()}`;}finally{loading=false;}};
    actions.append(button("刷新",()=>this.run(status,refresh)),button("导出完整结果",()=>download(`迎香-${eventId}-结果.json`,JSON.stringify({schemaVersion:"yingxiang-results/0.1",event:data.event,groups:data.groups,results:data.results,submissions:data.submissions},null,2),"application/json")));
    if(!["completed","cancelled"].includes(data.event.status))actions.append(button("编辑活动",()=>this.showEditor(data.event,data.participants.length>0)),button("结束活动",()=>this.run(status,async()=>{const missing=data.participants.filter(p=>p.status==="active"&&!p.submissionRevision).length;if(!window.confirm(`结束后关闭邀请并释放活动身份。${missing?`还有 ${missing} 人未提交结果。`:""}确认结束？`)){status.textContent="";return;}await this.client!.completeEvent(eventId);await this.showDashboard(eventId);})));summary.append(actions);shell.append(summary);
    if(!["completed","cancelled"].includes(data.event.status)){
      const invite=el("section");invite.append(el("h3","参与邀请"));const grid=el("div");grid.className="yx-grid";const assigned=input("分配参与名称");assigned.label.hidden=data.event.policy.participantName.mode!=="organizer_assigned";
      const uses=input("最多加入人数","1","number");uses.input.min="1";uses.input.max="10000";const hours=input("有效小时数","24","number");hours.input.min="1";hours.input.max="168";grid.append(assigned.label,uses.label,hours.label);const linkArea=el("div");
      invite.append(grid,button("生成邀请链接",()=>this.run(status,async()=>{const u=Number(uses.input.value),h=Number(hours.input.value);if(!Number.isSafeInteger(u)||u<1||u>10000||!Number.isFinite(h)||h<1||h>168)throw new Error("人数为 1–10000，有效期为 1–168 小时。");const r=await this.client!.createInvite(eventId,{assignedName:assigned.input.value||undefined,maxUses:u,expiresAt:new Date(Date.now()+h*3600000).toISOString()});const url=r.share.webUrl??r.share.deepLink;const a=el("a",url);a.href=url;a.target="_blank";a.rel="noopener noreferrer";linkArea.replaceChildren(a,button("复制链接",()=>this.run(status,async()=>{await navigator.clipboard.writeText(url);status.textContent="链接已复制。";})));await refresh();})),linkArea);
      for(const i of data.invites.filter(i=>!i.revokedAt&&i.eventRevision===data.event.eventRevision)){const line=el("div");line.className="yx-nav";line.append(el("span",`${i.assignedName??"通用邀请"} · ${i.useCount}/${i.maxUses??"不限"} · ${time(i.expiresAt)}`),button("撤销",()=>this.run(status,async()=>{await this.client!.revokeInvite(eventId,i.inviteId);await this.showDashboard(eventId);})));invite.append(line);}shell.append(invite);
      if(data.event.policy.calibrationRepeatEnabled){const cal=el("section");cal.append(el("h3","同豆重复映射"));const coffee=input("真实咖啡名称（仅主办方可见）");cal.append(coffee.label);const checks=data.event.manifest.samples.map(s=>{const l=el("label",s.sampleCode);l.className="yx-check";const i=el("input");i.type="checkbox";l.prepend(i);cal.append(l);return{id:s.eventSampleId,i};});
        cal.append(button("保存重复样品组",()=>this.run(status,async()=>{const ids=checks.filter(c=>c.i.checked).map(c=>c.id);if(!coffee.input.value.trim()||ids.length<2)throw new Error("填写咖啡名称，并选择至少两个活动样品编号。");await this.client!.createCalibrationGroup(eventId,{canonicalSampleId:coffee.input.value.trim(),eventSampleIds:ids,revealPolicy:"organizer_only"});await this.showDashboard(eventId);})));for(const g of data.groups)cal.append(el("p",`${g.canonicalSampleId}：${g.eventSampleIds.map(id=>data.event.manifest.samples.find(s=>s.eventSampleId===id)?.sampleCode??id).join("、")}`));shell.append(cal);}
    }
    shell.append(live,result);renderLive();status.textContent="";
    this.timer=setInterval(()=>{if(!this.root.isConnected){this.dispose();return;}if(document.visibilityState==="visible"&&!this.busy)void refresh().catch(e=>{status.textContent=`更新失败，保留上次结果：${e instanceof Error?e.message:String(e)}`;});},20000);
  }
}
