import { requireLuckyBeanRecognitionCore } from "../core/luckybean-upstream-adapter";

let active = false;
let ending = false;

function isAddAction(target: EventTarget | null): boolean {
  const node = target instanceof Element ? target.closest("button") : null;
  if (!node || !node.closest(".batch-setup__capture-actions")) return false;
  return !node.classList.contains("batch-setup__clear");
}

async function begin(reason = "aromasense-add-flow"): Promise<void> {
  const core = requireLuckyBeanRecognitionCore();
  if (active) {
    void core.warmOcr?.();
    return;
  }
  active = true;
  ending = false;
  try {
    await core.beginOcrSession?.(reason);
  } catch (error) {
    console.warn("AromaSense OCR session preload failed; recognition may cold-start", error);
  }
}

async function end(reason = "aromasense-add-flow-exit"): Promise<void> {
  if (!active || ending) return;
  ending = true;
  active = false;
  try {
    await requireLuckyBeanRecognitionCore().endOcrSession?.(reason);
  } catch (error) {
    console.warn("AromaSense OCR session dispose failed", error);
  } finally {
    ending = false;
  }
}

function install(): void {
  const trigger = (event: Event) => {
    if (isAddAction(event.target)) void begin(`aromasense-add:${(event.target as Element).textContent?.trim() || "route"}`);
  };
  document.addEventListener("pointerdown", trigger, { capture: true, passive: true });
  document.addEventListener("click", trigger, true);

  const observer = new MutationObserver(() => {
    if (active && !document.querySelector(".batch-setup")) void end("aromasense-batch-setup-exit");
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("pagehide", () => { void end("aromasense-pagehide"); });
}

install();

globalThis.AromaSenseRecognitionSession = Object.freeze({
  begin,
  end,
  get active() { return active; }
});

declare global {
  var AromaSenseRecognitionSession: {
    begin(reason?: string): Promise<void>;
    end(reason?: string): Promise<void>;
    readonly active: boolean;
  } | undefined;
}
