import { AuthClientError, type AuthSession, type CloudflareAuthClient } from "../../core/auth-client";
import { button, clearElement, element } from "./dom-helpers";

export interface AccountSyncSummary {
  pending: number;
  uploading: number;
  synced: number;
  failed: number;
  conflict: number;
}

export interface AccountRendererOptions {
  onAuthenticated(session: AuthSession): void | Promise<void>;
  onSkip(): void | Promise<void>;
  onSync?(): void | Promise<void>;
  getSyncSummary?(): Promise<AccountSyncSummary>;
}

type AccountMode = "login" | "register";

export class AccountRenderer {
  constructor(
    private readonly root: HTMLElement,
    private readonly auth: CloudflareAuthClient | undefined,
    private readonly options: AccountRendererOptions
  ) {}

  async render(mode: AccountMode = "login", notice = ""): Promise<void> {
    clearElement(this.root);
    const summary = await this.options.getSyncSummary?.();
    if (!this.auth) {
      this.renderUnavailable(summary);
      return;
    }

    const current = await this.auth.current();
    if (current) {
      this.renderSignedIn(current, summary);
      return;
    }

    const pending = await this.auth.pendingRegistration();
    if (pending && mode === "login" && !notice) {
      this.renderPendingVerification(pending.email, summary);
      return;
    }
    this.renderAuthForm(mode, summary, notice, pending?.email);
  }

  private renderSignedIn(current: AuthSession, summary?: AccountSyncSummary): void {
    const card = element("section", "account-card");
    const status = element("div", "account-card__status account-card__status--good");
    status.textContent = "服务器同步账户已登录";
    card.append(
      element("h1", "account-card__title", "AromaSense · 香迹"),
      status,
      element("p", "account-card__text", current.email),
      element("p", "account-card__text", "身份认证由 Firebase Authentication 管理；杯测与同步数据仍由 AromaSense Cloudflare Worker + D1 管理。"),
      this.renderSyncSummary(summary)
    );
    const message = element("div", "account-card__inline-message");
    message.hidden = true;
    const actions = element("div", "account-card__actions");
    const syncButton = button("account-card__primary", "立即同步", async () => {
      syncButton.disabled = true;
      message.hidden = false;
      message.textContent = "正在核对本机与云端数据…";
      try {
        await this.options.onSync?.();
        message.textContent = "数据同步已完成";
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "数据同步失败，请稍后重试";
      } finally {
        syncButton.disabled = false;
      }
    });
    actions.append(
      syncButton,
      button("account-card__secondary", "进入杯测", () => this.options.onAuthenticated(current)),
      button("account-card__secondary", "退出登录", async () => {
        await this.auth?.logout();
        await this.render();
      }),
      button("account-card__link", "返回本地杯测", () => this.options.onSkip())
    );
    card.append(message, actions);
    this.root.append(card);
  }

