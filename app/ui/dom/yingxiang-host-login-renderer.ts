import {
  createYingxiangDeviceSecret,
  YingxiangHostAuthClient,
  YingxiangHostAuthError,
  type YingxiangHostSession,
  yingxiangCredentialKey,
  yingxiangRecoveryKey
} from "../../core/yingxiang-host-auth";

export interface YingxiangHostLoginRendererOptions {
  onAuthenticated(session: YingxiangHostSession): void | Promise<void>;
  onClose(): void;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-host-login]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangHostLogin = "true";
  style.textContent = `
    .yx-host-login{display:grid;gap:16px;padding:24px;background:#151515;color:#eee9df;font:15px/1.55 system-ui,sans-serif}
    .yx-host-login__head{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.08)}
    .yx-host-login h2{margin:0;color:#d6ad63;font:600 24px/1.2 "Noto Serif SC","Songti SC",serif;letter-spacing:.12em}
    .yx-host-login__close,.yx-host-login__secondary,.yx-host-login__primary{min-height:44px;border-radius:8px;font:inherit;font-weight:700;cursor:pointer}
    .yx-host-login__close,.yx-host-login__secondary{border:1px solid rgba(185,153,90,.3);background:#1c1c1c;color:#c9bea4}
    .yx-host-login__primary{border:1px solid #b9995a;background:#2a2419;color:#ead8b3}
    .yx-host-login__form{display:grid;gap:11px;padding:16px;border:1px solid rgba(185,153,90,.2);border-radius:10px;background:#181818}
    .yx-host-login__field{display:grid;gap:6px;color:#aaa399;font-size:12px}.yx-host-login input{box-sizing:border-box;width:100%;min-height:46px;padding:10px 11px;border:1px solid rgba(185,153,90,.34);border-radius:8px;background:#101010;color:#f3efe7;font:inherit}
    .yx-host-login__actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.yx-host-login__note,.yx-host-login__status{margin:0;font-size:12px;line-height:1.6}.yx-host-login__note{color:#8f8a82}.yx-host-login__status{min-height:20px;color:#d6ad63}
    .yx-host-login__recovery{display:grid;gap:9px;padding:11px;border:1px solid rgba(105,163,128,.26);border-radius:8px;background:#121713}.yx-host-login__recovery[hidden]{display:none!important}.yx-host-login__recovery-code{overflow-wrap:anywhere;padding:9px;border-radius:6px;background:#0d0f0d;color:#d7e3d7;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
    @media(max-width:520px){.yx-host-login{padding:16px}.yx-host-login__head{grid-template-columns:1fr}.yx-host-login__close{justify-self:end}.yx-host-login__actions{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

function normalizeAccountName(value: string): string {
  return value.normalize("NFKC").trim();
}

function storedSecret(accountName: string): string | undefined {
  try {
    const value = window.localStorage.getItem(yingxiangCredentialKey(accountName))?.trim().toLowerCase();
    return value && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function saveSecret(accountName: string, secret: string): void {
  try { window.localStorage.setItem(yingxiangCredentialKey(accountName), secret); } catch { /* login remains valid in memory for this entry */ }
}

function storedRecovery(accountName: string): string | undefined {
  try {
    const value = window.localStorage.getItem(yingxiangRecoveryKey(accountName))?.trim().toLowerCase();
    return value && /^[a-f0-9]{48}$/u.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function saveRecovery(accountName: string, recoveryCode: string): void {
  try { window.localStorage.setItem(yingxiangRecoveryKey(accountName), recoveryCode); } catch { /* user can still copy the one-time code when shown */ }
}

async function copyText(value: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(value); return true; } catch { return false; }
}

export class YingxiangHostLoginRenderer {
  private busy = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly auth: YingxiangHostAuthClient,
    private readonly options: YingxiangHostLoginRendererOptions
  ) {}

  render(): void {
    installStyles();
    this.root.replaceChildren();
    const shell = document.createElement("section"); shell.className = "yx-host-login";
    const head = document.createElement("div"); head.className = "yx-host-login__head";
    const title = document.createElement("h2"); title.textContent = "迎香 · 主办方登录";
    const close = document.createElement("button"); close.type = "button"; close.className = "yx-host-login__close"; close.textContent = "返回香迹"; close.onclick = () => this.options.onClose();
    head.append(title, close);

    const form = document.createElement("section"); form.className = "yx-host-login__form";
    const field = document.createElement("label"); field.className = "yx-host-login__field"; field.append(document.createTextNode("迎香账号"));
    const account = document.createElement("input"); account.type = "text"; account.autocomplete = "off"; account.maxLength = 32; account.placeholder = "每次进入迎香都需输入"; field.append(account);
    const note = document.createElement("p"); note.className = "yx-host-login__note";
    note.textContent = "迎香主办方账号与香迹账户分离。正常登录使用本设备凭据；换设备时使用一次性恢复码重新绑定，恢复后旧设备凭据失效。";
    const status = document.createElement("p"); status.className = "yx-host-login__status";
    const actions = document.createElement("div"); actions.className = "yx-host-login__actions";
    const login = document.createElement("button"); login.type = "button"; login.className = "yx-host-login__primary"; login.textContent = "登录迎香";
    const create = document.createElement("button"); create.type = "button"; create.className = "yx-host-login__secondary"; create.textContent = "首次创建账号";
    const recoverToggle = document.createElement("button"); recoverToggle.type = "button"; recoverToggle.className = "yx-host-login__secondary"; recoverToggle.textContent = "换设备恢复";
    const showRecovery = document.createElement("button"); showRecovery.type = "button"; showRecovery.className = "yx-host-login__secondary"; showRecovery.textContent = "查看本机恢复码";
    actions.append(login, create, recoverToggle, showRecovery);

    const recovery = document.createElement("section"); recovery.className = "yx-host-login__recovery"; recovery.hidden = true;
    const recoveryField = document.createElement("label"); recoveryField.className = "yx-host-login__field"; recoveryField.append(document.createTextNode("恢复码"));
    const recoveryInput = document.createElement("input"); recoveryInput.type = "text"; recoveryInput.autocomplete = "off"; recoveryInput.maxLength = 48; recoveryInput.placeholder = "48 位恢复码"; recoveryField.append(recoveryInput);
    const recoveryActions = document.createElement("div"); recoveryActions.className = "yx-host-login__actions";
    const recover = document.createElement("button"); recover.type = "button"; recover.className = "yx-host-login__primary"; recover.textContent = "恢复到本设备";
    const cancelRecovery = document.createElement("button"); cancelRecovery.type = "button"; cancelRecovery.className = "yx-host-login__secondary"; cancelRecovery.textContent = "取消";
    recoveryActions.append(recover, cancelRecovery); recovery.append(recoveryField, recoveryActions);

    form.append(field, note, actions, recovery, status); shell.append(head, form); this.root.append(shell);
    account.focus();
    account.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void this.login(account, login, create, recoverToggle, showRecovery, status); } });
    login.onclick = () => void this.login(account, login, create, recoverToggle, showRecovery, status);
    create.onclick = () => void this.create(account, login, create, recoverToggle, showRecovery, status);
    recoverToggle.onclick = () => { recovery.hidden = false; recoveryInput.value = ""; recoveryInput.focus(); status.textContent = "输入之前保存的恢复码。成功恢复后该恢复码立即作废，并生成新恢复码。"; };
    cancelRecovery.onclick = () => { recovery.hidden = true; recoveryInput.value = ""; status.textContent = ""; account.focus(); };
    recover.onclick = () => void this.recover(account, recoveryInput, login, create, recoverToggle, showRecovery, recover, cancelRecovery, status);
    showRecovery.onclick = () => void this.showStoredRecovery(account, status);
  }

  private validateName(account: HTMLInputElement, status: HTMLElement): string | undefined {
    const name = normalizeAccountName(account.value);
    if (Array.from(name).length < 2) { status.textContent = "请输入 2–32 个字符的迎香账号。"; account.focus(); return undefined; }
    return name;
  }

  private async login(account: HTMLInputElement, login: HTMLButtonElement, create: HTMLButtonElement, recoverToggle: HTMLButtonElement, showRecovery: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (this.busy) return;
    const name = this.validateName(account, status); if (!name) return;
    const secret = storedSecret(name);
    if (!secret) {
      status.textContent = "本设备没有这个迎香账号的设备凭据。首次使用可创建账号；已有账号请使用“换设备恢复”。";
      return;
    }
    await this.run([login, create, recoverToggle, showRecovery], status, async () => this.auth.login(name, secret));
  }

  private async create(account: HTMLInputElement, login: HTMLButtonElement, create: HTMLButtonElement, recoverToggle: HTMLButtonElement, showRecovery: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (this.busy) return;
    const name = this.validateName(account, status); if (!name) return;
    const existing = storedSecret(name);
    if (existing) { status.textContent = "本设备已经保存该账号凭据，请直接登录。"; return; }
    const secret = createYingxiangDeviceSecret();
    await this.run([login, create, recoverToggle, showRecovery], status, async () => {
      const session = await this.auth.register(name, secret);
      saveSecret(session.accountName, secret);
      return session;
    });
  }

  private async recover(
    account: HTMLInputElement,
    recoveryInput: HTMLInputElement,
    login: HTMLButtonElement,
    create: HTMLButtonElement,
    recoverToggle: HTMLButtonElement,
    showRecovery: HTMLButtonElement,
    recover: HTMLButtonElement,
    cancelRecovery: HTMLButtonElement,
    status: HTMLElement
  ): Promise<void> {
    if (this.busy) return;
    const name = this.validateName(account, status); if (!name) return;
    const recoveryCode = recoveryInput.value.trim().toLowerCase();
    if (!/^[a-f0-9]{48}$/u.test(recoveryCode)) { status.textContent = "恢复码应为 48 位十六进制字符。"; recoveryInput.focus(); return; }
    const nextDeviceSecret = createYingxiangDeviceSecret();
    await this.run([login, create, recoverToggle, showRecovery, recover, cancelRecovery], status, async () => {
      const session = await this.auth.recover(name, recoveryCode, nextDeviceSecret);
      saveSecret(session.accountName, nextDeviceSecret);
      return session;
    });
  }

  private async showStoredRecovery(account: HTMLInputElement, status: HTMLElement): Promise<void> {
    const name = this.validateName(account, status); if (!name) return;
    const code = storedRecovery(name);
    if (!code) { status.textContent = "本机没有保存这个账号的恢复码。若仍能在原设备登录，下一次登录会为旧账号补发；否则需要使用此前另行保存的恢复码。"; return; }
    const copied = await copyText(code);
    status.textContent = copied ? `恢复码已复制：${code}` : `本机恢复码：${code}`;
  }

  private async run(buttons: HTMLButtonElement[], status: HTMLElement, work: () => Promise<YingxiangHostSession>): Promise<void> {
    this.busy = true; for (const button of buttons) button.disabled = true; status.textContent = "正在验证迎香账号…";
    try {
      const session = await work();
      if (session.recoveryCode) saveRecovery(session.accountName, session.recoveryCode);
      status.textContent = session.recoveryCode
        ? `已登录迎香账号：${session.accountName}。本机已保存新的恢复码；恢复码仅用于换设备。`
        : `已登录迎香账号：${session.accountName}`;
      await this.options.onAuthenticated(session);
    } catch (error) {
      status.textContent = error instanceof YingxiangHostAuthError ? error.message : error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false; for (const button of buttons) button.disabled = false;
    }
  }
}
