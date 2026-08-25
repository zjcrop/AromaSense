import { button, clearElement, element } from "./dom-helpers";

export type StartupStatusKey = "database" | "dictionary" | "recognition" | "account" | "sync";
export type StartupState = "loading" | "ready" | "degraded" | "error";

export interface StartupRendererOptions {
  onEnter(): void | Promise<void>;
}

const STATUS_LABELS: Record<StartupStatusKey, string> = {
  database: "本地数据",
  dictionary: "感官字典",
  recognition: "图像识别",
  account: "账户状态",
  sync: "同步队列"
};

export class StartupRenderer {
  private readonly list = element("div", "startup__status-list");
  private readonly enter: HTMLButtonElement;
  private readonly statusNodes = new Map<StartupStatusKey, HTMLElement>();

  constructor(private readonly root: HTMLElement, private readonly options: StartupRendererOptions) {
    this.enter = button("startup__enter", "进入 AromaSense", () => this.options.onEnter());
    this.enter.disabled = true;
  }

  render(): void {
    clearElement(this.root);
    this.root.classList.add("startup-screen");
    const shell = element("main", "startup");
    const brand = element("section", "startup__brand");
    brand.append(
      element("div", "startup__mark", "香迹"),
      element("h1", "startup__title", "AromaSense"),
      element("p", "startup__subtitle", "数字化咖啡杯测与感官记录")
    );
    for (const key of Object.keys(STATUS_LABELS) as StartupStatusKey[]) {
      const row = element("div", "startup__status is-loading");
      row.dataset.statusKey = key;
      row.append(
        element("span", "startup__status-indicator", ""),
        element("strong", "startup__status-label", STATUS_LABELS[key]),
        element("span", "startup__status-message", "正在准备…")
      );
      this.statusNodes.set(key, row);
      this.list.append(row);
    }
    const note = element("p", "startup__note", "本地杯测优先。图像识别或云服务暂不可用时，不会阻止进入和保存本地记录。 ");
    shell.append(brand, this.list, note, this.enter);
    this.root.append(shell);
  }

  setStatus(key: StartupStatusKey, state: StartupState, message: string): void {
    const row = this.statusNodes.get(key);
    if (!row) return;
    row.className = `startup__status is-${state}`;
    const messageNode = row.querySelector<HTMLElement>(".startup__status-message");
    if (messageNode) messageNode.textContent = message;
  }

  allowEnter(): void {
    this.enter.disabled = false;
  }

  setEntering(): void {
    this.enter.disabled = true;
    this.enter.textContent = "正在进入…";
  }
}
