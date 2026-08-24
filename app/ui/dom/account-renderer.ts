import type { AuthSession, CloudflareAuthClient } from "../../core/auth-client";
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

export class AccountRenderer {
  constructor(
    private readonly root: HTMLElement,
    private readonly auth: CloudflareAuthClient | undefined,
    private readonly options: AccountRendererOptions
  ) {}

  async render(): Promise<void> {
    clearElement(this.root);
    const summary = await this.options.getSyncSummary?.();
    if (!this.auth) {
      this.renderUnavailable(summary);
      return;
    }

    const current = await this.auth.current();
    if (current) {
      const card = element("section", "account-card");
      card.append(
        element("h1", "account-card__title", "AromaSense · 香迹"),
        element("p", "account-card__text", `已登录：${current.email}`),
        this.renderSyncSummary(summary)
      );
      const actions = element("div", "account-card__actions");
      actions.append(
        button("account-card__primary", "立即同步", async () => {
          await this.options.onSync?.();
          await this.render();
        }),
        button("account-card__secondary", "进入杯测", () => this.options.onAuthenticated(current)),
        button("account-card__secondary", "退出登录", async () => {
          await this.auth?.logout();
          await this.render();
        }),
        button("account-card__link", "返回本地杯测", () => this.options.onSkip())
      );
      card.append(actions);
      this.root.append(card);
      return;
    }

    const card = element("section", "account-card");
    const title = element("h1", "account-card__title", "账户与同步");
    const note = element("p", "account-card__text", "账户只负责云备份与跨设备恢复；本地杯测、退出后继续和数据保存不依赖登录。 ");
    const email = element("input", "account-card__input");
    email.type = "email";
    email.autocomplete = "email";
    email.placeholder = "邮箱";
    const password = element("input", "account-card__input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.placeholder = "密码（至少 10 位）";
    const status = element("div", "account-card__status");
    status.hidden = true;

    const run = async (kind: "login" | "register") => {
      status.hidden = true;
      try {
        const session = kind === "login"
          ? await this.auth!.login(email.value, password.value)
          : await this.auth!.register(email.value, password.value);
        await this.options.onAuthenticated(session);
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.hidden = false;
      }
    };

    const actions = element("div", "account-card__actions");
    actions.append(
      button("account-card__primary", "登录", () => run("login")),
      button("account-card__secondary", "注册", () => run("register")),
      button("account-card__link", "离线使用 / 返回", () => this.options.onSkip())
    );
    card.append(title, note, this.renderSyncSummary(summary), email, password, status, actions);
    this.root.append(card);
  }

  private renderUnavailable(summary?: AccountSyncSummary): void {
    const card = element("section", "account-card account-card--unavailable");
    const status = element("div", "account-card__cloud-state");
    status.append(
      element("strong", "account-card__cloud-state-title", "云服务未配置"),
      element("span", "account-card__cloud-state-text", "网页/应用当前没有 AROMASENSE_CLOUD_URL，因此注册、登录和上传暂不可执行；本地功能不受影响。")
    );
    const disabledActions = element("div", "account-card__actions");
    const login = button("account-card__primary", "登录", () => undefined);
    const register = button("account-card__secondary", "注册", () => undefined);
    login.disabled = true;
    register.disabled = true;
    disabledActions.append(login, register, button("account-card__link", "返回本地杯测", () => this.options.onSkip()));
    card.append(
      element("h1", "account-card__title", "账户与同步"),
      element("p", "account-card__text", "入口保持可见，避免把‘后端未配置’误认为‘产品没有账户功能’。"),
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