  private renderAuthForm(mode: AccountMode, summary?: AccountSyncSummary, notice = "", presetEmail = ""): void {
    const registering = mode === "register";
    const card = element("section", "account-card");
    const title = element("h1", "account-card__title", registering ? "注册服务器同步账户" : "登录服务器同步账户");
    const note = element(
      "p",
      "account-card__text",
      "邮箱注册、验证和密码找回由 Firebase Authentication 提供；登录后 AromaSense 仅取得身份凭据用于 D1 数据同步，本地杯测始终不依赖登录。"
    );
    const email = element("input", "account-card__input");
    email.type = "email";
    email.autocomplete = "email";
    email.placeholder = "邮箱";
    email.value = presetEmail;
    const password = element("input", "account-card__input");
    password.type = "password";
    password.autocomplete = registering ? "new-password" : "current-password";
    password.placeholder = "密码（至少 10 位）";
    const confirm = element("input", "account-card__input");
    confirm.type = "password";
    confirm.autocomplete = "new-password";
    confirm.placeholder = "再次输入密码";
    confirm.hidden = !registering;
    const status = element("div", "account-card__status");
    status.hidden = !notice;
    status.textContent = notice;

    const validate = (): string | undefined => {
      const normalizedEmail = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return "邮箱格式无效。";
      if (password.value.length < 10) return "密码至少需要 10 位。";
      if (registering && password.value !== confirm.value) return "两次输入的密码不一致。";
      return undefined;
    };

    const submit = async () => {
      const validation = validate();
      if (validation) {
        status.textContent = validation;
        status.hidden = false;
        return;
      }
      status.hidden = false;
      try {
        if (registering) {
          status.textContent = "正在通过 Firebase 创建账户…";
          const result = await this.auth!.register(email.value, password.value);
          this.renderPendingVerification(result.email, summary);
          return;
        }
        status.textContent = "正在验证 Firebase 身份并连接 AromaSense 云端…";
        const session = await this.auth!.login(email.value, password.value);
        status.classList.add("account-card__status--good");
        status.textContent = "登录成功，正在核对本机与云端数据…";
        await this.options.onAuthenticated(session);
      } catch (error) {
        status.classList.remove("account-card__status--good");
        status.textContent = error instanceof Error ? error.message : String(error);
        if (error instanceof AuthClientError && error.code === "EMAIL_NOT_VERIFIED") {
          const pendingEmail = email.value.trim().toLowerCase();
          window.setTimeout(() => this.renderPendingVerification(pendingEmail, summary), 0);
        }
      }
    };

    const actions = element("div", "account-card__actions");
    actions.append(
      button("account-card__secondary", registering ? "已有账户" : "注册账户", () => this.render(registering ? "login" : "register", "")),
      button("account-card__primary", registering ? "提交注册" : "登录", submit)
    );
    if (!registering) {
      actions.append(button("account-card__link", "忘记密码", () => this.renderPasswordReset(email.value, summary)));
    }
    actions.append(button("account-card__link", "离线使用 / 返回", () => this.options.onSkip()));
    for (const input of [email, password, confirm]) {
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") void submit(); });
    }
    card.append(title, note, this.renderSyncSummary(summary), email, password, confirm, status, actions);
    this.root.replaceChildren(card);
  }

