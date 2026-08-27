import { clearElement, element } from "./dom-helpers";

export type StartupStatusKey = "database" | "dictionary" | "recognition" | "account" | "sync";
export type StartupState = "loading" | "ready" | "degraded" | "error";

export interface StartupRendererOptions {
  onEnter(): void | Promise<void>;
}

const STATUS_KEYS: readonly StartupStatusKey[] = ["database", "dictionary", "recognition", "account", "sync"] as const;

export class StartupRenderer {
  private readonly states = new Map<StartupStatusKey, StartupState>();
  private readonly progressFill = element("span", "startup__progress-fill");
  private readonly progressValue = element("span", "startup__progress-value", "0%");
  private enterAllowed = false;
  private entering = false;

  constructor(private readonly root: HTMLElement, private readonly options: StartupRendererOptions) {
    for (const key of STATUS_KEYS) this.states.set(key, "loading");
  }

  render(): void {
    clearElement(this.root);
    this.root.classList.add("startup-screen");

    const shell = element("main", "startup");
    const brand = element("section", "startup__brand");
    brand.setAttribute("aria-label", "AromaSense 香迹");
    brand.append(
      element("h1", "startup__title", "AromaSense"),
      element("div", "startup__chinese", "香  迹")
    );

    const progress = element("div", "startup__progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", "0");
    const track = element("div", "startup__progress-track");
    track.append(this.progressFill);
    progress.append(track, this.progressValue);

    shell.append(brand, progress);
    this.root.append(shell);
    this.updateProgress();
  }

  setStatus(key: StartupStatusKey, state: StartupState, _message: string): void {
    this.states.set(key, state);
    this.updateProgress();
  }

  allowEnter(): void {
    this.enterAllowed = true;
    this.maybeEnter();
  }

  setEntering(): void {
    this.entering = true;
    this.root.classList.add("is-entering");
  }

  private updateProgress(): void {
    const settled = STATUS_KEYS.filter((key) => {
      const state = this.states.get(key);
      return state === "ready" || state === "degraded" || state === "error";
    }).length;
    const percent = Math.round((settled / STATUS_KEYS.length) * 100);
    this.progressFill.style.width = `${percent}%`;
    this.progressValue.textContent = `${percent}%`;
    const progress = this.root.querySelector<HTMLElement>(".startup__progress");
    progress?.setAttribute("aria-valuenow", String(percent));
    progress?.classList.toggle("is-complete", percent === 100);
    this.maybeEnter();
  }

  private maybeEnter(): void {
    if (!this.enterAllowed || this.entering) return;
    const complete = STATUS_KEYS.every((key) => this.states.get(key) !== "loading");
    if (!complete) return;
    this.entering = true;
    this.root.classList.add("is-entering");
    window.setTimeout(() => { void this.options.onEnter(); }, 180);
  }
}
