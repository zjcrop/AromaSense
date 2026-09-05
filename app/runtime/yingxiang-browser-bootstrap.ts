import { YingxiangClient } from "../core/yingxiang-client";
import { LocalAuthSessionStore } from "../storage/auth-session-store";
import type { SQLiteDriver } from "../storage/local-cupping-repository";
import { UserPreferencesRepository } from "../storage/user-preferences-repository";
import { YingxiangHostRenderer } from "../ui/dom/yingxiang-host-renderer";

function installOverlayStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-overlay]")) return;
  const style = document.createElement("style");
  style.dataset.yingxiangOverlay = "true";
  style.textContent = `
    .yingxiang-entry{min-width:0!important;min-height:26px!important;margin:0!important;padding:3px 1px!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;color:#d6ad63!important;font-size:11px!important;font-weight:700!important;letter-spacing:.08em!important;white-space:nowrap!important}
    .yingxiang-entry:hover,.yingxiang-entry:focus-visible{color:#ead3a6!important;outline:none!important}
    .yingxiang-overlay{position:fixed;inset:0;z-index:2300;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.78)}
    .yingxiang-overlay__panel{width:min(820px,calc(100vw - 28px));max-height:92dvh;overflow:auto;border:1px solid rgba(214,173,99,.28);border-radius:14px;background:#151515;box-shadow:0 18px 48px rgba(0,0,0,.48)}
    @media(max-width:620px){.yingxiang-overlay{padding:8px}.yingxiang-overlay__panel{width:calc(100vw - 16px);max-height:95dvh;border-radius:10px}}
  `;
  document.head.append(style);
}

export interface YingxiangBrowserBootstrapOptions {
  now(): string;
  cloudBaseUrl?: string;
}

export class YingxiangBrowserBootstrap {
  private readonly authStore: LocalAuthSessionStore;
  private readonly client?: YingxiangClient;
  private observer?: MutationObserver;
  private overlay?: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    db: SQLiteDriver,
    private readonly options: YingxiangBrowserBootstrapOptions
  ) {
    const preferences = new UserPreferencesRepository(db);
    this.authStore = new LocalAuthSessionStore(preferences, options.now);
    if (options.cloudBaseUrl) {
      this.client = new YingxiangClient(options.cloudBaseUrl, async () => (await this.authStore.get())?.token);
    }
  }

  start(): void {
    installOverlayStyles();
    this.installHomeEntry();
    this.observer = new MutationObserver(() => this.installHomeEntry());
    this.observer.observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-screen"] });
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.closeOverlay();
  }

  private installHomeEntry(): void {
    if (this.root.dataset.screen !== "setup") return;
    const actions = this.root.querySelector<HTMLElement>(".batch-setup__header-actions");
    if (!actions || actions.querySelector("[data-home-action='yingxiang']")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yingxiang-entry";
    button.dataset.homeAction = "yingxiang";
    button.textContent = "迎香";
    button.setAttribute("aria-label", "进入迎香活动发布");
    button.addEventListener("click", () => this.openHost());
    actions.prepend(button);
  }

  private openHost(): void {
    this.closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "yingxiang-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "迎香测试版");
    const panel = document.createElement("div");
    panel.className = "yingxiang-overlay__panel";
    overlay.append(panel);
    overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) this.closeOverlay(); });
    overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") this.closeOverlay(); });
    document.body.append(overlay);
    this.overlay = overlay;
    new YingxiangHostRenderer(panel, this.client, {
      onClose: () => this.closeOverlay(),
      onRequireAccount: () => {
        this.closeOverlay();
        const account = [...this.root.querySelectorAll<HTMLButtonElement>(".batch-setup__header-actions button")]
          .find((candidate) => candidate.textContent?.trim() === "账户");
        account?.click();
      }
    }).render();
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = undefined;
  }
}
