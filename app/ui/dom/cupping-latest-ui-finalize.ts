import { CuppingScreenRenderer } from "./cupping-screen-renderer";

const PATCH_FLAG = Symbol.for("aromasense.cupping.latest-ui-finalize.v1");

interface RendererInternals {
  root: HTMLElement;
}

interface RendererPrototype {
  [PATCH_FLAG]?: boolean;
  render(this: RendererInternals): Promise<void>;
}

function installStyles(): void {
  if (document.head.querySelector("style[data-aromasense-cupping-latest-ui-finalize]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseCuppingLatestUiFinalize = "true";
  style.textContent = `
    .cupping-main__stage-strip{
      gap:10px!important;
      bottom:calc(46px + max(10px, env(safe-area-inset-bottom)))!important;
    }
    .cupping-stage-step{
      position:static!important;
      min-height:78px!important;
      grid-template-rows:auto minmax(0,1fr) auto!important;
      gap:5px!important;
    }
    .cupping-stage-step.is-current::after{
      content:attr(title);
      position:absolute;
      left:4px;
      right:4px;
      bottom:4px;
      height:auto;
      min-height:22px;
      border-radius:0;
      background:transparent;
      color:#8f9397;
      font-size:10px;
      font-weight:500;
      line-height:1.25;
      text-align:left;
      white-space:normal;
      pointer-events:none;
    }
    .cupping-stage-step__status-dot{
      grid-row:1!important;
      align-self:center!important;
    }
    .cupping-stage-step__label{
      grid-row:2!important;
      align-self:center!important;
    }
    .cupping-stage-step__index{
      grid-row:3!important;
      display:grid!important;
      place-items:center!important;
      width:21px!important;
      height:21px!important;
      border:1.5px solid currentColor!important;
      border-radius:50%!important;
      background:transparent!important;
      color:currentColor!important;
      font-size:11px!important;
      font-weight:850!important;
      line-height:1!important;
      font-variant-numeric:tabular-nums!important;
    }
    .cupping-stage-step.is-current .cupping-stage-step__index{
      border-color:var(--as-gold,#d6ad63)!important;
      background:var(--as-gold,#d6ad63)!important;
      color:#111!important;
      box-shadow:0 0 0 1px rgba(185,153,90,.18)!important;
    }
    .cupping-main__footer.is-two-action{
      gap:10px!important;
      padding-top:1px!important;
      transform:translateY(-0.5px)!important;
    }
    .cupping-main__footer.is-two-action .cupping-nav--previous,
    .cupping-main__footer.is-two-action .cupping-nav--next{
      font-size:23px!important;
      font-weight:900!important;
      line-height:1!important;
      padding-top:0!important;
      padding-bottom:0!important;
    }
    .cupping-stage-step__status-dot.is-completion-flash,
    .sample-rail__state-dot.is-completion-flash,
    .sample-rail__stage-line.is-completion-flash{
      animation:aromasense-stage-completion-triple-flash 2100ms linear both!important;
    }
    /* Three 0.5 s flashes separated by two 0.3 s quiet intervals: 2.1 s total. */
    @keyframes aromasense-stage-completion-triple-flash{
      0%{transform:scale(1);background-color:var(--as-progress-active);filter:none}
      11.905%{transform:scale(1.5);background-color:#effff3;filter:brightness(1.55)}
      23.81%{transform:scale(1);background-color:#9ed8aa;filter:none}
      38.095%{transform:scale(1);background-color:#9ed8aa;filter:none}
      50%{transform:scale(1.5);background-color:#effff3;filter:brightness(1.55)}
      61.905%{transform:scale(1);background-color:#9ed8aa;filter:none}
      76.19%{transform:scale(1);background-color:#9ed8aa;filter:none}
      88.095%{transform:scale(1.5);background-color:#effff3;filter:brightness(1.55)}
      100%{transform:scale(1);background-color:var(--as-progress-completed);filter:none}
    }
    @media(max-width:720px){
      .cupping-stage-step.is-current::after{
        font-size:9px;
        line-height:1.3;
      }
    }
    @media(prefers-reduced-motion:reduce){
      .cupping-stage-step__status-dot.is-completion-flash,
      .sample-rail__state-dot.is-completion-flash,
      .sample-rail__stage-line.is-completion-flash{
        animation:none!important;
        background:var(--as-progress-completed)!important;
      }
    }
  `;
  document.head.append(style);
}

function applyStageIndexes(root: HTMLElement): void {
  const steps = [...root.querySelectorAll<HTMLButtonElement>(".cupping-main__stage-strip .cupping-stage-step")];
  steps.forEach((step, index) => {
    const label = step.querySelector<HTMLElement>(".cupping-stage-step__label");
    const dot = step.querySelector<HTMLElement>(".cupping-stage-step__status-dot");
    if (label && dot && dot.nextElementSibling !== label) step.insertBefore(dot, label);

    let badge = step.querySelector<HTMLElement>(".cupping-stage-step__index");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "cupping-stage-step__index";
      badge.setAttribute("aria-hidden", "true");
      step.append(badge);
    }
    badge.textContent = String(index + 1);
  });
}

function applyFooterArrows(root: HTMLElement): void {
  const previous = root.querySelector<HTMLButtonElement>(".cupping-main__footer .cupping-nav--previous");
  if (previous && previous.textContent?.trim() === "上一步") {
    previous.textContent = "←";
    previous.setAttribute("aria-label", "上一步");
  }

  const next = root.querySelector<HTMLButtonElement>(".cupping-main__footer .cupping-nav--next");
  if (next && next.textContent?.trim() === "下一步") {
    next.textContent = "→";
    next.setAttribute("aria-label", "下一步");
  }
}

function applyLatestUi(root: HTMLElement): void {
  installStyles();
  applyStageIndexes(root);
  applyFooterArrows(root);
}

function installPatch(): void {
  const prototype = CuppingScreenRenderer.prototype as unknown as RendererPrototype;
  if (prototype[PATCH_FLAG]) return;
  prototype[PATCH_FLAG] = true;
  const originalRender = prototype.render;
  prototype.render = async function(): Promise<void> {
    await originalRender.call(this);
    applyLatestUi(this.root);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") installPatch();
