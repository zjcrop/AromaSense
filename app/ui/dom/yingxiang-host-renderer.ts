import { buildYingxiangManifest, defaultYingxiangEventPolicy, type YingxiangEventPolicy } from "../../core/yingxiang-event";
import { YingxiangClient, YingxiangClientError, type YingxiangInviteResult, type YingxiangRemoteEvent } from "../../core/yingxiang-client";

export interface YingxiangHostRendererOptions {
  onRequireAccount(): void | Promise<void>;
  onClose(): void;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-host]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangHost = "true";
  style.textContent = `
    .yingxiang-host{display:grid;gap:18px;padding:22px;color:#ece8df;background:#151515}
    .yingxiang-host__head{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.08)}
    .yingxiang-host__title{margin:0;color:#d6ad63;font:600 24px/1.2 "Noto Serif SC","Songti SC",serif;letter-spacing:.12em}
    .yingxiang-host__sub{margin:7px 0 0;color:#9b958b;font-size:12px;line-height:1.6}
    .yingxiang-host__close{min-width:76px;min-height:38px;border:1px solid rgba(185,153,90,.32);border-radius:8px;background:#1b1b1b;color:#c9bea4;font-weight:700}
    .yingxiang-host__section{display:grid;gap:12px;padding:16px;border:1px solid rgba(185,153,90,.18);border-radius:10px;background:#181818}
    .yingxiang-host__section h3{margin:0 0 2px;color:#d6ad63;font-size:14px;letter-spacing:.12em}
    .yingxiang-host__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .yingxiang-host__field{display:grid;gap:6px;min-width:0;color:#a7a095;font-size:12px}.yingxiang-host__field--wide{grid-column:1/-1}
    .yingxiang-host input,.yingxiang-host select,.yingxiang-host textarea{box-sizing:border-box;width:100%;min-height:44px;padding:8px 10px;border:1px solid rgba(185,153,90,.28);border-radius:8px;background:#111;color:#f1eee8;font:inherit;font-size:14px}
    .yingxiang-host textarea{min-height:112px;resize:vertical;line-height:1.5}.yingxiang-host__hint{margin:0;color:#827c73;font-size:11px;line-height:1.55}
    .yingxiang-host__checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .yingxiang-host__check{display:flex;gap:8px;align-items:center;min-height:40px;color:#c6c0b7;font-size:13px}.yingxiang-host__check input{width:18px;height:18px;min-height:0;margin:0}
    .yingxiang-host__action{min-height:52px;border:1px solid #b9995a;border-radius:9px;background:#252117;color:#ead8b3;font-size:16px;font-weight:800;letter-spacing:.08em}.yingxiang-host__action:disabled{opacity:.45}
    .yingxiang-host__status{min-height:22px;margin:0;color:#b9b1a6;font-size:12px;line-height:1.55;white-space:pre-wrap}
    .yingxiang-host__result{display:grid;gap:10px;padding:14px;border:1px solid rgba(105,163,128,.32);border-radius:9px;background:rgba(62,111,82,.10)}.yingxiang-host__result[hidden]{display:none}
    .yingxiang-host__share{display:grid;grid-template-columns:1fr auto;gap:8px}.yingxiang-host__copy{min-width:86px;border:1px solid rgba(185,153,90,.35);border-radius:8px;background:#1c1c1c;color:#d7c7a7;font-weight:700}
    .yingxiang-host__mono{overflow-wrap:anywhere;color:#d9d4ca;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
    @media(max-width:620px){.yingxiang-host{padding:15px;gap:14px}.yingxiang-host__grid,.yingxiang-host__checks{grid-template-columns:1fr}.yingxiang-host__head{grid-template-columns:1fr}.yingxiang-host__close{justify-self:end}.yingxiang-host__share{grid-template-columns:1fr}.yingxiang-host__copy{min-height:40px}}
  `;
  document.head.append(style);
}

function field(label: string, control: HTMLElement, wide = false): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = `yingxiang-host__field${wide ? " yingxiang-host__field--wide" : ""}`;
  wrapper.append(document.createTextNode(label), control); return wrapper;
}
function checkbox(label: string, checked: boolean): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked;
  const wrapper = document.createElement("label"); wrapper.className = "yingxiang-host__check"; wrapper.append(input, document.createTextNode(label));
  return { wrapper, input };
}
function normalizedLines(value: string): string[] { return value.split(/\r?\n/u).map((line) => line.normalize("NFKC").trim()).filter(Boolean); }

export class YingxiangHostRenderer {
  private event?: YingxiangRemoteEvent;
  private invite?: YingxiangInviteResult;
  constructor(private readonly root: HTMLElement, private readonly client: YingxiangClient | undefined, private readonly options: YingxiangHostRendererOptions) {}

