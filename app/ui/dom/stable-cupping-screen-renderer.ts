import type { SampleSummaryReader } from "../../storage/sample-summary-reader";
import type { CuppingScreenController } from "../cupping-screen-controller";
import type { FlavorGroupPreferenceService } from "../flavor-group-preferences";
import {
  CuppingScreenRenderer as BaseCuppingScreenRenderer,
  type CuppingScreenRendererOptions
} from "./cupping-screen-renderer";

/**
 * Keeps the cupping editor at the user's current vertical position while the
 * base renderer replaces DOM after local persistence. The user can still
 * scroll deliberately; only renderer/focus-induced jumps are cancelled.
 */
export class CuppingScreenRenderer {
  private readonly base: BaseCuppingScreenRenderer;
  private editor?: HTMLElement;
  private observer?: MutationObserver;
  private lastScrollTop = 0;
  private lockedScrollTop?: number;
  private suppressScrollCapture = false;
  private releaseTimer?: ReturnType<typeof setTimeout>;

  private readonly captureInteractionPosition = (): void => {
    if (!this.editor) return;
    this.lockedScrollTop = this.editor.scrollTop;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => { this.lockedScrollTop = undefined; }, 3000);
  };

  private readonly captureUserScroll = (): void => {
    if (!this.editor || this.suppressScrollCapture || this.lockedScrollTop !== undefined) return;
    this.lastScrollTop = this.editor.scrollTop;
  };

  constructor(
    private readonly root: HTMLElement,
    controller: CuppingScreenController,
    flavorService: FlavorGroupPreferenceService,
    summaryReader: SampleSummaryReader,
    options: CuppingScreenRendererOptions
  ) {
    this.base = new BaseCuppingScreenRenderer(root, controller, flavorService, summaryReader, options);
  }

  async initialize(sessionId: string): Promise<void> {
    await this.base.initialize(sessionId);
    this.installViewportStability();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = undefined;
    this.editor?.removeEventListener("scroll", this.captureUserScroll);
    this.root.removeEventListener("pointerdown", this.captureInteractionPosition, true);
    this.root.removeEventListener("keydown", this.captureInteractionPosition, true);
    this.root.removeEventListener("input", this.captureInteractionPosition, true);
    this.root.removeEventListener("change", this.captureInteractionPosition, true);
    this.editor = undefined;
    this.base.dispose();
  }

  private installViewportStability(): void {
    const editor = this.root.querySelector<HTMLElement>(".cupping-main__editor");
    if (!editor) return;
    this.editor = editor;
    this.lastScrollTop = editor.scrollTop;

    editor.addEventListener("scroll", this.captureUserScroll, { passive: true });
    this.root.addEventListener("pointerdown", this.captureInteractionPosition, true);
    this.root.addEventListener("keydown", this.captureInteractionPosition, true);
    this.root.addEventListener("input", this.captureInteractionPosition, true);
    this.root.addEventListener("change", this.captureInteractionPosition, true);

    this.observer = new MutationObserver(() => this.restoreViewportPosition());
    this.observer.observe(editor, { childList: true, subtree: true });
  }

  private restoreViewportPosition(): void {
    const editor = this.editor;
    if (!editor) return;
    const target = this.lockedScrollTop ?? this.lastScrollTop;
    this.suppressScrollCapture = true;
    editor.scrollTop = target;

    requestAnimationFrame(() => {
      if (!this.editor) return;
      this.editor.scrollTop = target;
      requestAnimationFrame(() => {
        if (!this.editor) return;
        this.editor.scrollTop = target;
        this.lastScrollTop = target;
        this.lockedScrollTop = undefined;
        this.suppressScrollCapture = false;
      });
    });
  }
}

export type { CuppingScreenRendererOptions };
