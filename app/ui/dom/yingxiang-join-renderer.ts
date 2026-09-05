import { YingxiangClient, YingxiangClientError, type YingxiangInvitePreview } from "../../core/yingxiang-client";
import { YingxiangParticipationService } from "../../core/yingxiang-participation-service";
import { cuppingModeLabel } from "../../core/session-metadata";

export interface YingxiangJoinRendererOptions {
  token: string;
  getJoinRequestId(inviteId: string): string;
  onJoined(sessionId: string): void | Promise<void>;
  onClose(): void;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-join]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangJoin = "true";
  style.textContent = `
    .yingxiang-join{display:grid;gap:16px;padding:22px;background:#151515;color:#eee9df}
    .yingxiang-join__head{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.08)}
    .yingxiang-join__title{margin:0;color:#d6ad63;font:600 24px/1.2 "Noto Serif SC","Songti SC",serif;letter-spacing:.12em}
    .yingxiang-join__close{min-width:70px;min-height:38px;border:1px solid rgba(185,153,90,.3);border-radius:8px;background:#1c1c1c;color:#c9bea4;font-weight:700}
    .yingxiang-join__event{display:grid;gap:8px;padding:15px;border:1px solid rgba(185,153,90,.2);border-radius:10px;background:#181818}
    .yingxiang-join__event h3{margin:0;color:#e2d2b0;font-size:18px}.yingxiang-join__meta{color:#9d968b;font-size:12px;line-height:1.6}
    .yingxiang-join__samples{display:flex;flex-wrap:wrap;gap:7px}.yingxiang-join__sample{padding:5px 8px;border:1px solid rgba(185,153,90,.22);border-radius:7px;background:#121212;color:#c8c0b4;font:12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}
    .yingxiang-join__form{display:grid;gap:12px;padding:15px;border:1px solid rgba(185,153,90,.2);border-radius:10px;background:#181818}
    .yingxiang-join__field{display:grid;gap:6px;color:#aaa399;font-size:12px}.yingxiang-join input{box-sizing:border-box;width:100%;min-height:44px;padding:9px 11px;border:1px solid rgba(185,153,90,.3);border-radius:8px;background:#101010;color:#f3efe7;font-size:14px}
    .yingxiang-join__choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.yingxiang-join__choice{display:flex;gap:8px;align-items:center;min-height:42px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#c7c0b6;font-size:12px}.yingxiang-join__choice input{width:18px;height:18px;min-height:0;margin:0}
    .yingxiang-join__action{min-height:52px;border:1px solid #b9995a;border-radius:9px;background:#252117;color:#ead8b3;font-size:16px;font-weight:800;letter-spacing:.08em}.yingxiang-join__action:disabled{opacity:.45}
    .yingxiang-join__status{min-height:21px;margin:0;color:#b7b0a6;font-size:12px;line-height:1.6;white-space:pre-wrap}
    .yingxiang-join__notice{margin:0;color:#858078;font-size:11px;line-height:1.55}
    @media(max-width:620px){.yingxiang-join{padding:15px}.yingxiang-join__head{grid-template-columns:1fr}.yingxiang-join__close{justify-self:end}.yingxiang-join__choices{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

export class YingxiangJoinRenderer {
  private preview?: YingxiangInvitePreview;

  constructor(
    private readonly root: HTMLElement,
    private readonly service: YingxiangParticipationService,
    private readonly client: YingxiangClient,
    private readonly options: YingxiangJoinRendererOptions
  ) {}

  async render(): Promise<void> {
    installStyles();
    this.root.replaceChildren();
    const shell = document.createElement("section");
    shell.className = "yingxiang-join";
    const loading = Object.assign(document.createElement("p"), { className: "yingxiang-join__status", textContent: "正在读取迎香邀请…" });
    shell.append(loading); this.root.append(shell);
    try {
      this.preview = await this.service.preview(this.options.token);
      this.renderReady(shell);
    } catch (error) {
      loading.textContent = error instanceof Error ? error.message : String(error);
      const close = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-join__action", textContent: "返回香迹" });
      close.addEventListener("click", () => this.options.onClose()); shell.append(close);
    }
  }

  private renderReady(shell: HTMLElement): void {
    const preview = this.preview!; shell.replaceChildren();
    const head = document.createElement("div"); head.className = "yingxiang-join__head";
    const titleWrap = document.createElement("div");
    titleWrap.append(Object.assign(document.createElement("h2"), { className: "yingxiang-join__title", textContent: "迎香 · 加入杯测" }));
    const close = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-join__close", textContent: "取消" });
    close.addEventListener("click", () => this.options.onClose()); head.append(titleWrap, close);

    const event = document.createElement("section"); event.className = "yingxiang-join__event";
    event.append(Object.assign(document.createElement("h3"), { textContent: preview.event.title }));
    event.append(Object.assign(document.createElement("div"), {
      className: "yingxiang-join__meta",
      textContent: `${preview.event.manifest.organizerName} · ${cuppingModeLabel(preview.event.manifest.cuppingMode)} · ${preview.event.manifest.samples.length} 个样品 · revision ${preview.event.eventRevision}`
    }));
    const samples = document.createElement("div"); samples.className = "yingxiang-join__samples";
    for (const sample of [...preview.event.manifest.samples].sort((a, b) => a.order - b.order)) {
      samples.append(Object.assign(document.createElement("span"), { className: "yingxiang-join__sample", textContent: sample.sampleCode }));
    }
    event.append(samples);

    const form = document.createElement("section"); form.className = "yingxiang-join__form";
    const status = Object.assign(document.createElement("p"), { className: "yingxiang-join__status", textContent: "" });
    const naming = preview.event.policy.participantName;
    const joinRequestId = this.options.getJoinRequestId(preview.invite.inviteId);
    let customName: HTMLInputElement | undefined;
    let accountName: HTMLInputElement | undefined;
    let source: "custom" | "account" = "custom";

    if (naming.mode === "organizer_assigned") {
      const assigned = preview.invite.assignedName || "主办方已分配";
      form.append(Object.assign(document.createElement("p"), { className: "yingxiang-join__notice", textContent: `本次参与名称：${assigned}。活动期间香迹只显示该临时身份。` }));
    } else {
      const choices = document.createElement("div"); choices.className = "yingxiang-join__choices";
      const customRadio = document.createElement("input"); customRadio.type = "radio"; customRadio.name = "yingxiang-name-source"; customRadio.checked = true;
      const customChoice = document.createElement("label"); customChoice.className = "yingxiang-join__choice"; customChoice.append(customRadio, document.createTextNode("本次活动名称"));
      const accountRadio = document.createElement("input"); accountRadio.type = "radio"; accountRadio.name = "yingxiang-name-source"; accountRadio.disabled = !naming.allowAccountDisplayName;
      const accountChoice = document.createElement("label"); accountChoice.className = "yingxiang-join__choice"; accountChoice.append(accountRadio, document.createTextNode("使用个人账户名称"));
      choices.append(customChoice, accountChoice); form.append(choices);

      customName = document.createElement("input"); customName.type = "text"; customName.maxLength = naming.maxLength; customName.placeholder = naming.requiredPrefix ? `需以 ${naming.requiredPrefix} 开头` : "输入本次活动使用的名称";
      const customField = document.createElement("label"); customField.className = "yingxiang-join__field"; customField.append(document.createTextNode("活动名称"), customName); form.append(customField);

      accountName = document.createElement("input"); accountName.type = "text"; accountName.maxLength = 64; accountName.placeholder = "输入并保存为你的账户显示名称";
      const accountField = document.createElement("label"); accountField.className = "yingxiang-join__field"; accountField.hidden = true; accountField.append(document.createTextNode("个人账户显示名称"), accountName); form.append(accountField);
      customRadio.addEventListener("change", () => { if (customRadio.checked) { source = "custom"; customField.hidden = false; accountField.hidden = true; } });
      accountRadio.addEventListener("change", () => { if (accountRadio.checked) { source = "account"; customField.hidden = true; accountField.hidden = false; } });
    }

    form.append(Object.assign(document.createElement("p"), {
      className: "yingxiang-join__notice",
      textContent: "加入后会在本机建立一份香迹杯测 Session。活动身份只在本次杯测有效；断网后已建立的本地记录仍可继续。"
    }));
    const join = Object.assign(document.createElement("button"), { type: "button", className: "yingxiang-join__action", textContent: "加入并开始杯测" });
    join.addEventListener("click", () => void this.join({ join, status, joinRequestId, source, customName, accountName }));
    form.append(join, status); shell.append(head, event, form);
  }

  private async join(view: {
    join: HTMLButtonElement;
    status: HTMLElement;
    joinRequestId: string;
    source: "custom" | "account";
    customName?: HTMLInputElement;
    accountName?: HTMLInputElement;
  }): Promise<void> {
    const preview = this.preview!;
    view.join.disabled = true; view.status.textContent = "正在建立活动身份和本地杯测…";
    try {
      let displayName: string | undefined;
      let nameSource: "custom" | "account" | undefined;
      if (preview.event.policy.participantName.mode === "participant_choice") {
        const selectedAccount = this.root.querySelector<HTMLInputElement>("input[name='yingxiang-name-source']:checked")?.nextSibling?.textContent?.includes("个人账户") === true;
        nameSource = selectedAccount ? "account" : "custom";
        if (nameSource === "account") {
          const value = view.accountName?.value.normalize("NFKC").trim() || "";
          if (!value) throw new Error("请输入个人账户显示名称。未登录账户不能使用此选项。");
          await this.client.setAccountDisplayName(value);
        } else {
          displayName = view.customName?.value.normalize("NFKC").trim();
          if (!displayName) throw new Error("请输入本次活动名称。");
        }
      }
      const result = await this.service.join({ token: this.options.token, joinRequestId: view.joinRequestId, displayName, nameSource });
      view.status.textContent = result.resumed ? "已恢复本次迎香杯测。" : "活动身份和本地杯测已建立。";
      await this.options.onJoined(result.sessionId);
    } catch (error) {
      view.status.textContent = error instanceof YingxiangClientError ? error.message : error instanceof Error ? error.message : String(error);
      view.join.disabled = false;
    }
  }
}