  render(): void {
    installStyles(); this.root.replaceChildren();
    const shell = document.createElement("section"); shell.className = "yingxiang-host";
    const head = document.createElement("div"); head.className = "yingxiang-host__head";
    const copy = document.createElement("div");
    copy.append(Object.assign(document.createElement("h2"), { className: "yingxiang-host__title", textContent: "迎香" }), Object.assign(document.createElement("p"), { className: "yingxiang-host__sub", textContent: "发布多人杯测 · 活动身份仅在本次杯测有效 · 参与者无需注册" }));
    const close = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-host__close", textContent: "返回" }); close.addEventListener("click", () => this.options.onClose()); head.append(copy, close);

    const eventSection = document.createElement("section"); eventSection.className = "yingxiang-host__section"; eventSection.append(Object.assign(document.createElement("h3"), { textContent: "活动与样品" }));
    const grid = document.createElement("div"); grid.className = "yingxiang-host__grid";
    const eventTitle = Object.assign(document.createElement("input"), { type: "text", maxLength: 120, placeholder: "例如：周末埃塞俄比亚盲测" });
    const organizerName = Object.assign(document.createElement("input"), { type: "text", maxLength: 120, placeholder: "参与者可见，例如：某某咖啡" });
    const cuppingMode = document.createElement("select"); cuppingMode.append(new Option("盲测", "blind"), new Option("半盲测", "semi_blind"), new Option("公开杯测", "open"));
    const sampleCodes = Object.assign(document.createElement("textarea"), { placeholder: "一行一个样品编号，例如：\nA01\nA02\nA03" });
    grid.append(field("活动名称", eventTitle, true), field("组织方显示名称", organizerName), field("杯测模式", cuppingMode), field("样品编号（一行一个）", sampleCodes, true));
    eventSection.append(grid, Object.assign(document.createElement("p"), { className: "yingxiang-host__hint", textContent: "盲测模式只向参与者发布槽位与样品编号；真实咖啡身份和重复校准映射不会随邀请公开。" }));

    const policySection = document.createElement("section"); policySection.className = "yingxiang-host__section"; policySection.append(Object.assign(document.createElement("h3"), { textContent: "参与身份规则" }));
    const policyGrid = document.createElement("div"); policyGrid.className = "yingxiang-host__grid";
    const namingMode = document.createElement("select"); namingMode.append(new Option("参与者自定义名称", "participant_choice"), new Option("主办方为每个邀请分配名称", "organizer_assigned"));
    const prefix = Object.assign(document.createElement("input"), { type: "text", maxLength: 16, placeholder: "可选，例如 P-" });
    const maxNameLength = Object.assign(document.createElement("input"), { type: "number", min: "1", max: "64", value: "24" });
    policyGrid.append(field("参与名称方式", namingMode), field("参与名称最大长度", maxNameLength), field("参与名称固定前缀（可选）", prefix, true));
    const allowAccount = checkbox("允许主动使用个人账户名称", true); const uniqueName = checkbox("活动内参与名称必须唯一", true); const calibration = checkbox("允许同一只豆子重复出现用于校准", true);
    const checks = document.createElement("div"); checks.className = "yingxiang-host__checks"; checks.append(allowAccount.wrapper, uniqueName.wrapper, calibration.wrapper); policySection.append(policyGrid, checks);

    const createButton = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-host__action", textContent: "发布杯测" });
    const status = Object.assign(document.createElement("p"), { className: "yingxiang-host__status", textContent: "" });
    const inviteSection = document.createElement("section"); inviteSection.className = "yingxiang-host__section"; inviteSection.hidden = true; inviteSection.append(Object.assign(document.createElement("h3"), { textContent: "生成参与邀请" }));
    const inviteGrid = document.createElement("div"); inviteGrid.className = "yingxiang-host__grid";
    const assignedName = Object.assign(document.createElement("input"), { type: "text", maxLength: 64, placeholder: "仅主办方分配名称模式需要" });
    const maxUses = Object.assign(document.createElement("input"), { type: "number", min: "1", max: "10000", value: "1" });
    const expiryHours = Object.assign(document.createElement("input"), { type: "number", min: "1", max: "168", value: "24" });
    inviteGrid.append(field("分配参与名称", assignedName), field("邀请可使用次数", maxUses), field("有效小时数", expiryHours));
    const inviteButton = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-host__action", textContent: "生成邀请链接" }); inviteSection.append(inviteGrid, inviteButton);

    const result = document.createElement("section"); result.className = "yingxiang-host__result"; result.hidden = true;
    const resultMeta = document.createElement("div"); resultMeta.className = "yingxiang-host__mono"; const share = document.createElement("div"); share.className = "yingxiang-host__share";
    const shareText = document.createElement("div"); shareText.className = "yingxiang-host__mono"; const copyButton = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-host__copy", textContent: "复制链接" });
    share.append(shareText, copyButton); result.append(Object.assign(document.createElement("strong"), { textContent: "邀请已生成" }), resultMeta, share);

    namingMode.addEventListener("change", () => { const assigned = namingMode.value === "organizer_assigned"; allowAccount.input.disabled = assigned; if (assigned) allowAccount.input.checked = false; assignedName.disabled = !assigned; }); assignedName.disabled = true;
    createButton.addEventListener("click", () => void this.createEvent({ eventTitle, organizerName, cuppingMode, sampleCodes, namingMode, prefix, maxNameLength, allowAccount: allowAccount.input, uniqueName: uniqueName.input, calibration: calibration.input, createButton, status, inviteSection, assignedName }));
    inviteButton.addEventListener("click", () => void this.createInvite({ assignedName, maxUses, expiryHours, inviteButton, status, result, resultMeta, shareText }));
    copyButton.addEventListener("click", () => void this.copyInvite(copyButton));
    shell.append(head, eventSection, policySection, createButton, status, inviteSection, result); this.root.append(shell);
  }

