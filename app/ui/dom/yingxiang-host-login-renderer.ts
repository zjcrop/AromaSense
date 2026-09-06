import {
  createYingxiangDeviceSecret,
  YingxiangHostAuthClient,
  YingxiangHostAuthError,
  type YingxiangHostSession,
  yingxiangCredentialKey
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
    note.textContent = "迎香主办方账号与香迹账户分离。本版本采用本设备凭据保护；首次使用可创建账号，之后仍需每次输入账号名称登录。";
    const status = document.createElement("p"); status.className = "yx-host-login__status";
    const actions = document.createElement("div"); actions.className = "yx-host-login__actions";
    const login = document.createElement("button"); login.type = "button"; login.className = "yx-host-login__primary"; login.textContent = "登录迎香";
    const create = document.createElement("button"); create.type = "button"; create.className = "yx-host-login__secondary"; create.textContent = "首次创建账号";
    actions.append(login, create); form.append(field, note, actions, status); shell.append(head, form); this.root.append(shell);
    account.focus();
    account.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void this.login(account, login, create, status); } });
    login.onclick = () => void this.login(account, login, create, status);
    create.onclick = () => void this.create(account, login, create, status);
  }

  private async login(account: HTMLInputElement, login: HTMLButtonElement, create: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (this.busy) return;
    const name = normalizeAccountName(account.value);
    if (Array.from(name).length < 2) { status.textContent = "请输入 2–32 个字符的迎香账号。"; account.focus(); return; }
    const secret = storedSecret(name);
    if (!secret) {
      status.textContent = "本设备没有这个迎香账号的凭据。若为首次使用，请点击“首次创建账号”。";
      return;
    }
    await this.run(login, create, status, async () => this.auth.login(name, secret));
  }

  private async create(account: HTMLInputElement, login: HTMLButtonElement, create: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (this.busy) return;
    const name = normalizeAccountName(account.value);
    if (Array.from(name).length < 2) { status.textContent = "请输入 2–32 个字符的迎香账号。"; account.focus(); return; }
    const existing = storedSecret(name);
    if (existing) { status.textContent = "本设备已经保存该账号凭据，请直接登录。"; return; }
    const secret = createYingxiangDeviceSecret();
    await this.run(login, create, status, async () => {
      const session = await this.auth.register(name, secret);
      saveSecret(session.accountName, secret);
      return session;
    });
  }

  private async run(
    login: HTMLButtonElement,
    create: HTMLButtonElement,
    status: HTMLElement,
    work: () => Promise<YingxiangHostSession>
  ): Promise<void> {
    this.busy = true; login.disabled = true; create.disabled = true; status.textContent = "正在验证迎香账号…";
    try {
      const session = await work();
      status.textContent = `已登录迎香账号：${session.accountName}`;
      await this.options.onAuthenticated(session);
    } catch (error) {
      status.textContent = error instanceof YingxiangHostAuthError ? error.message : error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false; login.disabled = false; create.disabled = false;
    }
  }
}