  private renderPendingVerification(email: string, summary?: AccountSyncSummary): void {
    const card = element("section", "account-card account-card--verification");
    card.append(
      element("h1", "account-card__title", "等待邮箱验证"),
      element("p", "account-card__verification-main", `Firebase 验证邮件已发送至 ${email}。完成邮箱验证后，返回 AromaSense 使用相同邮箱和密码登录。`),
      element("p", "account-card__text", "若未收到邮件，请检查垃圾邮件目录。需要重新发送时，请在下方再次输入账户密码。"),
      this.renderSyncSummary(summary)
    );
    const password = element("input", "account-card__input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.placeholder = "账户密码（用于重新发送验证邮件）";
    const status = element("div", "account-card__inline-message");
    status.hidden = true;
    const actions = element("div", "account-card__actions");
    const resend = button("account-card__secondary", "重新发送验证邮件", async () => {
      if (password.value.length < 10) {
        status.hidden = false;
        status.textContent = "请输入当前账户密码后再重新发送验证邮件。";
        return;
      }
      resend.disabled = true;
      status.hidden = false;
      status.textContent = "正在请求 Firebase 重新发送验证邮件…";
      try {
        await this.auth?.resendVerification(email, password.value);
        status.textContent = "验证邮件已重新发送，请查阅邮箱。";
        this.startResendCooldown(resend, 60);
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
        resend.disabled = false;
      }
    });
    actions.append(
      button("account-card__primary", "返回登录", () => this.render("login", "完成邮箱验证后，请使用相同邮箱和密码登录。")),
      resend,
      button("account-card__link", "忘记密码", () => this.renderPasswordReset(email, summary)),
      button("account-card__link", "继续离线使用", () => this.options.onSkip())
    );
    password.addEventListener("keydown", (event) => { if (event.key === "Enter") resend.click(); });
    card.append(password, status, actions);
    this.root.replaceChildren(card);
  }

  private renderPasswordReset(presetEmail = "", summary?: AccountSyncSummary): void {
    const card = element("section", "account-card");
    const email = element("input", "account-card__input");
    email.type = "email";
    email.autocomplete = "email";
    email.placeholder = "注册邮箱";
    email.value = presetEmail.trim();
    const status = element("div", "account-card__inline-message");
    status.hidden = true;
    const send = button("account-card__primary", "发送密码重置邮件", async () => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        status.hidden = false;
        status.textContent = "请输入有效邮箱地址。";
        return;
      }
      send.disabled = true;
      status.hidden = false;
      status.textContent = "正在请求 Firebase 发送密码重置邮件…";
      try {
        await this.auth?.requestPasswordReset(email.value);
        status.classList.add("account-card__status--good");
        status.textContent = "如果该邮箱对应 AromaSense 账户，Firebase 将发送密码重置邮件。";
      } catch (error) {
        status.classList.remove("account-card__status--good");
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        send.disabled = false;
      }
    });
    email.addEventListener("keydown", (event) => { if (event.key === "Enter") send.click(); });
    const actions = element("div", "account-card__actions");
    actions.append(
      send,
      button("account-card__secondary", "返回登录", () => this.render("login", "")),
      button("account-card__link", "继续离线使用", () => this.options.onSkip())
    );
    card.append(
      element("h1", "account-card__title", "忘记密码"),
      element("p", "account-card__text", "密码重置邮件由 Firebase Authentication 发送；AromaSense Worker 不保存或发送密码重置邮件。"),
      this.renderSyncSummary(summary),
      email,
      status,
      actions
    );
    this.root.replaceChildren(card);
  }

  private startResendCooldown(buttonNode: HTMLButtonElement, seconds: number): void {
    const end = Date.now() + Math.max(1, seconds) * 1000;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (!remaining) {
        buttonNode.disabled = false;
        buttonNode.textContent = "重新发送验证邮件";
        return;
      }
      buttonNode.disabled = true;
      buttonNode.textContent = `${remaining}s 后可重新发送`;
      window.setTimeout(update, 1000);
    };
    update();
  }

  private renderUnavailable(summary?: AccountSyncSummary): void {
    const card = element("section", "account-card account-card--unavailable");
    const status = element("div", "account-card__cloud-state");
    status.append(
      element("strong", "account-card__cloud-state-title", "云端认证尚未配置"),
      element("span", "account-card__cloud-state-text", "当前构建缺少 Cloudflare Worker URL 或 Firebase Authentication 配置，因此注册、登录和上传暂不可执行；本地杯测与本地记录不受影响。")
    );
    const disabledActions = element("div", "account-card__actions");
    const login = button("account-card__primary", "登录", () => undefined);
    const register = button("account-card__secondary", "注册", () => undefined);
    login.disabled = true;
    register.disabled = true;
    disabledActions.append(login, register, button("account-card__link", "返回本地杯测", () => this.options.onSkip()));
    card.append(
      element("h1", "account-card__title", "账户与同步"),
      element("p", "account-card__text", "Firebase 负责账户身份；Cloudflare 负责 AromaSense 数据。两端配置完整后才开放云端账户功能。"),
      status,
      this.renderSyncSummary(summary),
      disabledActions
    );
    this.root.append(card);
  }

  private renderSyncSummary(summary?: AccountSyncSummary): HTMLElement {
    const box = element("div", "account-card__sync-summary");
    if (!summary) {
      box.textContent = "本地同步队列：尚无统计";
      return box;
    }
    box.append(
      element("span", "account-card__sync-stat", `待同步 ${summary.pending}`),
      element("span", "account-card__sync-stat", `上传中 ${summary.uploading}`),
      element("span", "account-card__sync-stat", `已同步 ${summary.synced}`),
      element("span", `account-card__sync-stat${summary.failed ? " is-warning" : ""}`, `失败 ${summary.failed}`),
      element("span", `account-card__sync-stat${summary.conflict ? " is-warning" : ""}`, `冲突 ${summary.conflict}`)
    );
    return box;
  }
}