  private async createEvent(view: { eventTitle: HTMLInputElement; organizerName: HTMLInputElement; cuppingMode: HTMLSelectElement; sampleCodes: HTMLTextAreaElement; namingMode: HTMLSelectElement; prefix: HTMLInputElement; maxNameLength: HTMLInputElement; allowAccount: HTMLInputElement; uniqueName: HTMLInputElement; calibration: HTMLInputElement; createButton: HTMLButtonElement; status: HTMLElement; inviteSection: HTMLElement; assignedName: HTMLInputElement }): Promise<void> {
    if (!this.client) { view.status.textContent = "迎香云端服务尚未配置，发布功能不可用；本地香迹杯测不受影响。"; return; }
    const title = view.eventTitle.value.normalize("NFKC").trim(); if (!title) { view.status.textContent = "请填写活动名称。"; return; }
    const maxLength = Number(view.maxNameLength.value); if (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 64) { view.status.textContent = "参与名称最大长度必须为 1–64。"; return; }
    let manifest;
    try { manifest = buildYingxiangManifest({ organizerName: view.organizerName.value, cuppingMode: view.cuppingMode.value === "open" ? "open" : view.cuppingMode.value === "semi_blind" ? "semi_blind" : "blind", sampleCodes: normalizedLines(view.sampleCodes.value) }); }
    catch (error) { view.status.textContent = error instanceof Error ? error.message : "样品列表无效。"; return; }
    const policy: YingxiangEventPolicy = { ...defaultYingxiangEventPolicy(), participantName: { mode: view.namingMode.value === "organizer_assigned" ? "organizer_assigned" : "participant_choice", allowAccountDisplayName: view.allowAccount.checked, uniqueWithinEvent: view.uniqueName.checked, minLength: 1, maxLength, ...(view.prefix.value.normalize("NFKC").trim() ? { requiredPrefix: view.prefix.value.normalize("NFKC").trim() } : {}) }, calibrationRepeatEnabled: view.calibration.checked };
    view.createButton.disabled = true; view.status.textContent = "正在发布…";
    try { this.event = await this.client.createEvent({ title, policy, manifest, publish: true }); view.inviteSection.hidden = false; view.assignedName.disabled = policy.participantName.mode !== "organizer_assigned"; view.status.textContent = `已发布：${this.event.title} · ${this.event.manifest.samples.length} 个样品 · revision ${this.event.eventRevision}`; }
    catch (error) { if (error instanceof YingxiangClientError && error.code === "UNAUTHORIZED") { view.status.textContent = "发布迎香杯测必须先登录主账户。"; await this.options.onRequireAccount(); } else view.status.textContent = error instanceof Error ? error.message : String(error); }
    finally { view.createButton.disabled = false; }
  }

  private async createInvite(view: { assignedName: HTMLInputElement; maxUses: HTMLInputElement; expiryHours: HTMLInputElement; inviteButton: HTMLButtonElement; status: HTMLElement; result: HTMLElement; resultMeta: HTMLElement; shareText: HTMLElement }): Promise<void> {
    if (!this.client || !this.event) return; const uses = Number(view.maxUses.value); const hours = Number(view.expiryHours.value);
    if (!Number.isSafeInteger(uses) || uses < 1 || uses > 10000 || !Number.isFinite(hours) || hours < 1 || hours > 168) { view.status.textContent = "邀请次数需为 1–10000，有效期需为 1–168 小时。"; return; }
    view.inviteButton.disabled = true; view.status.textContent = "正在生成邀请…";
    try { this.invite = await this.client.createInvite(this.event.eventId, { assignedName: view.assignedName.value.normalize("NFKC").trim() || undefined, maxUses: uses, expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() }); view.result.hidden = false; view.resultMeta.textContent = `event ${this.invite.eventId} · revision ${this.invite.eventRevision} · ${this.invite.maxUses ?? "不限"} 次 · 到期 ${this.invite.expiresAt}`; view.shareText.textContent = this.invite.share.webUrl || this.invite.share.deepLink; view.status.textContent = "邀请已生成。明文 token 仅在本次返回中提供，服务器只保存哈希。"; }
    catch (error) { view.status.textContent = error instanceof Error ? error.message : String(error); } finally { view.inviteButton.disabled = false; }
  }

  private async copyInvite(button: HTMLButtonElement): Promise<void> {
    if (!this.invite) return; const value = this.invite.share.webUrl || this.invite.share.deepLink;
    try { await navigator.clipboard.writeText(value); button.textContent = "已复制"; setTimeout(() => { button.textContent = "复制链接"; }, 1200); } catch { button.textContent = "复制失败"; }
  }
}
