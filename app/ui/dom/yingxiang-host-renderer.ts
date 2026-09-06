import {
  buildYingxiangManifest,
  defaultYingxiangEventPolicy,
  type YingxiangCoffeeDetail,
  type YingxiangEventPolicy
} from "../../core/yingxiang-event";
import { YingxiangClient, YingxiangClientError, type YingxiangInviteResult, type YingxiangRemoteEvent } from "../../core/yingxiang-client";
import { YingxiangCoffeeListEditor } from "./yingxiang-coffee-list-editor";
import { renderYingxiangInviteShare } from "./yingxiang-invite-share";
import { YingxiangSampleCodeImporter } from "./yingxiang-sample-code-importer";

export interface YingxiangHostRendererOptions {
  onRequireAccount(): void | Promise<void>;
  onClose(): void;
  initialEvent?: YingxiangRemoteEvent;
  structureLocked?: boolean;
  onPublished?(event: YingxiangRemoteEvent): void | Promise<void>;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-host]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangHost = "true";
  style.textContent = `
    .yingxiang-host{display:grid;gap:18px;padding:22px;color:#ece8df;background:#151515}
    .yingxiang-host [hidden]{display:none!important}
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
    .yingxiang-host__mono{overflow-wrap:anywhere;color:#d9d4ca;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
    .yingxiang-host__coffee-lock{pointer-events:none;opacity:.72}
    @media(max-width:620px){.yingxiang-host{padding:15px;gap:14px}.yingxiang-host__grid,.yingxiang-host__checks{grid-template-columns:1fr}.yingxiang-host__head{grid-template-columns:1fr}.yingxiang-host__close{justify-self:end}}
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
  private coffeeEditor?: YingxiangCoffeeListEditor;
  private sampleCodeImporter?: YingxiangSampleCodeImporter;

  constructor(private readonly root: HTMLElement, private readonly client: YingxiangClient | undefined, private readonly options: YingxiangHostRendererOptions) {}

  render(): void {
    installStyles(); this.coffeeEditor?.dispose(); this.root.replaceChildren(); this.event = this.options.initialEvent;
    const shell = document.createElement("section"); shell.className = "yingxiang-host";
    const head = document.createElement("div"); head.className = "yingxiang-host__head";
    const copy = document.createElement("div");
    copy.append(Object.assign(document.createElement("h2"), { className: "yingxiang-host__title", textContent: "迎香" }), Object.assign(document.createElement("p"), { className: "yingxiang-host__sub", textContent: "发布多人杯测 · 主办方账号独立 · 参与身份仅在本次活动有效" }));
    const close = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-host__close", textContent: "返回" }); close.addEventListener("click", () => this.options.onClose()); head.append(copy, close);

    const eventSection = document.createElement("section"); eventSection.className = "yingxiang-host__section"; eventSection.append(Object.assign(document.createElement("h3"), { textContent: "活动与样品" }));
    const grid = document.createElement("div"); grid.className = "yingxiang-host__grid";
    const eventTitle = Object.assign(document.createElement("input"), { type: "text", maxLength: 120, placeholder: "例如：周末埃塞俄比亚盲测" });
    const organizerName = Object.assign(document.createElement("input"), { type: "text", maxLength: 120, placeholder: "参与者可见，例如：某某咖啡" });
    const cuppingMode = document.createElement("select"); cuppingMode.append(new Option("盲测", "blind"), new Option("半盲测", "semi_blind"), new Option("公开杯测", "open"));
    const sampleCodes = Object.assign(document.createElement("textarea"), { placeholder: "一行一个样品编号，例如：\nA01\nA02\nA03" });
    const sampleCodeField = field("样品编号（一行一个）", sampleCodes, true);
    const sampleCodeTools = document.createElement("div"); sampleCodeField.append(sampleCodeTools);
    grid.append(field("活动名称", eventTitle, true), field("组织方显示名称", organizerName), field("杯测模式", cuppingMode), sampleCodeField);
    eventSection.append(grid, Object.assign(document.createElement("p"), { className: "yingxiang-host__hint", textContent: "样品编号可直接输入，也可拍照、上传图片、导入表格或粘贴识别。盲测和半盲测只向参与者发布样品槽位；下方真实咖啡信息不会随邀请公开。" }));

    const coffeeSection = document.createElement("section"); coffeeSection.className = "yingxiang-host__section"; coffeeSection.append(Object.assign(document.createElement("h3"), { textContent: "真实咖啡对应" }));
    coffeeSection.append(Object.assign(document.createElement("p"), { className: "yingxiang-host__hint", textContent: "录入方式与香迹样品输入共用同一识别基础：拍照/图片、表格、粘贴。导入后按当前位置对应上方样品编号；拖动时原位置保留虚拟占位，松手后落到最终占位位置。" }));
    const coffeeRoot = document.createElement("div"); coffeeSection.append(coffeeRoot);

    const policySection = document.createElement("section"); policySection.className = "yingxiang-host__section"; policySection.append(Object.assign(document.createElement("h3"), { textContent: "参与身份规则" }));
    const policyGrid = document.createElement("div"); policyGrid.className = "yingxiang-host__grid";
    const namingMode = document.createElement("select"); namingMode.append(new Option("参与者自定义名称", "participant_choice"), new Option("名称前缀 + 加入顺序自动编号", "organizer_assigned"));
    const prefix = Object.assign(document.createElement("input"), { type: "text", maxLength: 24, placeholder: "自动编号示例：评委01、评委02" });
    const maxNameLength = Object.assign(document.createElement("input"), { type: "number", min: "1", max: "64", value: "24" });
    const prefixField = field("参与名称前缀（可选）", prefix, true);
    policyGrid.append(field("参与名称方式", namingMode), field("参与名称最大长度", maxNameLength), prefixField);
    const allowAccount = checkbox("允许主动使用个人香迹账户名称", true); const uniqueName = checkbox("活动内参与名称必须唯一", true); const calibration = checkbox("允许同一只豆子重复出现用于校准", true);
    const checks = document.createElement("div"); checks.className = "yingxiang-host__checks"; checks.append(allowAccount.wrapper, uniqueName.wrapper, calibration.wrapper); policySection.append(policyGrid, checks);

    const createButton = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-host__action", textContent: "发布杯测" });
    const status = Object.assign(document.createElement("p"), { className: "yingxiang-host__status", textContent: "" });
    const inviteSection = document.createElement("section"); inviteSection.className = "yingxiang-host__section"; inviteSection.hidden = true; inviteSection.append(Object.assign(document.createElement("h3"), { textContent: "生成参与邀请" }));
    const inviteGrid = document.createElement("div"); inviteGrid.className = "yingxiang-host__grid";
    const maxUses = Object.assign(document.createElement("input"), { type: "number", min: "1", max: "10000", value: "10" });
    const expiryHours = Object.assign(document.createElement("input"), { type: "number", min: "1", max: "168", value: "24" });
    inviteGrid.append(field("参与人数", maxUses), field("有效小时数", expiryHours));
    const inviteButton = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-host__action", textContent: "生成邀请" }); inviteSection.append(inviteGrid, Object.assign(document.createElement("p"), { className: "yingxiang-host__hint", textContent: "选择自动编号时，不再为每个邀请手工指定名称；参与者按成功加入顺序依次获得名称。" }), inviteButton);

    const result = document.createElement("section"); result.className = "yingxiang-host__result"; result.hidden = true;
    const resultMeta = document.createElement("div"); resultMeta.className = "yingxiang-host__mono";
    const shareRoot = document.createElement("div");
    result.append(Object.assign(document.createElement("strong"), { textContent: "邀请已生成" }), resultMeta, shareRoot);

    const updateNamingUi = () => {
      const automatic = namingMode.value === "organizer_assigned";
      allowAccount.input.disabled = automatic;
      if (automatic) {
        allowAccount.input.checked = false;
        prefixField.firstChild!.textContent = "自动名称前缀";
        if (!prefix.value.trim()) prefix.value = "参与者";
      } else {
        prefixField.firstChild!.textContent = "参与名称固定前缀（可选）";
      }
    };
    namingMode.addEventListener("change", updateNamingUi);

    const initial = this.options.initialEvent;
    if (initial) {
      eventTitle.value = initial.title; organizerName.value = initial.manifest.organizerName; cuppingMode.value = initial.manifest.cuppingMode;
      sampleCodes.value = initial.manifest.samples.map((sample) => sample.sampleCode).join("\n");
      namingMode.value = initial.policy.participantName.mode; prefix.value = initial.policy.participantName.requiredPrefix ?? "";
      maxNameLength.value = String(initial.policy.participantName.maxLength); allowAccount.input.checked = initial.policy.participantName.allowAccountDisplayName;
      uniqueName.input.checked = initial.policy.participantName.uniqueWithinEvent; calibration.input.checked = initial.policy.calibrationRepeatEnabled;
      createButton.textContent = "保存并重新发布";
    }
    updateNamingUi();

    this.sampleCodeImporter = new YingxiangSampleCodeImporter(sampleCodeTools, sampleCodes, {
      onCodesChanged: (codes) => this.coffeeEditor?.setSampleCodes(codes)
    });
    this.sampleCodeImporter.render();
    this.coffeeEditor = new YingxiangCoffeeListEditor(coffeeRoot, {
      sampleCodes: normalizedLines(sampleCodes.value),
      initial: initial?.manifest.samples.map((sample) => sample.coffee),
      onChange: () => { /* values are read atomically at publish time */ }
    });
    this.coffeeEditor.render();
    sampleCodes.addEventListener("input", () => this.coffeeEditor?.setSampleCodes(normalizedLines(sampleCodes.value)));

    if (this.options.structureLocked) {
      for (const control of [organizerName, cuppingMode, sampleCodes, namingMode, prefix, maxNameLength, allowAccount.input, uniqueName.input, calibration.input]) control.disabled = true;
      this.sampleCodeImporter.setDisabled(true);
      coffeeRoot.classList.add("yingxiang-host__coffee-lock");
      status.textContent = "已有参与者，样品、真实咖啡对应关系和身份规则已锁定；当前仍可修改活动名称。重新发布后需生成新邀请。";
    } else if (initial) {
      status.textContent = "重新发布后旧邀请失效，请生成新邀请。";
    }

    createButton.addEventListener("click", () => void this.createEvent({ eventTitle, organizerName, cuppingMode, sampleCodes, namingMode, prefix, maxNameLength, allowAccount: allowAccount.input, uniqueName: uniqueName.input, calibration: calibration.input, createButton, status, inviteSection }));
    inviteButton.addEventListener("click", () => void this.createInvite({ maxUses, expiryHours, inviteButton, status, result, resultMeta, shareRoot }));
    shell.append(head, eventSection, coffeeSection, policySection, createButton, status, inviteSection, result); this.root.append(shell);
  }

  private async createEvent(view: {
    eventTitle: HTMLInputElement; organizerName: HTMLInputElement; cuppingMode: HTMLSelectElement; sampleCodes: HTMLTextAreaElement;
    namingMode: HTMLSelectElement; prefix: HTMLInputElement; maxNameLength: HTMLInputElement; allowAccount: HTMLInputElement;
    uniqueName: HTMLInputElement; calibration: HTMLInputElement; createButton: HTMLButtonElement; status: HTMLElement; inviteSection: HTMLElement;
  }): Promise<void> {
    if (!this.client) { view.status.textContent = "迎香云端服务尚未配置，发布功能不可用；本地香迹杯测不受影响。"; return; }
    const title = view.eventTitle.value.normalize("NFKC").trim(); if (!title) { view.status.textContent = "请填写活动名称。"; return; }
    const maxLength = Number(view.maxNameLength.value); if (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 64) { view.status.textContent = "参与名称最大长度必须为 1–64。"; return; }
    const automatic = view.namingMode.value === "organizer_assigned";
    const prefix = view.prefix.value.normalize("NFKC").trim() || (automatic ? "参与者" : "");
    if (automatic && Array.from(prefix).length + 2 > maxLength) { view.status.textContent = "自动名称前缀过长：至少需要为两位顺序号预留 2 个字符。"; return; }
    let manifest;
    try {
      manifest = buildYingxiangManifest({
        organizerName: view.organizerName.value,
        cuppingMode: view.cuppingMode.value === "open" ? "open" : view.cuppingMode.value === "semi_blind" ? "semi_blind" : "blind",
        sampleCodes: normalizedLines(view.sampleCodes.value),
        coffees: this.coffeeEditor?.values()
      });
    } catch (error) { view.status.textContent = error instanceof Error ? error.message : "样品列表无效。"; return; }
    let policy: YingxiangEventPolicy = {
      ...defaultYingxiangEventPolicy(),
      participantName: {
        mode: automatic ? "organizer_assigned" : "participant_choice",
        allowAccountDisplayName: automatic ? false : view.allowAccount.checked,
        uniqueWithinEvent: view.uniqueName.checked,
        minLength: 1,
        maxLength,
        ...(prefix ? { requiredPrefix: prefix } : {})
      },
      calibrationRepeatEnabled: view.calibration.checked
    };
    if (this.options.structureLocked && this.event) { manifest = this.event.manifest; policy = this.event.policy; }
    else if (this.event) {
      manifest = { ...manifest, samples: manifest.samples.map((sample) => {
        const old = this.event!.manifest.samples.find((value) => value.sampleCode === sample.sampleCode);
        return old ? { ...sample, eventSampleId: old.eventSampleId } : sample;
      }) };
    }
    view.createButton.disabled = true; view.status.textContent = "正在发布…";
    try {
      this.event = this.event
        ? await this.client.republish(this.event.eventId, { expectedRevision: this.event.eventRevision, title, policy, manifest })
        : await this.client.createEvent({ title, policy, manifest, publish: true });
      view.inviteSection.hidden = false;
      view.status.textContent = `已发布：${this.event.title} · ${this.event.manifest.samples.length} 个样品`;
      await this.options.onPublished?.(this.event);
    } catch (error) {
      if (error instanceof YingxiangClientError && error.code === "UNAUTHORIZED") {
        view.status.textContent = "迎香主办方会话已失效，请重新输入迎香账号。"; await this.options.onRequireAccount();
      } else view.status.textContent = error instanceof Error ? error.message : String(error);
    } finally { view.createButton.disabled = false; }
  }

  private async createInvite(view: {
    maxUses: HTMLInputElement; expiryHours: HTMLInputElement; inviteButton: HTMLButtonElement; status: HTMLElement;
    result: HTMLElement; resultMeta: HTMLElement; shareRoot: HTMLElement;
  }): Promise<void> {
    if (!this.client || !this.event) return;
    const uses = Number(view.maxUses.value); const hours = Number(view.expiryHours.value);
    if (!Number.isSafeInteger(uses) || uses < 1 || uses > 10000 || !Number.isFinite(hours) || hours < 1 || hours > 168) {
      view.status.textContent = "参与人数需为 1–10000，有效期需为 1–168 小时。"; return;
    }
    view.inviteButton.disabled = true; view.status.textContent = "正在生成邀请…";
    try {
      this.invite = await this.client.createInvite(this.event.eventId, { maxUses: uses, expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() });
      const url = this.invite.share.webUrl || this.invite.share.deepLink;
      view.result.hidden = false;
      view.resultMeta.textContent = `event ${this.invite.eventId} · revision ${this.invite.eventRevision} · ${uses} 人 · 到期 ${new Date(this.invite.expiresAt).toLocaleString()}`;
      await renderYingxiangInviteShare(view.shareRoot, url);
      view.status.textContent = "邀请已生成。可直接扫码加入，也可一键复制下方链接。";
    } catch (error) { view.status.textContent = error instanceof Error ? error.message : String(error); }
    finally { view.inviteButton.disabled = false; }
  }
}
