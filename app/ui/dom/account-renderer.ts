import type { AuthSession, CloudflareAuthClient } from "../../core/auth-client";
import { button, clearElement, element } from "./dom-helpers";

export interface AccountRendererOptions {
  onAuthenticated(session: AuthSession): void | Promise<void>;
  onSkip(): void | Promise<void>;
}

export class AccountRenderer {
  constructor(
    private readonly root: HTMLElement,
    private readonly auth: CloudflareAuthClient,
    private readonly options: AccountRendererOptions
  ) {}

  async render(): Promise<void> {
    clearElement(this.root);
    const current = await this.auth.current();
    if (current) {
      const card = element("section", "account-card");
      card.append(
        element("h1", "account-card__title", "AromaSense · 香迹"),
        element("p", "account-card__text", `已登录：${current.email}`),
        button("account-card__primary", "进入杯测", () => this.options.onAuthenticated(current)),
        button("account-card__secondary", "退出登录", async () => {
          await this.auth.logout();
          await this.render();
        })
      );
      this.root.append(card);
      return;
    }

    const card = element("section", "account-card");
    const title = element("h1", "account-card__title", "AromaSense · 香迹");
    const note = element("p", "account-card__text", "账户仅用于云备份与跨设备恢复；离线杯测不依赖登录。 ");
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
          ? await this.auth.login(email.value, password.value)
          : await this.auth.register(email.value, password.value);
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
      button("account-card__link", "离线使用", () => this.options.onSkip())
    );
    card.append(title, note, email, password, status, actions);
    this.root.append(card);
  }
}
